"use strict";

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const net = require("node:net");

const root = path.join(__dirname, "..");
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "capitol-stock-check-"));
const dataDir = path.join(tempDir, "data");
const databasePath = path.join(dataDir, "capitol-stock.sqlite");
let server;
let output = "";

async function unusedPort() {
  const listener = net.createServer();
  await new Promise((resolve, reject) => {
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", resolve);
  });
  const { port } = listener.address();
  await new Promise(resolve => listener.close(resolve));
  return port;
}

async function startServer(port) {
  server = spawn(process.execPath, [path.join(root, "server.js")], {
    cwd: root,
    env: { ...process.env, CAPITOL_DATA_DIR: dataDir, PORT: String(port), NODE_ENV: "test" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  server.stdout.on("data", chunk => { output += chunk.toString(); });
  server.stderr.on("data", chunk => { output += chunk.toString(); });
  const origin = `http://127.0.0.1:${port}`;
  let lastError;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (server.exitCode !== null) throw new Error(`Test server exited early:\n${output}`);
    try {
      const response = await fetch(`${origin}/api/health`);
      if (response.ok) return origin;
      lastError = new Error(`Health check returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Test server did not become ready (${lastError?.message || "unknown startup error"}):\n${output}`);
}

async function stopServer() {
  if (!server || server.exitCode !== null) return;
  const exited = new Promise(resolve => server.once("exit", resolve));
  server.kill();
  await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 4000))]);
  if (server.exitCode === null) server.kill();
}

