const crypto = require("node:crypto");
const fs = require("node:fs");
const https = require("node:https");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const VERSION = "v24.22.1";
const ARCHIVE_NAME = `node-${VERSION}-win-x64.zip`;
const BASE_URL = `https://nodejs.org/dist/${VERSION}`;
const BUILD_DIR = path.join(__dirname, "..", "build");
const TEMP_DIR = path.join(BUILD_DIR, "node-runtime-extract");
const RUNTIME_DIR = path.join(BUILD_DIR, "node-runtime");
const ARCHIVE_PATH = path.join(BUILD_DIR, ARCHIVE_NAME);

function download(url) {
  return new Promise((resolve, reject) => {
    https.get(url, response => {
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`Download failed (${response.statusCode}): ${url}`));
        return;
      }
      const chunks = [];
      response.on("data", chunk => chunks.push(chunk));
      response.on("end", () => resolve(Buffer.concat(chunks)));
      response.on("error", reject);
    }).on("error", reject);
  });
}

async function main() {
  fs.mkdirSync(BUILD_DIR, { recursive: true });
  const [archive, checksums] = await Promise.all([
    download(`${BASE_URL}/${ARCHIVE_NAME}`),
    download(`${BASE_URL}/SHASUMS256.txt`),
  ]);
  const checksumRow = checksums.toString("utf8").split(/\r?\n/).find(line => line.endsWith(`  ${ARCHIVE_NAME}`));
  if (!checksumRow) throw new Error(`The official checksum file did not contain ${ARCHIVE_NAME}.`);
  const expectedHash = checksumRow.split(/\s+/)[0].toLowerCase();
  const actualHash = crypto.createHash("sha256").update(archive).digest("hex");
  if (actualHash !== expectedHash) throw new Error(`Node.js runtime checksum mismatch for ${ARCHIVE_NAME}.`);
  fs.writeFileSync(ARCHIVE_PATH, archive);

  for (const directory of [TEMP_DIR, RUNTIME_DIR]) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
  fs.mkdirSync(TEMP_DIR, { recursive: true });
  execFileSync("tar.exe", ["-xf", ARCHIVE_PATH, "-C", TEMP_DIR], { stdio: "inherit" });

  const extracted = path.join(TEMP_DIR, `node-${VERSION}-win-x64`);
  const executable = path.join(extracted, "node.exe");
  if (!fs.existsSync(executable)) throw new Error("The official Node.js archive did not contain node.exe.");
  fs.mkdirSync(RUNTIME_DIR, { recursive: true });
  fs.copyFileSync(executable, path.join(RUNTIME_DIR, "node.exe"));
  for (const license of ["LICENSE", "README.md"]) {
    const source = path.join(extracted, license);
    if (fs.existsSync(source)) fs.copyFileSync(source, path.join(RUNTIME_DIR, license));
  }

  const version = execFileSync(path.join(RUNTIME_DIR, "node.exe"), ["--version"], { encoding: "utf8" }).trim();
  if (version !== VERSION) throw new Error(`Expected ${VERSION}, but the downloaded runtime reports ${version}.`);
  execFileSync(path.join(RUNTIME_DIR, "node.exe"), [
    "-e",
    "const { DatabaseSync } = require('node:sqlite'); const db = new DatabaseSync(':memory:'); db.close();",
  ], { stdio: "inherit" });
  fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  fs.rmSync(ARCHIVE_PATH, { force: true });
  console.log(`Verified bundled Node.js ${version} with built-in SQLite.`);
}

main().catch(error => {
  console.error("Could not prepare the bundled Node.js runtime:", error);
  process.exitCode = 1;
});
