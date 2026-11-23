const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const { spawn } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const { Readable, Transform } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const { compareVersions, getLatestRelease } = require("./release-api");

const PRODUCT_NAME = "Capitol Stock Management";
app.setName(PRODUCT_NAME);
const SERVER_ENTRY = path.join(app.getAppPath(), "server.js");
const NODE_RUNTIME = path.join(process.resourcesPath, "node-runtime", "node.exe");
const APP_DATA = path.join(app.getPath("appData"), PRODUCT_NAME);
const DATA_DIR = path.join(APP_DATA, "data");
const LOG_DIR = path.join(APP_DATA, "logs");
const cloudConfig = require(path.join(app.getAppPath(), "assets", "cloud-config.json"));
const REMOTE_APP_URL = process.env.CAPITOL_REMOTE_URL || cloudConfig.remoteAppUrl || "";

app.setPath("userData", APP_DATA);
app.setAppUserModelId("com.capitol.stockmanagement");

let serverProcess;
let serverLog;
let mainWindow;
let quitting = false;
let localServerPort = null;
let activeUpdateDownload = null;
let downloadedUpdate = null;

function assertTrustedRenderer(event) {
  if (!mainWindow || mainWindow.isDestroyed() ||
      event.sender !== mainWindow.webContents ||
      event.senderFrame !== mainWindow.webContents.mainFrame) {
    throw new Error("Desktop updates can only be requested by the Capitol application window.");
  }
  const rendererUrl = new URL(event.senderFrame.url);
  const trustedOrigin = REMOTE_APP_URL
    ? new URL(REMOTE_APP_URL).origin
    : `http://127.0.0.1:${localServerPort}`;
  if (rendererUrl.origin !== trustedOrigin) {
    throw new Error("Desktop updates are unavailable from an untrusted page.");
  }
}

function reportUpdateProgress(event, progress) {
  if (!event.sender.isDestroyed()) event.sender.send("app-update:progress", progress);
}

async function downloadLatestInstaller(event) {
  if (activeUpdateDownload) return activeUpdateDownload;
  activeUpdateDownload = (async () => {
    const release = await getLatestRelease();
    if (compareVersions(release.version, app.getVersion()) <= 0) {
      throw new Error("This desktop app is already on the latest release.");
    }
    const response = await fetch(release.downloadUrl, {
      redirect: "follow",
      signal: AbortSignal.timeout(30 * 60 * 1000),
    });
    const finalUrl = new URL(response.url);
    if (!response.ok || !response.body ||
        finalUrl.protocol !== "https:" ||
        !(finalUrl.hostname === "github.com" || finalUrl.hostname.endsWith(".githubusercontent.com"))) {
      throw new Error("GitHub did not provide the desktop installer.");
    }

    const updateDirectory = path.join(APP_DATA, "updates");
    const installerPath = path.join(updateDirectory, release.installerName);
    const partialPath = `${installerPath}.partial`;
    fs.mkdirSync(updateDirectory, { recursive: true });
    await fs.promises.rm(partialPath, { force: true });

    const hash = crypto.createHash("sha256");
    let downloadedBytes = 0;
    let lastProgressAt = 0;
    const meter = new Transform({
      transform(chunk, _encoding, callback) {
        downloadedBytes += chunk.length;
        hash.update(chunk);
        const now = Date.now();
        if (now - lastProgressAt >= 120 || downloadedBytes === release.size) {
          lastProgressAt = now;
          reportUpdateProgress(event, {
            version: release.version,
            downloadedBytes,
            totalBytes: release.size,
            percent: Math.min(99, Math.floor((downloadedBytes / release.size) * 100)),
          });
        }
        callback(null, chunk);
      },
    });

    try {
      await pipeline(
        Readable.fromWeb(response.body),
        meter,
        fs.createWriteStream(partialPath, { flags: "wx" }),
      );
      const actualDigest = `sha256:${hash.digest("hex")}`;
      if (downloadedBytes !== release.size || actualDigest !== release.digest) {
        throw new Error("The downloaded installer failed its GitHub size or SHA-256 verification.");
      }
      await fs.promises.rm(installerPath, { force: true });
      await fs.promises.rename(partialPath, installerPath);
      downloadedUpdate = { installerPath, version: release.version };
      reportUpdateProgress(event, {
        version: release.version,
        downloadedBytes,
        totalBytes: release.size,
        percent: 100,
      });
      return { downloaded: true, version: release.version };
    } catch (error) {
      await fs.promises.rm(partialPath, { force: true });
      throw error;
    }
  })();

  try {
    return await activeUpdateDownload;
  } finally {
    activeUpdateDownload = null;
  }
}

