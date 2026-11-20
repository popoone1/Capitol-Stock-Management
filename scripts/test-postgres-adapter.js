const assert = require("node:assert/strict");
const { splitStatements, translateSql } = require("../postgres-adapter");

assert.equal(
  translateSql("SELECT id FROM items WHERE sku = ? COLLATE NOCASE"),
  "SELECT id FROM items WHERE LOWER(sku) = LOWER($1)",
);
assert.equal(
  translateSql("SELECT * FROM items WHERE name LIKE ? ORDER BY name COLLATE NOCASE"),
  "SELECT * FROM items WHERE name ILIKE $1 ORDER BY LOWER(name)",
);
assert.equal(
  translateSql("SELECT '?' AS literal, ? AS value -- ? stays a comment\n"),
  "SELECT '?' AS literal, $1 AS value -- ? stays a comment",
);
assert.equal(
  translateSql("INSERT OR IGNORE INTO categories (id, name) VALUES (?, ?);"),
  "INSERT INTO categories (id, name) VALUES ($1, $2) ON CONFLICT DO NOTHING",
);
assert.deepEqual(
  splitStatements("DELETE FROM a; INSERT INTO b VALUES ('x;y'); /* ; */ DELETE FROM c"),
  ["DELETE FROM a;", "INSERT INTO b VALUES ('x;y');", "/* ; */ DELETE FROM c"],
);
assert.equal(translateSql("BEGIN IMMEDIATE"), "BEGIN");

console.log("PostgreSQL adapter translation checks passed.");
