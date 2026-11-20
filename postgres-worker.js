const { parentPort, workerData } = require("node:worker_threads");
const { Client, types } = require("pg");

types.setTypeParser(20, value => Number(value));

const HEADER_BYTES = 16;
const MAX_RESPONSE_BYTES = 32 * 1024 * 1024;
const state = new Int32Array(workerData.shared, 0, HEADER_BYTES / Int32Array.BYTES_PER_ELEMENT);
const payload = new Uint8Array(workerData.shared, HEADER_BYTES);
const client = new Client({
  connectionString: workerData.connectionString,
  application_name: "capitol-stock-management",
  connectionTimeoutMillis: 10_000,
  statement_timeout: 25_000,
});

let connection;
let queue = Promise.resolve();

function respond(result, error = null) {
  try {
    const body = JSON.stringify(error
      ? { message: error.message || "PostgreSQL query failed.", code: error.code || "PGERROR" }
      : { rows: result.rows || [], rowCount: result.rowCount || 0 });
    const bytes = new TextEncoder().encode(body);
    if (bytes.length > MAX_RESPONSE_BYTES) {
      throw Object.assign(new Error("PostgreSQL response exceeded the supported size."), { code: "RESPONSE_TOO_LARGE" });
    }
    payload.set(bytes);
    Atomics.store(state, 1, bytes.length);
    Atomics.store(state, 0, error ? 2 : 1);
    Atomics.notify(state, 0);
  } catch (writeError) {
    const bytes = new TextEncoder().encode(JSON.stringify({
      message: writeError.message || "Unable to return the PostgreSQL response.",
      code: writeError.code || "PGWORKER",
    }));
    payload.set(bytes.subarray(0, MAX_RESPONSE_BYTES));
    Atomics.store(state, 1, Math.min(bytes.length, MAX_RESPONSE_BYTES));
    Atomics.store(state, 0, 2);
    Atomics.notify(state, 0);
  }
}

async function execute(message) {
  if (!connection) connection = client.connect();
  await connection;
  const result = await client.query(message.sql, message.parameters);
  respond(result);
}

parentPort.on("message", message => {
  if (message.close) {
    queue = queue.then(async () => {
      if (connection) await client.end();
    });
    return;
  }
  queue = queue.then(() => execute(message)).catch(error => respond(null, error));
});
