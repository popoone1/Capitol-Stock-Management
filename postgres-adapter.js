const { Worker } = require("node:worker_threads");
const path = require("node:path");

const HEADER_BYTES = 16;
const MAX_RESPONSE_BYTES = 32 * 1024 * 1024;
const QUERY_TIMEOUT_MS = 30_000;

function rewriteCaseInsensitiveComparisons(sql) {
  const comparison = /\b([\w.]+)\s*(=|<>|!=)\s*(\?|(?:'(?:''|[^'])*'))\s+COLLATE\s+NOCASE\b/gi;
  return sql
    .replace(comparison, (_match, column, operator, value) => `LOWER(${column}) ${operator} LOWER(${value})`)
    .replace(/\b([\w.]+)\s+COLLATE\s+NOCASE\b/gi, "LOWER($1)");
}

function translateSql(sql) {
  let text = rewriteCaseInsensitiveComparisons(String(sql).trim())
    .replace(/\bLIKE\b/gi, "ILIKE");
  if (/^BEGIN\s+IMMEDIATE$/i.test(text)) text = "BEGIN";
  const ignoreConflicts = /^\s*INSERT\s+OR\s+IGNORE\b/i.test(text);
  if (ignoreConflicts) text = text.replace(/^(\s*INSERT)\s+OR\s+IGNORE\b/i, "$1");

  let parameterIndex = 0;
  let output = "";
  let state = "normal";

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const next = text[index + 1];

    if (state === "single") {
      output += character;
      if (character === "'" && next === "'") {
        output += next;
        index += 1;
      } else if (character === "'") {
        state = "normal";
      }
      continue;
    }

    if (state === "double") {
      output += character;
      if (character === '"' && next === '"') {
        output += next;
        index += 1;
      } else if (character === '"') {
        state = "normal";
      }
      continue;
    }

    if (state === "line-comment") {
      output += character;
      if (character === "\n") state = "normal";
      continue;
    }

    if (state === "block-comment") {
      output += character;
      if (character === "*" && next === "/") {
        output += next;
        index += 1;
        state = "normal";
      }
      continue;
    }

    if (character === "'") {
      state = "single";
      output += character;
    } else if (character === '"') {
      state = "double";
      output += character;
    } else if (character === "-" && next === "-") {
      state = "line-comment";
      output += character + next;
      index += 1;
    } else if (character === "/" && next === "*") {
      state = "block-comment";
      output += character + next;
      index += 1;
    } else if (character === "?") {
      parameterIndex += 1;
      output += `$${parameterIndex}`;
    } else {
      output += character;
    }
  }

  if (ignoreConflicts) output = output.replace(/;\s*$/, "") + " ON CONFLICT DO NOTHING";
  return output;
}

class PostgresDatabase {
  constructor(connectionString, workerPath = path.join(__dirname, "postgres-worker.js")) {
    this.shared = new SharedArrayBuffer(HEADER_BYTES + MAX_RESPONSE_BYTES);
    this.state = new Int32Array(this.shared, 0, HEADER_BYTES / Int32Array.BYTES_PER_ELEMENT);
    this.payload = new Uint8Array(this.shared, HEADER_BYTES);
    this.worker = new Worker(workerPath, { workerData: { connectionString, shared: this.shared } });
    this.worker.on("error", error => {
      this.workerError = error;
    });
    this.worker.on("exit", code => {
      if (code !== 0) this.workerError = new Error(`PostgreSQL worker exited with code ${code}.`);
    });
  }

  query(sql, parameters = []) {
    if (this.workerError) throw this.workerError;
    Atomics.store(this.state, 0, 0);
    Atomics.store(this.state, 1, 0);
    this.worker.postMessage({ sql: translateSql(sql), parameters });

    const result = Atomics.wait(this.state, 0, 0, QUERY_TIMEOUT_MS);
    if (result === "timed-out") {
      const error = Object.assign(new Error(`PostgreSQL query exceeded ${QUERY_TIMEOUT_MS} ms.`), { code: "ETIMEDOUT" });
      this.workerError = error;
      this.worker.terminate();
      throw error;
    }

    const length = Atomics.load(this.state, 1);
    if (length < 0 || length > MAX_RESPONSE_BYTES) {
      throw new Error("PostgreSQL response exceeded the supported size.");
    }
    const response = JSON.parse(new TextDecoder().decode(this.payload.subarray(0, length)));
    if (Atomics.load(this.state, 0) === 2) {
      throw Object.assign(new Error(response.message), { code: response.code });
    }
    return response;
  }

  prepare(sql) {
    const database = this;
    return {
      all(...parameters) {
        return database.query(sql, parameters).rows;
      },
      get(...parameters) {
        return database.query(sql, parameters).rows[0];
      },
      run(...parameters) {
        const result = database.query(sql, parameters);
        return { changes: result.rowCount };
      },
    };
  }

  exec(sql) {
    const statements = splitStatements(sql);
    for (const statement of statements) this.query(statement);
  }

  close() {
    this.worker.postMessage({ close: true });
    this.worker.terminate();
  }
}

function splitStatements(sql) {
  const statements = [];
  let statement = "";
  let state = "normal";

  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index];
    const next = sql[index + 1];
    statement += character;

    if (state === "single") {
      if (character === "'" && next === "'") {
        statement += next;
        index += 1;
      } else if (character === "'") {
        state = "normal";
      }
    } else if (state === "double") {
      if (character === '"' && next === '"') {
        statement += next;
        index += 1;
      } else if (character === '"') {
        state = "normal";
      }
    } else if (state === "line-comment") {
      if (character === "\n") state = "normal";
    } else if (state === "block-comment") {
      if (character === "*" && next === "/") {
        statement += next;
        index += 1;
        state = "normal";
      }
    } else if (character === "'") {
      state = "single";
    } else if (character === '"') {
      state = "double";
    } else if (character === "-" && next === "-") {
      statement += next;
      index += 1;
      state = "line-comment";
    } else if (character === "/" && next === "*") {
      statement += next;
      index += 1;
      state = "block-comment";
    } else if (character === ";") {
      const trimmed = statement.trim();
      if (trimmed) statements.push(trimmed);
      statement = "";
    }
  }

  const trimmed = statement.trim();
  if (trimmed) statements.push(trimmed);
  return statements;
}

module.exports = { PostgresDatabase, splitStatements, translateSql };