async function request(origin, pathname, { method = "GET", body, cookie = "", csrf = "" } = {}) {
  const headers = {};
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    headers.Origin = origin;
    headers["X-CSRF-Token"] = csrf;
  }
  if (cookie) headers.Cookie = cookie;
  const response = await fetch(`${origin}${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let payload = null;
  const contentType = response.headers.get("content-type") || "";
  if (text && contentType.includes("application/json")) {
    try {
      payload = JSON.parse(text);
    } catch (error) {
      throw new Error(`${method} ${pathname} returned invalid JSON: ${error.message}`);
    }
  }
  assert.equal(response.ok, true, `${method} ${pathname} failed (${response.status}): ${text}`);
  return { payload, response, text };
}

async function signIn(origin) {
  const { payload, response } = await request(origin, "/api/login", {
    method: "POST",
    body: { username: "stock-check-admin", password: "1234" },
  });
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie, "login should create a session cookie");
  return { cookie, csrf: payload.csrfToken };
}

async function run() {
  const port = await unusedPort();
  let origin = await startServer(port);
  try {
    await request(origin, "/api/setup", {
      method: "POST",
      body: { username: "stock-check-admin", displayName: "Regression Admin", password: "1234" },
    });
    let session = await signIn(origin);
    let bootstrap = (await request(origin, "/api/bootstrap", { cookie: session.cookie })).payload;
    assert.ok(bootstrap.stores.includes("Chemical Store") && bootstrap.stores.includes("Frozen Store"));
    const locationRows = (await request(origin, "/api/items", { cookie: session.cookie })).payload.locations;
    const locations = Object.fromEntries(locationRows.map(row => [row.name, row]));
    const chemical = locations["Chemical Store"];
    const frozen = locations["Frozen Store"];
    const dry = locations["Dry Store"];
    assert.ok(chemical && frozen && dry, "default stock locations are available");
    const createItem = async item => (await request(origin, "/api/admin/items", {
      method: "POST",
      cookie: session.cookie,
      csrf: session.csrf,
      body: { reorderLevel: 0, previousMonthQuantity: 0, ...item },
    })).payload.item;
    const hairnet = await createItem({
      sku: "CHE020",
      name: "Hairnet",
      category: "Chemical",
      store: "Chemical Store",
      unit: "pieces",
      receivedStockQuantity: 11,
      initialQuantity: 11,
      locationId: chemical.id,
    });
    const fish = await createItem({
      sku: "FRZ018",
      name: "Fish fillet",
      category: "Protein",
      store: "Frozen Store",
      unit: "kg",
      receivedStockQuantity: 13,
      initialQuantity: 13,
      locationId: frozen.id,
    });
    await stopServer();

    const localDb = new DatabaseSync(databasePath);
    try {
      localDb.prepare("UPDATE batches SET location_id = ?, quantity_remaining = 0 WHERE item_id = ?")
        .run(dry.id, hairnet.id);
      localDb.prepare("UPDATE batches SET location_id = ?, quantity_remaining = 3 WHERE item_id = ?")
        .run(dry.id, fish.id);
    } finally {
      localDb.close();
    }

    output = "";
    origin = await startServer(port);
    session = await signIn(origin);
    bootstrap = (await request(origin, "/api/bootstrap", { cookie: session.cookie })).payload;
    const inventory = (await request(origin, "/api/inventory", { cookie: session.cookie })).payload;
    const inventoryHairnet = inventory.items.find(row => row.id === hairnet.id);
    const inventoryFish = inventory.items.find(row => row.id === fish.id);
    const chemicalIssueItems = (await request(origin, `/api/items?locationId=${encodeURIComponent(chemical.id)}`, {
      cookie: session.cookie,
    })).payload.items;
    const frozenIssueItems = (await request(origin, `/api/items?locationId=${encodeURIComponent(frozen.id)}`, {
      cookie: session.cookie,
    })).payload.items;
    assert.equal(inventoryHairnet.remainder, 11, "inventory must preserve the recovered Hairnet balance");
    assert.equal(chemicalIssueItems.find(row => row.id === hairnet.id).on_hand, 11, "Hairnet issue availability must match Chemical Store inventory");
    assert.equal(inventoryFish.remainder, 13, "inventory must restore the recovered Fish fillet balance");
    assert.equal(frozenIssueItems.find(row => row.id === fish.id).on_hand, 13, "Fish fillet issue availability must match Frozen Store inventory");

    const wrongStoreReceipt = await fetch(`${origin}/api/stock/receipt`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: origin,
        "X-CSRF-Token": session.csrf,
        Cookie: session.cookie,
      },
      body: JSON.stringify({ itemId: hairnet.id, locationId: dry.id, quantity: 1 }),
    });
    assert.equal(wrongStoreReceipt.status, 400, "future receipts cannot create another cross-store balance");

    const localDate = new Date();
    const date = `${localDate.getFullYear()}-${String(localDate.getMonth() + 1).padStart(2, "0")}-${String(localDate.getDate()).padStart(2, "0")}`;
    await request(origin, "/api/stock/issue", {
      method: "POST",
      cookie: session.cookie,
      csrf: session.csrf,
      body: {
        department: "Chef",
        person: "Togbe",
        issuedBy: "Regression Admin",
        date,
        lines: [{ itemId: hairnet.id, locationId: chemical.id, quantity: 2 }],
      },
    });
    const updatedInventory = (await request(origin, "/api/inventory", { cookie: session.cookie })).payload;
    const updatedIssueItems = (await request(origin, `/api/items?locationId=${encodeURIComponent(chemical.id)}`, {
      cookie: session.cookie,
    })).payload.items;
    assert.equal(updatedInventory.items.find(row => row.id === hairnet.id).remainder, 9);
    assert.equal(updatedIssueItems.find(row => row.id === hairnet.id).on_hand, 9);

    const requests = (await request(origin, "/api/requests", { cookie: session.cookie })).payload;
    assert.equal(requests.rows.length, 1, "current-month requests are listed");
    assert.equal(requests.rows[0].quantity_requested, 2);
    const archives = (await request(origin, "/api/requests/archives", { cookie: session.cookie })).payload.archives;
    assert.ok(archives.length > 0, "a completed-month request archive is created");
    assert.ok(archives[0].stores.includes("Chemical Store"));
    assert.equal(archives[0].rows.length, 0, "empty request archives retain the store list with zero rows");

    const shell = await request(origin, "/");
    assert.ok(shell.text.includes('class="boot-screen"'), "the PWA starts with a visible workspace splash");
    assert.ok(shell.text.includes("Fetching live inventory and account details"), "the splash communicates live startup loading");
    const manifest = (await request(origin, "/manifest.json")).payload;
    assert.equal(manifest.display, "standalone");
    assert.deepEqual(manifest.icons.map(icon => icon.sizes), ["192x192", "512x512"]);
    const worker = await request(origin, "/service-worker.js");
    assert.ok(worker.text.includes("capitol-stock-shell-v2"), "the refreshed PWA shell is installed for mobile clients");
    for (const pathname of ["/assets/capitol-stock-icon-180.png", "/assets/capitol-stock-icon-192.png", "/assets/capitol-stock-icon-512.png"]) {
      const asset = await request(origin, pathname);
      assert.equal(asset.response.status, 200);
      assert.ok(asset.text.length > 0 || asset.response.headers.get("content-type") === "image/png");
    }

    await stopServer();
    output = "";
    origin = await startServer(port);
    session = await signIn(origin);
    const restartedItems = (await request(origin, `/api/items?locationId=${encodeURIComponent(chemical.id)}`, {
      cookie: session.cookie,
    })).payload.items;
    const restartedFrozenItems = (await request(origin, `/api/items?locationId=${encodeURIComponent(frozen.id)}`, {
      cookie: session.cookie,
    })).payload.items;
    assert.equal(restartedItems.find(row => row.id === hairnet.id).on_hand, 9, "reconciliation is idempotent after issuing stock");
    assert.equal(restartedFrozenItems.find(row => row.id === fish.id).on_hand, 13, "other store balances remain aligned after restart");
    console.log("Cross-store stock reconciliation, monthly request archives and PWA checks passed.");
  } finally {
    await stopServer();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

run().catch(error => {
  console.error(error);
  if (output) console.error(output);
  process.exitCode = 1;
});