ipcMain.handle("app-update:download", async event => {
  assertTrustedRenderer(event);
  return downloadLatestInstaller(event);
});

ipcMain.handle("app-update:install", async event => {
  assertTrustedRenderer(event);
  if (!downloadedUpdate || !fs.existsSync(downloadedUpdate.installerPath)) {
    throw new Error("Download the verified installer before starting the update.");
  }
  if (compareVersions(downloadedUpdate.version, app.getVersion()) <= 0) {
    throw new Error("The downloaded installer is not newer than this app.");
  }

  const installer = spawn(downloadedUpdate.installerPath, [], {
    detached: true,
    stdio: "ignore",
    windowsHide: false,
  });
  installer.unref();
  await new Promise((resolve, reject) => {
    installer.once("spawn", resolve);
    installer.once("error", reject);
  });
  app.quit();
  return { started: true };
});

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(error => error ? reject(error) : resolve(port));
    });
  });
}

function wait(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function serverIsReady(port) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1000) });
    if (!response.ok) return false;
    const health = await response.json();
    return health.ok === true && health.sqlite === true;
  } catch {
    return false;
  }
}

async function startServer() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const packaged = app.isPackaged;
  const nodeExecutable = packaged ? NODE_RUNTIME : process.execPath;
  if (!fs.existsSync(nodeExecutable)) throw new Error(`The bundled Node.js runtime is missing: ${nodeExecutable}`);
  const logPath = path.join(LOG_DIR, "server.log");
  serverLog = fs.createWriteStream(logPath, { flags: "a" });

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const port = await freePort();
    const env = {
      ...process.env,
      CAPITOL_DATA_DIR: DATA_DIR,
      PORT: String(port),
    };
    if (packaged) delete env.ELECTRON_RUN_AS_NODE;
    else env.ELECTRON_RUN_AS_NODE = "1";
    serverProcess = spawn(nodeExecutable, [SERVER_ENTRY], {
      cwd: path.dirname(SERVER_ENTRY),
      env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    serverProcess.stdout.pipe(serverLog, { end: false });
    serverProcess.stderr.pipe(serverLog, { end: false });
    serverProcess.on("error", error => serverLog.write(`\nUnable to start local server: ${error.stack || error}\n`));
    let exited = false;
    serverProcess.once("exit", () => { exited = true; });

    for (let check = 0; check < 60 && !exited; check += 1) {
      if (await serverIsReady(port)) return port;
      await wait(200);
    }
    if (serverProcess && !exited) {
      serverProcess.kill();
      await wait(300);
    }
    serverProcess = null;
  }

  throw new Error(`The local server could not start after several attempts. Review ${logPath} for details.`);
}

function createWindow(url) {
  const appUrl = new URL(url);
  appUrl.searchParams.set("desktopVersion", app.getVersion());
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 850,
    minHeight: 620,
    show: false,
    title: PRODUCT_NAME,
    icon: path.join(app.getAppPath(), "assets", "capitol-catering-icon.png"),
    backgroundColor: "#f5f7f8",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(app.getAppPath(), "preload.js"),
    },
  });
  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.loadURL(appUrl.href).catch(error => {
    dialog.showErrorBox(PRODUCT_NAME, `The application window could not be opened.\n\n${error.message}`);
    app.quit();
  });
  mainWindow.on("closed", () => { mainWindow = null; });
}

app.on("second-instance", () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});

app.whenReady().then(async () => {
  try {
    if (REMOTE_APP_URL) {
      const remoteUrl = new URL(REMOTE_APP_URL);
      if (remoteUrl.protocol !== "https:") throw new Error("The cloud application URL must use HTTPS.");
      createWindow(remoteUrl.href);
      return;
    }
    const port = await startServer();
    localServerPort = port;
    createWindow(`http://127.0.0.1:${port}`);
  } catch (error) {
    dialog.showErrorBox(PRODUCT_NAME, `Capitol Stock Management could not start.\n\n${error.message}`);
    app.quit();
  }
});

app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => {
  if (quitting) return;
  quitting = true;
  if (serverProcess && !serverProcess.killed) serverProcess.kill();
  if (serverLog) serverLog.end();
});

if (!app.requestSingleInstanceLock()) app.quit();
