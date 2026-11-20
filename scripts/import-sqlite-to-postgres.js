const crypto = require("node:crypto");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { Client, types } = require("pg");

types.setTypeParser(20, value => Number(value));

const sourcePath = process.env.CAPITOL_SQLITE_PATH || path.join(__dirname, "..", "data", "capitol-stock.sqlite");
const connectionString = process.env.DATABASE_URL;
const tables = [
  ["users", ["id"]],
  ["locations", ["id"]],
  ["categories", ["id"]],
  ["departments", ["id"]],
  ["housekeeping_areas", ["id"]],
  ["requesters", ["id"]],
  ["items", ["id"]],
  ["inventory_columns", ["id"]],
  ["inventory_column_values", ["item_id", "column_id"]],
  ["batches", ["id"]],
  ["stock_transactions", ["id"]],
  ["water_records", ["id"]],
  ["settings", ["key"]],
  ["audit_log", ["id"]],
];

function assertSafeIdentifier(identifier) {
  if (!/^[a-z_]+$/.test(identifier)) throw new Error(`Unsupported database identifier: ${identifier}`);
  return `"${identifier}"`;
}

function rowHash(rows, columns) {
  const hash = crypto.createHash("sha256");
  for (const row of rows) {
    hash.update(JSON.stringify(columns.map(column => row[column])));
    hash.update("\n");
  }
  return hash.digest("hex");
}

async function main() {
  if (!connectionString) throw new Error("Set DATABASE_URL to the Supabase PostgreSQL connection string before importing.");
  const source = new DatabaseSync(sourcePath, { readOnly: true });
  const target = new Client({
    connectionString,
    application_name: "capitol-stock-migration",
    connectionTimeoutMillis: 10_000,
    statement_timeout: 60_000,
  });
  let targetConnected = false;
  let transactionStarted = false;

  try {
    const integrity = source.prepare("PRAGMA integrity_check").get();
    if (integrity.integrity_check !== "ok") throw new Error("The source SQLite database failed its integrity check.");
    const foreignKeyViolations = source.prepare("PRAGMA foreign_key_check").all();
    if (foreignKeyViolations.length) throw new Error("The source SQLite database contains foreign-key violations.");

    await target.connect();
    targetConnected = true;
    await target.query("BEGIN");
    transactionStarted = true;
    const nonEmptyTargets = [];
    for (const [table] of tables) {
      const { rows } = await target.query(`SELECT COUNT(*) AS count FROM ${assertSafeIdentifier(table)}`);
      if (Number(rows[0].count) !== 0) nonEmptyTargets.push(table);
    }
    if (nonEmptyTargets.length) {
      throw new Error(`Import stopped without changing the target; these tables are not empty: ${nonEmptyTargets.join(", ")}.`);
    }
    const loginAttemptCount = Number((await target.query("SELECT COUNT(*) AS count FROM login_attempts")).rows[0].count);
    if (loginAttemptCount !== 0) throw new Error("Import stopped without changing the target; login-attempt records already exist.");

    const results = [];
    for (const [table, orderBy] of tables) {
      const quotedTable = assertSafeIdentifier(table);
      const orderClause = orderBy.map(assertSafeIdentifier).join(", ");
      const rows = source.prepare(`SELECT * FROM ${quotedTable} ORDER BY ${orderClause}`).all();
      const columns = rows.length
        ? Object.keys(rows[0])
        : source.prepare(`PRAGMA table_info(${quotedTable})`).all().map(column => column.name);
      const columnList = columns.map(assertSafeIdentifier).join(", ");

      for (let offset = 0; offset < rows.length; offset += 100) {
        const batch = rows.slice(offset, offset + 100);
        const parameters = [];
        const valueRows = batch.map(row => {
          const placeholders = columns.map(column => {
            parameters.push(row[column]);
            return `$${parameters.length}`;
          });
          return `(${placeholders.join(", ")})`;
        });
        if (valueRows.length) {
          await target.query(
            `INSERT INTO ${quotedTable} (${columnList}) VALUES ${valueRows.join(", ")}`,
            parameters,
          );
        }
      }

      const importedRows = (await target.query(
        `SELECT ${columnList} FROM ${quotedTable} ORDER BY ${orderClause}`,
      )).rows;
      if (importedRows.length !== rows.length || rowHash(importedRows, columns) !== rowHash(rows, columns)) {
        throw new Error(`Verification failed for ${table}; the import transaction will be rolled back.`);
      }
      if (table === "users" && rows.length) {
        await target.query("UPDATE users SET password_reset_required = 1");
      }
      results.push({ table, rows: rows.length, verified: true });
    }

    await target.query("COMMIT");
    transactionStarted = false;
    console.log(JSON.stringify({ source: sourcePath, tables: results }, null, 2));
  } catch (error) {
    if (transactionStarted) {
      try {
        await target.query("ROLLBACK");
      } catch {
        console.error("The import transaction could not be rolled back cleanly; inspect PostgreSQL before retrying.");
      }
    }
    throw error;
  } finally {
    source.close();
    if (targetConnected) await target.end();
  }
}

main().catch(error => {
  console.error(`SQLite-to-Supabase migration failed: ${error.message}`);
  process.exitCode = 1;
});
