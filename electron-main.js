const { app, BrowserWindow, dialog } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");

const PRODUCT_NAME = "Capitol Stock Management";
app.setName(PRODUCT_NAME);
const SERVER_ENTRY = path.join(app.getAppPath(), "server.js");
const NODE_RUNTIME = path.join(process.resourcesPath, "node-runtime", "node.exe");
const APP_DATA = path.join(app.getPath("appData"), PRODUCT_NAME);
const DATA_DIR = path.join(APP_DATA, "data");
const LOG_DIR = path.join(APP_DATA, "logs");

app.setPath("userData", APP_DATA);
app.setAppUserModelId("com.capitol.stockmanagement");

let serverProcess;
let serverLog;
let mainWindow;
let quitting = false;

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

function createWindow(port) {
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
    },
  });
  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.loadURL(`http://127.0.0.1:${port}`).catch(error => {
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
    const port = await startServer();
    createWindow(port);
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
