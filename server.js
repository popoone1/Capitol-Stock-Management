const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");
const { PostgresDatabase } = require("./postgres-adapter");

const ROOT = __dirname;
const DATA_DIR = process.env.CAPITOL_DATA_DIR || path.join(ROOT, "data");
const DB_PATH = path.join(DATA_DIR, "capitol-stock.sqlite");
const PORT = Number(process.env.PORT || 8766);
const usePostgres = Boolean(process.env.DATABASE_URL);
if (process.env.NODE_ENV === "production" && !usePostgres) {
  throw new Error("DATABASE_URL is required in production; refusing to start with a local SQLite database.");
}
const HOST = usePostgres ? "0.0.0.0" : "127.0.0.1";
const SESSION_COOKIE = "capitol_session";
const SESSION_MS = 8 * 60 * 60 * 1000;
const DEFAULT_CATEGORIES = ["Dry", "Chemical", "Protein", "Fruit", "Vegetable", "Other"];
const DEFAULT_STORES = ["Dry Store", "Chemical Store", "Protein Store", "Fruit Store", "Vegetable Store", "Frozen Store"];
const APPEARANCE_FONTS = {
  inter: "Inter",
  manrope: "Manrope",
  "dm-sans": "DM Sans",
  roboto: "Roboto",
  lato: "Lato",
  "source-sans-3": "Source Sans 3",
  "nunito-sans": "Nunito Sans",
  "ibm-plex-sans": "IBM Plex Sans",
  merriweather: "Merriweather",
  lora: "Lora",
  "atkinson-hyperlegible": "Atkinson Hyperlegible",
};
const APPEARANCE_COLOR_DEFAULTS = {
  light: {
    text: "#000000", muted: "#000000", heading: "#000000",
    background: "#f4f7fb", surface: "#ffffff", border: "#d8e0e9",
    accent: "#168b78", accentStrong: "#116a5d",
  },
  dark: {
    text: "#ffffff", muted: "#ffffff", heading: "#ffffff",
    background: "#0b1220", surface: "#141e2e", border: "#334155",
    accent: "#4ad6b5", accentStrong: "#178f7c",
  },
};
const APPEARANCE_COLOR_FIELDS = ["text", "muted", "heading", "background", "surface", "border", "accent", "accentStrong"];
const APPEARANCE_FONT_WEIGHTS = ["400", "500", "600", "700", "800"];
const LEGACY_STORE_NAMES = new Map([
  ["Main Store", "Protein Store"],
  ["Kitchen Store", "Fruit Store"],
  ["Cold Room", "Vegetable Store"],
]);
const STORE_BY_CATEGORY = new Map([
  ["dry", "Dry Store"],
  ["chemical", "Chemical Store"],
  ["protein", "Protein Store"],
  ["fruit", "Fruit Store"],
  ["vegetable", "Vegetable Store"],
]);
const DEFAULT_DEPARTMENTS = [
  { id: "dept-chef", name: "Chef", kind: "standard" },
  { id: "dept-cook", name: "Cook", kind: "standard" },
  { id: "dept-mess", name: "Mess", kind: "standard" },
  { id: "dept-pantry", name: "Pantry", kind: "standard" },
  { id: "dept-housekeeping", name: "Housekeeping", kind: "housekeeping" },
  { id: "dept-laundry", name: "Laundry", kind: "standard" },
  { id: "dept-expiry", name: "Expiry", kind: "expiry" },
  { id: "dept-spoilage", name: "Spoilage", kind: "spoilage" },
];
const DEPARTMENT_PEOPLE = {
  Chef: ["Togbe", "Prosper"],
  Cook: ["Regina", "Lizzy", "Abigail"],
  Mess: ["Patience", "Jennifer", "Vivian Danqua"],
  Pantry: ["Patrick", "Emmanuel"],
  Housekeeping: ["Grace", "Vivian Ackah", "Abigail Osei", "Sarah Ebo", "Vida Baffoe", "Rebbeca"],
  Laundry: ["Kemese", "Nyonrah"],
  Expiry: [],
  Spoilage: [],
};
const DEFAULT_AREAS = [
  ...Array.from({ length: 41 }, (_, index) => `Room ${index + 1}`),
  "General Wash Room Male",
  "General Wash Room Female",
  "Gym",
  "Recreational",
  "Pilot Gatehouse",
  "Local Content Office",
  "General Cleaning",
];
const WATER_STAFF = ["Gardeners", "Weeders", "Kelvin", "Regina", "Mess"];
const WATER_ROOMS = Array.from({ length: 41 }, (_, index) => `Room ${index + 1}`);
const WATER_RECIPIENTS = [...WATER_ROOMS, ...WATER_STAFF];
const WATER_REQUESTERS = [
  "Kelvin",
  "Camp Boss",
  "Abigail Osei",
  "Vivian Ackah",
  "Grace Ewulenzi",
  "Celestine",
  "Sarah Ebo",
  "Matthew Armah",
];
const WATER_EXEMPT = new Set([28, 29, 30, 31, 32, 36, 38, 39].map(number => `Room ${number}`));
let db;
if (usePostgres) {
  db = new PostgresDatabase(process.env.DATABASE_URL);
} else {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  db = new DatabaseSync(DB_PATH);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
}
if (!usePostgres) {
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'user', 'auditor')),
    password_salt TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS locations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
  );
  CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
  );
  CREATE TABLE IF NOT EXISTS departments (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    kind TEXT NOT NULL DEFAULT 'standard' CHECK (kind IN ('standard', 'housekeeping', 'expiry', 'spoilage')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS housekeeping_areas (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS requesters (
    id TEXT PRIMARY KEY,
    scope TEXT NOT NULL CHECK (scope IN ('water', 'stock')),
    department TEXT NOT NULL DEFAULT '',
    name TEXT NOT NULL COLLATE NOCASE,
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    UNIQUE (scope, department, name)
  );
  CREATE TABLE IF NOT EXISTS items (
    id TEXT PRIMARY KEY,
    sku TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    store TEXT NOT NULL DEFAULT 'Dry Store',
    unit TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    reorder_level REAL NOT NULL DEFAULT 0 CHECK (reorder_level >= 0),
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS inventory_columns (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS inventory_column_values (
    item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    column_id TEXT NOT NULL REFERENCES inventory_columns(id) ON DELETE CASCADE,
    value TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (item_id, column_id)
  );
  CREATE TABLE IF NOT EXISTS batches (
    id TEXT PRIMARY KEY,
    item_id TEXT NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
    location_id TEXT NOT NULL REFERENCES locations(id) ON DELETE RESTRICT,
    batch_number TEXT NOT NULL DEFAULT '',
    supplier TEXT NOT NULL DEFAULT '',
    purchase_reference TEXT NOT NULL DEFAULT '',
    unit_cost REAL NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
    quantity_received REAL NOT NULL CHECK (quantity_received > 0),
    quantity_remaining REAL NOT NULL CHECK (quantity_remaining >= 0),
    received_at TEXT NOT NULL,
    expiry_date TEXT
  );
  CREATE TABLE IF NOT EXISTS stock_transactions (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('receipt', 'issue', 'adjustment', 'expiry', 'spoilage', 'requisition')),
    item_id TEXT REFERENCES items(id) ON DELETE SET NULL,
    item_sku TEXT NOT NULL,
    item_name TEXT NOT NULL,
    batch_id TEXT REFERENCES batches(id) ON DELETE SET NULL,
    location_id TEXT REFERENCES locations(id) ON DELETE SET NULL,
    location_name TEXT NOT NULL,
    quantity REAL NOT NULL CHECK (quantity <> 0),
    unit TEXT NOT NULL,
    department TEXT NOT NULL DEFAULT '',
    person TEXT NOT NULL DEFAULT '',
    area TEXT NOT NULL DEFAULT '',
    issued_by TEXT NOT NULL DEFAULT '',
    supplier TEXT NOT NULL DEFAULT '',
    purchase_reference TEXT NOT NULL DEFAULT '',
    reason TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    request_date TEXT NOT NULL,
    expires_on TEXT,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    voided_at TEXT,
    voided_by TEXT,
    void_reason TEXT NOT NULL DEFAULT '',
    reversal_of TEXT,
    request_group_id TEXT
  );
  CREATE TABLE IF NOT EXISTS water_records (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL,
    recipient TEXT NOT NULL,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    requested_by TEXT NOT NULL,
    issued_by TEXT NOT NULL,
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS audit_log (
    id TEXT PRIMARY KEY,
    actor_id TEXT,
    actor_name TEXT NOT NULL,
    action TEXT NOT NULL,
    detail TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_batches_item_location ON batches(item_id, location_id);
  CREATE INDEX IF NOT EXISTS idx_batches_expiry ON batches(expiry_date);
  CREATE INDEX IF NOT EXISTS idx_transactions_date ON stock_transactions(created_at);
  CREATE INDEX IF NOT EXISTS idx_transactions_item ON stock_transactions(item_id);
  CREATE INDEX IF NOT EXISTS idx_water_date_recipient ON water_records(date, recipient);
  CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);
`);

const itemColumns = new Set(db.prepare("PRAGMA table_info(items)").all().map(column => column.name));
if (!itemColumns.has("store")) {
  transaction(() => {
    db.exec("ALTER TABLE items ADD COLUMN store TEXT NOT NULL DEFAULT 'Dry Store'");
    for (const [category, store] of STORE_BY_CATEGORY) {
      db.prepare("UPDATE items SET store = ? WHERE lower(trim(category)) = ?").run(store, category);
    }
  });
}

const userTableSql = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'").get()?.sql || "";
if (!userTableSql.includes("'auditor'")) {
  transaction(() => {
    db.exec(`
      CREATE TABLE users_with_auditor (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE COLLATE NOCASE,
        display_name TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('admin', 'user', 'auditor')),
        password_salt TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
        created_at TEXT NOT NULL
      );
      INSERT INTO users_with_auditor SELECT * FROM users;
      DROP TABLE users;
      ALTER TABLE users_with_auditor RENAME TO users;
    `);
  });
}
const transactionColumns = new Set(db.prepare("PRAGMA table_info(stock_transactions)").all().map(column => column.name));
if (!transactionColumns.has("voided_at")) db.exec("ALTER TABLE stock_transactions ADD COLUMN voided_at TEXT");
if (!transactionColumns.has("voided_by")) db.exec("ALTER TABLE stock_transactions ADD COLUMN voided_by TEXT");
if (!transactionColumns.has("void_reason")) db.exec("ALTER TABLE stock_transactions ADD COLUMN void_reason TEXT NOT NULL DEFAULT ''");
if (!transactionColumns.has("reversal_of")) db.exec("ALTER TABLE stock_transactions ADD COLUMN reversal_of TEXT");
if (!transactionColumns.has("request_group_id")) db.exec("ALTER TABLE stock_transactions ADD COLUMN request_group_id TEXT");

for (const name of DEFAULT_CATEGORIES) {
  db.prepare("INSERT OR IGNORE INTO categories (id, name) VALUES (?, ?)").run(crypto.randomUUID(), name);
}
for (const name of db.prepare("SELECT DISTINCT category FROM items WHERE trim(category) <> ''").all().map(row => row.category)) {
  db.prepare("INSERT OR IGNORE INTO categories (id, name) VALUES (?, ?)").run(crypto.randomUUID(), name);
}
if (!db.prepare("SELECT 1 FROM settings WHERE key = 'departments_areas_seed_v1'").get()) {
  transaction(() => {
    const insertDepartment = db.prepare(`
      INSERT OR IGNORE INTO departments (id, name, kind, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const department of DEFAULT_DEPARTMENTS) {
      insertDepartment.run(department.id, department.name, department.kind, nowIso(), nowIso());
    }
    const insertArea = db.prepare(`
      INSERT OR IGNORE INTO housekeeping_areas (id, name, created_at, updated_at)
      VALUES (?, ?, ?, ?)
    `);
    for (const name of DEFAULT_AREAS) insertArea.run(crypto.randomUUID(), name, nowIso(), nowIso());
    db.prepare("INSERT INTO settings (key, value) VALUES ('departments_areas_seed_v1', '1')").run();
  });
}
for (const name of WATER_REQUESTERS) {
  db.prepare("INSERT OR IGNORE INTO requesters (id, scope, department, name) VALUES (?, 'water', '', ?)").run(crypto.randomUUID(), name);
}
if (!db.prepare("SELECT 1 FROM settings WHERE key = 'stock_requesters_seed_v1'").get()) {
  transaction(() => {
    const departments = new Set(getDepartments());
    for (const [department, names] of Object.entries(DEPARTMENT_PEOPLE)) {
      if (!departments.has(department)) continue;
      for (const name of names) {
        db.prepare("INSERT OR IGNORE INTO requesters (id, scope, department, name) VALUES (?, 'stock', ?, ?)")
          .run(crypto.randomUUID(), department, name);
      }
    }
    db.prepare("INSERT INTO settings (key, value) VALUES ('stock_requesters_seed_v1', '1')").run();
  });
}
if (!db.prepare("SELECT 1 FROM settings WHERE key = 'requester_vivian_danqua_migration_v1'").get()) {
  transaction(() => {
    const obsolete = db.prepare(`
      SELECT id, scope, department, name FROM requesters
      WHERE scope = 'stock' AND department = 'Mess'
        AND lower(trim(name)) IN ('jacqueline', 'jackqueline')
    `).all();
    for (const requester of obsolete) {
      const replacement = db.prepare(`
        SELECT id FROM requesters
        WHERE scope = ? AND department = ? AND name = 'Vivian Danqua' COLLATE NOCASE
      `).get(requester.scope, requester.department);
      if (replacement) db.prepare("DELETE FROM requesters WHERE id = ?").run(requester.id);
      else db.prepare("UPDATE requesters SET name = 'Vivian Danqua', active = 1 WHERE id = ?").run(requester.id);
    }
    db.prepare("INSERT INTO settings (key, value) VALUES ('requester_vivian_danqua_migration_v1', '1')").run();
  });
}
if (!db.prepare("SELECT 1 FROM settings WHERE key = 'inventory_descriptions_removed_v1'").get()) {
  transaction(() => {
    db.prepare("UPDATE items SET description = '' WHERE description <> ''").run();
    db.prepare("INSERT INTO settings (key, value) VALUES ('inventory_descriptions_removed_v1', '1')").run();
  });
}

if (!db.prepare("SELECT 1 FROM settings WHERE key = 'inventory_store_migration_v2'").get()) {
  transaction(() => {
    for (const [oldName, newName] of LEGACY_STORE_NAMES) {
      const oldLocation = db.prepare("SELECT id FROM locations WHERE name = ? COLLATE NOCASE").get(oldName);
      if (!oldLocation) continue;
      const newLocation = db.prepare("SELECT id FROM locations WHERE name = ? COLLATE NOCASE").get(newName);
      if (newLocation) {
        db.prepare("UPDATE batches SET location_id = ? WHERE location_id = ?").run(newLocation.id, oldLocation.id);
        db.prepare("UPDATE stock_transactions SET location_id = ? WHERE location_id = ?").run(newLocation.id, oldLocation.id);
        db.prepare("DELETE FROM locations WHERE id = ?").run(oldLocation.id);
      } else {
        db.prepare("UPDATE locations SET name = ? WHERE id = ?").run(newName, oldLocation.id);
      }
      db.prepare("UPDATE items SET store = ? WHERE store = ? COLLATE NOCASE").run(newName, oldName);
    }
    for (const name of DEFAULT_STORES) {
      db.prepare("INSERT OR IGNORE INTO locations (id, name) VALUES (?, ?)").run(crypto.randomUUID(), name);
      db.prepare("UPDATE locations SET active = 1 WHERE name = ? COLLATE NOCASE").run(name);
    }
    db.prepare("INSERT INTO settings (key, value) VALUES ('inventory_store_migration_v2', '1')").run();
  });
}
}

db.exec(`
  CREATE TABLE IF NOT EXISTS inventory_month_archives (
    month TEXT PRIMARY KEY,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL
  )
`);
db.exec(`
  CREATE TABLE IF NOT EXISTS requests_month_archives (
    month TEXT PRIMARY KEY,
    payload TEXT NOT NULL,
    created_at TEXT NOT NULL
  )
`);
if (usePostgres) {
  db.exec("ALTER TABLE inventory_month_archives ENABLE ROW LEVEL SECURITY");
  db.exec("REVOKE ALL ON TABLE inventory_month_archives FROM anon, authenticated");
  db.exec("ALTER TABLE requests_month_archives ENABLE ROW LEVEL SECURITY");
  db.exec("REVOKE ALL ON TABLE requests_month_archives FROM anon, authenticated");
}

if (!db.prepare("SELECT 1 FROM settings WHERE key = 'inventory_store_migration_v3'").get()) {
  transaction(() => {
    for (const name of DEFAULT_STORES) {
      db.prepare("INSERT INTO locations (id, name) VALUES (?, ?) ON CONFLICT DO NOTHING")
        .run(crypto.randomUUID(), name);
      db.prepare("UPDATE locations SET active = 1 WHERE name = ? COLLATE NOCASE").run(name);
    }
    db.prepare("INSERT INTO settings (key, value) VALUES ('inventory_store_migration_v3', '1')").run();
  });
}

reconcileStockBatches();

const sessions = new Map();
const loginAttempts = new Map();
let gmailAppPassword = "";
let mailer;
let mailerAddress = "";

function nowIso() {
  return new Date().toISOString();
}

function todayKey() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function isDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function dateDiff(first, second) {
  const [y1, m1, d1] = first.split("-").map(Number);
  const [y2, m2, d2] = second.split("-").map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
}

function finitePositive(value, label) {
  const quantity = Number(value);
  if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 1_000_000_000) {
    throw httpError(400, `${label} must be a positive number no greater than 1,000,000,000.`);
  }
  return quantity;
}

function optionalDate(value, label) {
  if (value === undefined || value === null || value === "") return null;
  if (!isDate(value)) throw httpError(400, `${label} must be a valid YYYY-MM-DD date.`);
  return value;
}

function httpError(statusCode, message) {
  return Object.assign(new Error(message), { statusCode });
}

function isUniqueConstraintError(error) {
  return error.code === "23505" || (error.code === "ERR_SQLITE_ERROR" && /UNIQUE constraint failed/i.test(error.message));
}

function validateEmail(value) {
  return typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function transaction(work) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = work();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function addAudit(actor, action, detail) {
  db.prepare(`
    INSERT INTO audit_log (id, actor_id, actor_name, action, detail, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(crypto.randomUUID(), actor?.id || null, actor?.display_name || "System", action, String(detail).slice(0, 2000), nowIso());
}

function passwordHash(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString("hex");
}

function passwordMatches(password, salt, expectedHash) {
  const actual = Buffer.from(passwordHash(password, salt), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function parseCookies(request) {
  const cookies = {};
  for (const part of String(request.headers.cookie || "").split(";")) {
    const separator = part.indexOf("=");
    if (separator <= 0) continue;
    cookies[part.slice(0, separator).trim()] = decodeURIComponent(part.slice(separator + 1).trim());
  }
  return cookies;
}

function currentSession(request) {
  const sessionId = parseCookies(request)[SESSION_COOKIE];
  if (!sessionId) return null;
  const session = sessions.get(sessionId);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    sessions.delete(sessionId);
    return null;
  }
  return session;
}

function setSessionCookie(response, id) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  response.setHeader("Set-Cookie", `${SESSION_COOKIE}=${encodeURIComponent(id)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(SESSION_MS / 1000)}${secure}`);
}

function clearSessionCookie(response) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  response.setHeader("Set-Cookie", `${SESSION_COOKIE}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${secure}`);
}

function ensureSameOrigin(request) {
  const origin = request.headers.origin;
  const forwardedHost = String(request.headers["x-forwarded-host"] || request.headers.host || "").split(",")[0].trim();
  const forwardedProto = String(request.headers["x-forwarded-proto"] || "http").split(",")[0].trim();
  const requestOrigin = `${forwardedProto}://${forwardedHost}`;
  if (origin && origin !== requestOrigin && origin !== `http://127.0.0.1:${PORT}` && origin !== `http://localhost:${PORT}`) {
    throw httpError(403, "Cross-origin requests are not allowed.");
  }
}

function requireSession(request, csrf = false) {
  const session = currentSession(request);
  if (!session) throw httpError(401, "Your session has expired. Sign in again.");
  if (csrf) {
    ensureSameOrigin(request);
    if (request.headers["x-csrf-token"] !== session.csrfToken) {
      throw httpError(403, "Your session token is invalid. Refresh and try again.");
    }
  }
  const user = db.prepare("SELECT role, active FROM users WHERE id = ?").get(session.userId);
  if (!user || !user.active) {
    sessions.delete(parseCookies(request)[SESSION_COOKIE]);
    throw httpError(401, "This account is disabled. Contact an administrator.");
  }
  session.role = user.role;
  return session;
}

function requireAdmin(request, csrf = false) {
  const session = requireSession(request, csrf);
  if (session.role !== "admin") throw httpError(403, "Administrator access is required.");
  return session;
}

function requireNonAuditor(request, csrf = false) {
  const session = requireSession(request, csrf);
  if (session.role === "auditor") throw httpError(403, "Auditor accounts are read-only.");
  return session;
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    let tooLarge = false;
    request.setEncoding("utf8");
    request.on("data", chunk => {
      if (tooLarge) return;
      body += chunk;
      if (Buffer.byteLength(body, "utf8") > 1_000_000) {
        body = "";
        tooLarge = true;
      }
    });
    request.on("end", () => {
      if (tooLarge) return reject(httpError(413, "Request body is too large."));
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(httpError(400, "Request body must be valid JSON."));
      }
    });
    request.on("error", reject);
  });
}

function sendJson(response, status, value, headers = {}) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...headers,
  });
  response.end(JSON.stringify(value));
}

function userView(user) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.display_name,
    role: user.role,
    active: Boolean(user.active),
    passwordResetRequired: Boolean(user.password_reset_required),
    createdAt: user.created_at,
  };
}

function countAdmins() {
  return db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin' AND active = 1").get().count;
}

function getCategories(includeInactive = false) {
  return db.prepare(`SELECT id, name, active FROM categories ${includeInactive ? "" : "WHERE active = 1"} ORDER BY name COLLATE NOCASE`)
    .all().map(row => ({ ...row, active: Boolean(row.active) }));
}

function getDepartmentRecords() {
  return db.prepare("SELECT id, name, kind FROM departments ORDER BY created_at, name COLLATE NOCASE").all();
}

function getDepartments() {
  return getDepartmentRecords().map(department => department.name);
}

function departmentByName(name) {
  return db.prepare("SELECT id, name, kind FROM departments WHERE name = ? COLLATE NOCASE").get(name);
}

function getHousekeepingAreas() {
  return db.prepare("SELECT id, name FROM housekeeping_areas ORDER BY name COLLATE NOCASE").all();
}

function getAreas() {
  return getHousekeepingAreas().map(area => area.name);
}

function getPeople() {
  const people = {};
  for (const department of getDepartments()) people[department] = [];
  for (const row of db.prepare("SELECT department, name FROM requesters WHERE scope = 'stock' AND active = 1 ORDER BY name COLLATE NOCASE").all()) {
    if (people[row.department]) people[row.department].push(row.name);
  }
  return people;
}

function getWaterRequesters() {
  return db.prepare("SELECT name FROM requesters WHERE scope = 'water' AND active = 1 ORDER BY name COLLATE NOCASE")
    .all().map(row => row.name);
}

function getSettings() {
  const rows = db.prepare("SELECT key, value FROM settings").all();
  return Object.fromEntries(rows.map(row => [row.key, row.value]));
}

function getAppearanceSettings(settings = getSettings()) {
  const savedWeight = settings.appearanceWeight || "700";
  const fontWeight = savedWeight === "bold" ? "700" : savedWeight === "normal" ? "500" : savedWeight;
  const savedScale = Number(settings.appearanceFontScale || 1);
  return {
    fontFamily: Object.hasOwn(APPEARANCE_FONTS, settings.appearanceFont) ? settings.appearanceFont : "inter",
    fontWeight: APPEARANCE_FONT_WEIGHTS.includes(fontWeight) ? fontWeight : "700",
    fontScale: Number.isFinite(savedScale) && savedScale >= 0.75 && savedScale <= 1.75 ? savedScale : 1,
    style: settings.appearanceStyle === "classic" ? "classic" : "glass",
    themes: Object.fromEntries(Object.entries(APPEARANCE_COLOR_DEFAULTS).map(([theme, defaults]) => [
      theme,
      Object.fromEntries(APPEARANCE_COLOR_FIELDS.map(field => {
        const value = settings[`appearance_${theme}_${field}`];
        return [field, /^#[0-9a-f]{6}$/i.test(value || "") ? value : defaults[field]];
      })),
    ])),
  };
}

function getInventoryColumns(includeInactive = false) {
  return db.prepare(`
    SELECT id, name, active
    FROM inventory_columns
    ${includeInactive ? "" : "WHERE active = 1"}
    ORDER BY created_at, name COLLATE NOCASE
  `).all().map(row => ({ ...row, active: Boolean(row.active) }));
}

const RESERVED_INVENTORY_COLUMN_NAMES = new Set([
  "sku", "item", "previous month stock quantity", "received stock quantity",
  "current quantity", "removed", "remainder", "status", "actions", "store",
  "category", "live on hand", "unit",
]);

function validateInventoryColumnName(value) {
  const name = String(value || "").trim();
  if (name.length < 2 || name.length > 60) throw httpError(400, "Column name must be 2–60 characters.");
  if (RESERVED_INVENTORY_COLUMN_NAMES.has(name.toLocaleLowerCase())) {
    throw httpError(400, "That name is reserved for a built-in inventory column.");
  }
  return name;
}

function addInventoryColumn(body, actor) {
  const name = validateInventoryColumnName(body?.name);
  const id = crypto.randomUUID();
  const now = nowIso();
  try {
    db.prepare("INSERT INTO inventory_columns (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)")
      .run(id, name, now, now);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw httpError(409, "An inventory column with that name already exists.");
    }
    throw error;
  }
  addAudit(actor, "inventory.column.create", name);
  return getInventoryColumns(true).find(column => column.id === id);
}

function updateInventoryColumn(id, body, actor) {
  const column = db.prepare("SELECT * FROM inventory_columns WHERE id = ?").get(id);
  if (!column) throw httpError(404, "Inventory column not found.");
  const name = validateInventoryColumnName(body?.name);
  const active = body.active === undefined ? Boolean(column.active) : body.active !== false;
  try {
    db.prepare("UPDATE inventory_columns SET name = ?, active = ?, updated_at = ? WHERE id = ?")
      .run(name, active ? 1 : 0, nowIso(), id);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw httpError(409, "An inventory column with that name already exists.");
    }
    throw error;
  }
  addAudit(actor, "inventory.column.update", `${column.name} → ${name}; ${active ? "enabled" : "disabled"}`);
  return getInventoryColumns(true).find(entry => entry.id === id);
}

function deleteInventoryColumn(id, actor) {
  const column = db.prepare("SELECT id, name FROM inventory_columns WHERE id = ?").get(id);
  if (!column) throw httpError(404, "Inventory column not found.");
  db.prepare("DELETE FROM inventory_columns WHERE id = ?").run(id);
  addAudit(actor, "inventory.column.delete", column.name);
  return { deleted: true };
}

function saveInventoryColumnValues(itemId, values) {
  if (values === undefined) return;
  if (!values || typeof values !== "object" || Array.isArray(values)) {
    throw httpError(400, "Inventory column values must be an object.");
  }
  const columns = getInventoryColumns();
  const permitted = new Set(columns.map(column => column.id));
  const entries = Object.entries(values);
  if (entries.length > columns.length || entries.some(([id]) => !permitted.has(id))) {
    throw httpError(400, "One or more inventory columns are unavailable.");
  }
  const save = db.prepare(`
    INSERT INTO inventory_column_values (item_id, column_id, value)
    VALUES (?, ?, ?)
    ON CONFLICT(item_id, column_id) DO UPDATE SET value = excluded.value
  `);
  for (const [id, rawValue] of entries) {
    const value = String(rawValue ?? "").trim();
    if (value.length > 500) throw httpError(400, "Inventory column values may not exceed 500 characters.");
    save.run(itemId, id, value);
  }
}

function stockBalance(itemId, locationId = null) {
  const row = locationId
    ? db.prepare("SELECT COALESCE(SUM(quantity_remaining), 0) AS quantity FROM batches WHERE item_id = ? AND location_id = ?").get(itemId, locationId)
    : db.prepare("SELECT COALESCE(SUM(quantity_remaining), 0) AS quantity FROM batches WHERE item_id = ?").get(itemId);
  return Number(row.quantity);
}

function previousMonthStock(itemId) {
  const monthStart = `${todayKey().slice(0, 7)}-01`;
  const row = db.prepare(`
    SELECT COALESCE(SUM(quantity), 0) AS quantity
    FROM stock_transactions
    WHERE item_id = ? AND request_date < ? AND voided_at IS NULL AND reversal_of IS NULL
  `).get(itemId, monthStart);
  return Number(row.quantity);
}

function previousMonthKey(month) {
  const [year, number] = month.split("-").map(Number);
  return number === 1 ? `${year - 1}-12` : `${year}-${String(number - 1).padStart(2, "0")}`;
}

function inventoryMonthArchive(month) {
  const row = db.prepare("SELECT payload, created_at FROM inventory_month_archives WHERE month = ?").get(month);
  return row ? { ...JSON.parse(row.payload), created_at: row.created_at } : null;
}

function buildInventoryMonthArchive(month) {
  const monthStart = `${month}-01`;
  const [year, monthNumber] = month.split("-").map(Number);
  const monthEnd = new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10);
  const metrics = db.prepare(`
    SELECT item_id,
      COALESCE(SUM(CASE WHEN request_date < ? THEN quantity ELSE 0 END), 0) AS previous_month_quantity,
      COALESCE(SUM(CASE WHEN request_date >= ? AND request_date <= ? AND quantity > 0 THEN quantity ELSE 0 END), 0) AS received_stock_quantity,
      COALESCE(SUM(CASE WHEN request_date >= ? AND request_date <= ? AND quantity < 0 THEN -quantity ELSE 0 END), 0) AS removed
    FROM stock_transactions
    WHERE voided_at IS NULL AND reversal_of IS NULL AND request_date <= ?
    GROUP BY item_id
  `).all(monthStart, monthStart, monthEnd, monthStart, monthEnd, monthEnd);
  const metricsByItem = new Map(metrics.map(row => [row.item_id, row]));
  const columns = getInventoryColumns();
  const customValues = new Map();
  for (const value of db.prepare(`
    SELECT item_id, column_id, value
    FROM inventory_column_values
    WHERE column_id IN (SELECT id FROM inventory_columns WHERE active = 1)
  `).all()) {
    const values = customValues.get(value.item_id) || {};
    values[value.column_id] = value.value;
    customValues.set(value.item_id, values);
  }
  const items = db.prepare(`
    SELECT id, sku, name, category, store, unit, active
    FROM items
    ORDER BY name COLLATE NOCASE
  `).all().map(item => {
    const row = metricsByItem.get(item.id);
    const previousMonthQuantity = Number(row?.previous_month_quantity || 0);
    const receivedStockQuantity = Number(row?.received_stock_quantity || 0);
    const removed = Number(row?.removed || 0);
    const currentQuantity = previousMonthQuantity + receivedStockQuantity;
    const remainder = Math.max(0, currentQuantity - removed);
    const statusPercent = currentQuantity > 0 ? Math.min(100, remainder / currentQuantity * 100) : 0;
    const statusColor = statusPercent >= 80 ? "good" :
      statusPercent >= 20 && statusPercent <= 70 ? "warning" :
        statusPercent <= 10 ? "danger" : "neutral";
    return {
      ...item,
      active: Boolean(item.active),
      previous_month_quantity: previousMonthQuantity,
      received_stock_quantity: receivedStockQuantity,
      current_quantity: currentQuantity,
      removed,
      remainder,
      status_percent: statusPercent,
      status_color: statusColor,
      custom_values: customValues.get(item.id) || {},
    };
  });
  const stores = new Set(db.prepare("SELECT name FROM locations").all().map(row => row.name));
  for (const item of items) if (item.store) stores.add(item.store);
  for (const row of db.prepare(`
    SELECT DISTINCT location_name AS name
    FROM stock_transactions
    WHERE request_date >= ? AND request_date <= ?
  `).all(monthStart, monthEnd)) {
    if (row.name) stores.add(row.name);
  }
  return {
    month,
    stores: [...stores].sort((first, second) => first.localeCompare(second)),
    inventoryColumns: columns,
    items,
  };
}

function ensurePreviousMonthInventoryArchive() {
  const currentMonth = todayKey().slice(0, 7);
  const month = previousMonthKey(currentMonth);
  if (db.prepare("SELECT 1 FROM inventory_month_archives WHERE month = ?").get(month)) return;
  const payload = buildInventoryMonthArchive(month);
  db.prepare(`
    INSERT INTO inventory_month_archives (month, payload, created_at)
    VALUES (?, ?, ?)
    ON CONFLICT(month) DO NOTHING
  `).run(month, JSON.stringify(payload), nowIso());
}

function listInventoryArchives() {
  return db.prepare("SELECT month, payload, created_at FROM inventory_month_archives ORDER BY month DESC")
    .all().map(row => ({ ...JSON.parse(row.payload), created_at: row.created_at }));
}

function stockRequestRows(from, to, store = "", activeStoreOnly = false) {
  return db.prepare(`
    SELECT COALESCE(t.request_group_id, t.id) AS id, t.request_group_id, t.item_id,
      t.request_date, t.item_sku, t.item_name, SUM(t.quantity) AS quantity,
      ABS(SUM(t.quantity)) AS quantity_requested, t.unit, t.department, t.person, t.area,
      t.issued_by, t.kind, t.created_by, MAX(t.created_at) AS created_at,
      COALESCE(l.name, t.location_name) AS request_store
    FROM stock_transactions t
    LEFT JOIN locations l ON l.id = t.location_id
    WHERE t.quantity < 0 AND t.kind IN ('requisition', 'issue')
      AND t.voided_at IS NULL AND t.reversal_of IS NULL
      AND t.request_date >= ? AND t.request_date <= ?
      AND (? = '' OR COALESCE(l.name, t.location_name) = ?)
      AND (? = 0 OR l.active = 1)
    GROUP BY COALESCE(t.request_group_id, t.id), t.request_group_id, t.item_id,
      t.request_date, t.item_sku, t.item_name, t.unit, t.department, t.person, t.area,
      t.issued_by, t.kind, t.created_by, COALESCE(l.name, t.location_name)
    ORDER BY t.request_date DESC, MAX(t.created_at) DESC, t.item_name COLLATE NOCASE
  `).all(from, to, store, store, activeStoreOnly ? 1 : 0);
}

function buildRequestsMonthArchive(month) {
  const [year, monthNumber] = month.split("-").map(Number);
  const monthStart = `${month}-01`;
  const monthEnd = new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10);
  const rows = stockRequestRows(monthStart, monthEnd);
  const stores = new Set(db.prepare("SELECT name FROM locations").all().map(row => row.name));
  for (const row of rows) if (row.request_store) stores.add(row.request_store);
  return { month, stores: [...stores].sort((first, second) => first.localeCompare(second)), rows };
}

function refreshRequestsMonthArchive(month) {
  if (!month || !db.prepare("SELECT 1 FROM requests_month_archives WHERE month = ?").get(month)) return;
  const payload = buildRequestsMonthArchive(month);
  db.prepare("UPDATE requests_month_archives SET payload = ?, created_at = ? WHERE month = ?")
    .run(JSON.stringify(payload), nowIso(), month);
}

function ensureRequestsMonthArchives() {
  const currentMonthStart = `${todayKey().slice(0, 7)}-01`;
  const previousMonth = previousMonthKey(currentMonthStart.slice(0, 7));
  const months = new Set(db.prepare(`
    SELECT DISTINCT substr(request_date, 1, 7) AS month
    FROM stock_transactions
    WHERE request_date < ? AND quantity < 0 AND kind IN ('requisition', 'issue')
      AND voided_at IS NULL AND reversal_of IS NULL
  `).all(currentMonthStart).map(row => row.month));
  months.add(previousMonth);
  for (const month of months) {
    if (db.prepare("SELECT 1 FROM requests_month_archives WHERE month = ?").get(month)) continue;
    const payload = buildRequestsMonthArchive(month);
    db.prepare(`
      INSERT INTO requests_month_archives (month, payload, created_at)
      VALUES (?, ?, ?)
      ON CONFLICT(month) DO NOTHING
    `).run(month, JSON.stringify(payload), nowIso());
  }
}

function listRequestsMonthArchives() {
  return db.prepare("SELECT month, payload, created_at FROM requests_month_archives ORDER BY month DESC")
    .all().map(row => {
      const payload = buildRequestsMonthArchive(row.month);
      const serialized = JSON.stringify(payload);
      if (serialized !== row.payload) {
        db.prepare("UPDATE requests_month_archives SET payload = ? WHERE month = ?").run(serialized, row.month);
      }
      return { ...payload, created_at: row.created_at };
    });
}

function reconcileStockBatches() {
  const locationsById = new Map(db.prepare("SELECT id, name FROM locations").all().map(location => [location.id, location]));
  const locationsByName = new Map([...locationsById.values()].map(location => [location.name.toLocaleLowerCase(), location]));
  const storesByItem = new Map(db.prepare("SELECT id, store FROM items").all()
    .map(item => [item.id, item.store]));
  const movements = db.prepare(`
    SELECT t.id, t.item_id, t.batch_id, t.location_id, t.location_name, t.quantity, t.request_date
    FROM stock_transactions t
    WHERE t.item_id IS NOT NULL AND t.voided_at IS NULL AND t.reversal_of IS NULL
    ORDER BY t.request_date, t.created_at, t.id
  `).all();
  const expectedBalances = new Map();
  const batchBalances = new Map();
  let unresolvedMovements = 0;

  for (const movement of movements) {
    const store = storesByItem.get(movement.item_id);
    const location = locationsByName.get(String(store || "").toLocaleLowerCase()) ||
      locationsById.get(movement.location_id) ||
      locationsByName.get(String(movement.location_name || "").toLocaleLowerCase());
    if (!location) {
      unresolvedMovements += 1;
      continue;
    }
    const balanceKey = `${movement.item_id}\u0000${location.id}`;
    const balance = expectedBalances.get(balanceKey) || {
      itemId: movement.item_id,
      locationId: location.id,
      locationName: location.name,
      received: 0,
      remaining: 0,
      receivedAt: "",
    };
    const quantity = Number(movement.quantity);
    balance.remaining += quantity;
    if (quantity > 0) {
      balance.received += quantity;
      if (!balance.receivedAt || movement.request_date < balance.receivedAt) balance.receivedAt = movement.request_date;
    }
    expectedBalances.set(balanceKey, balance);

    if (movement.batch_id) {
      const batchBalance = batchBalances.get(movement.batch_id) || {
        received: 0,
        remaining: 0,
        locations: new Set(),
      };
      batchBalance.remaining += quantity;
      if (quantity > 0) batchBalance.received += quantity;
      batchBalance.locations.add(location.id);
      batchBalances.set(movement.batch_id, batchBalance);
    }
  }

  const correctedBatchIds = new Set();
  let recoveredBalances = 0;
  let unresolvedBalances = 0;
  transaction(() => {
    const batches = db.prepare("SELECT id, item_id, location_id FROM batches").all();
    for (const batch of batches) {
      const store = storesByItem.get(batch.item_id);
      const location = locationsByName.get(String(store || "").toLocaleLowerCase());
      if (location && batch.location_id !== location.id) {
        db.prepare("UPDATE batches SET location_id = ? WHERE id = ?").run(location.id, batch.id);
        correctedBatchIds.add(batch.id);
      }
    }

    for (const [batchId, expected] of batchBalances) {
      if (expected.received <= 0) continue;
      if (expected.locations.size !== 1 ||
          expected.remaining < -0.000001 || expected.remaining > expected.received + 0.000001) {
        unresolvedBalances += 1;
        continue;
      }
      const batch = db.prepare("SELECT * FROM batches WHERE id = ?").get(batchId);
      if (!batch) continue;
      const received = Math.round(expected.received * 1_000_000) / 1_000_000;
      const remaining = Math.max(0, Math.round(expected.remaining * 1_000_000) / 1_000_000);
      const locationId = [...expected.locations][0];
      if (Math.abs(Number(batch.quantity_received) - received) > 0.000001 ||
          Math.abs(Number(batch.quantity_remaining) - remaining) > 0.000001) {
        db.prepare("UPDATE batches SET quantity_received = ?, quantity_remaining = ?, location_id = ? WHERE id = ?")
          .run(received, remaining, locationId, batchId);
        correctedBatchIds.add(batchId);
      }
    }

    const actualBalances = new Map();
    for (const batch of db.prepare("SELECT item_id, location_id, SUM(quantity_remaining) AS quantity FROM batches GROUP BY item_id, location_id").all()) {
      actualBalances.set(`${batch.item_id}\u0000${batch.location_id}`, Number(batch.quantity));
    }
    for (const [key, expected] of expectedBalances) {
      if (expected.received <= 0 || expected.remaining < -0.000001) {
        if (expected.remaining < -0.000001) unresolvedBalances += 1;
        continue;
      }
      const difference = Math.round((expected.remaining - (actualBalances.get(key) || 0)) * 1_000_000) / 1_000_000;
      if (difference <= 0.000001) {
        if (difference < -0.000001) unresolvedBalances += 1;
        continue;
      }
      db.prepare(`
        INSERT INTO batches (
          id, item_id, location_id, batch_number, quantity_received, quantity_remaining, received_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        crypto.randomUUID(), expected.itemId, expected.locationId, "Legacy balance reconciliation",
        difference, difference, expected.receivedAt || todayKey(),
      );
      recoveredBalances += 1;
    }
  });

  const correctedBatches = correctedBatchIds.size;
  if (correctedBatches || recoveredBalances || unresolvedBalances || unresolvedMovements) {
    console.info(
      `Stock balance reconciliation: ${correctedBatches} batches corrected, ` +
      `${recoveredBalances} legacy balances recovered, ${unresolvedBalances + unresolvedMovements} unresolved.`,
    );
  }
}

function stockItems({ includeInactive = false, search = "", category = "", locationId = "", store = "" } = {}) {
  const items = db.prepare(`
    SELECT i.id, i.sku, i.name, i.category, i.store, i.unit, i.reorder_level, i.active, i.created_at, i.updated_at,
      COALESCE(SUM(b.quantity_remaining), 0) AS on_hand,
      MIN(CASE WHEN b.quantity_remaining > 0 AND b.expiry_date IS NOT NULL THEN b.expiry_date END) AS next_expiry,
      COUNT(DISTINCT CASE WHEN b.quantity_remaining > 0 THEN b.id END) AS active_batches
    FROM items i
    LEFT JOIN batches b ON b.item_id = i.id ${locationId ? "AND b.location_id = ?" : ""}
    WHERE (? = 1 OR i.active = 1)
      AND (? = '' OR i.name LIKE ? OR i.sku LIKE ? OR i.category LIKE ?)
      AND (? = '' OR i.category = ?)
      AND (? = '' OR i.store = ?)
    GROUP BY i.id
    ORDER BY i.name COLLATE NOCASE
  `);
  const query = `%${search}%`;
  const rows = locationId
    ? items.all(locationId, includeInactive ? 1 : 0, search, query, query, query, category, category, store, store)
    : items.all(includeInactive ? 1 : 0, search, query, query, query, category, category, store, store);
  const today = todayKey();
  const monthStart = `${today.slice(0, 7)}-01`;
  const metrics = db.prepare(`
    SELECT item_id,
      COALESCE(SUM(CASE WHEN request_date < ? THEN quantity ELSE 0 END), 0) AS previous_month_quantity,
      COALESCE(SUM(CASE WHEN request_date >= ? AND request_date <= ? AND quantity > 0 THEN quantity ELSE 0 END), 0) AS current_month_additions,
      COALESCE(SUM(CASE WHEN request_date >= ? AND request_date <= ? AND quantity < 0 THEN -quantity ELSE 0 END), 0) AS removed
    FROM stock_transactions
    WHERE voided_at IS NULL AND reversal_of IS NULL
    GROUP BY item_id
  `).all(monthStart, monthStart, today, monthStart, today);
  const metricsByItem = new Map(metrics.map(row => [row.item_id, row]));
  const previousArchive = inventoryMonthArchive(previousMonthKey(today.slice(0, 7)));
  const archivedItemBalances = new Map((previousArchive?.items || []).map(item => [item.id, Number(item.remainder)]));
  const customValues = new Map();
  for (const value of db.prepare(`
    SELECT item_id, column_id, value
    FROM inventory_column_values
    WHERE column_id IN (SELECT id FROM inventory_columns WHERE active = 1)
  `).all()) {
    const values = customValues.get(value.item_id) || {};
    values[value.column_id] = value.value;
    customValues.set(value.item_id, values);
  }
  return rows.map(row => {
    const quantity = Number(row.on_hand);
    const threshold = Number(row.reorder_level);
    const itemMetrics = metricsByItem.get(row.id);
    const previousMonthQuantity = archivedItemBalances.has(row.id)
      ? archivedItemBalances.get(row.id)
      : Number(itemMetrics?.previous_month_quantity || 0);
    const currentQuantity = previousMonthQuantity + Number(itemMetrics?.current_month_additions || 0);
    const removed = Number(itemMetrics?.removed || 0);
    const remainder = Math.max(0, currentQuantity - removed);
    const statusPercent = currentQuantity > 0 ? Math.min(100, remainder / currentQuantity * 100) : 0;
    const statusColor = statusPercent >= 80 ? "good" :
      statusPercent >= 20 && statusPercent <= 70 ? "warning" :
        statusPercent <= 10 ? "danger" : "neutral";
    let stockStatus = "In stock";
    if (quantity <= 0) stockStatus = "Out of stock";
    else if (quantity <= threshold) stockStatus = "Low stock";
    return {
      ...row,
      on_hand: quantity,
      reorder_level: threshold,
      active: Boolean(row.active),
      stock_status: stockStatus,
      previous_month_quantity: previousMonthQuantity,
      received_stock_quantity: Number(itemMetrics?.current_month_additions || 0),
      current_quantity: currentQuantity,
      removed,
      remainder,
      status_percent: statusPercent,
      status_color: statusColor,
      custom_values: customValues.get(row.id) || {},
    };
  });
}

function getInventorySummary() {
  const itemRows = stockItems();
  const activeBatches = db.prepare(`
    SELECT b.*, i.name AS item_name, i.sku, i.unit, l.name AS location_name
    FROM batches b
    JOIN items i ON i.id = b.item_id
    JOIN locations l ON l.id = b.location_id
    WHERE b.quantity_remaining > 0
    ORDER BY CASE WHEN b.expiry_date IS NULL THEN 1 ELSE 0 END, b.expiry_date, b.received_at
  `).all();
  const soonKey = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
  const expired = activeBatches.filter(batch => batch.expiry_date && batch.expiry_date < todayKey());
  const expiring = activeBatches.filter(batch => batch.expiry_date && batch.expiry_date >= todayKey() && batch.expiry_date <= soonKey);
  return {
    itemCount: itemRows.length,
    totalUnits: itemRows.reduce((total, item) => total + item.on_hand, 0),
    lowStock: itemRows.filter(item => item.stock_status === "Low stock").length,
    outOfStock: itemRows.filter(item => item.stock_status === "Out of stock").length,
    expiringCount: expiring.length,
    expiredCount: expired.length,
    expiring: [...expired, ...expiring].slice(0, 12).map(batch => ({
      id: batch.id,
      itemId: batch.item_id,
      itemName: batch.item_name,
      sku: batch.sku,
      location: batch.location_name,
      quantity: Number(batch.quantity_remaining),
      unit: batch.unit,
      expiryDate: batch.expiry_date,
      expired: batch.expiry_date < todayKey(),
    })),
    recent: db.prepare("SELECT * FROM stock_transactions ORDER BY created_at DESC LIMIT 8").all(),
  };
}

function getLocations() {
  return db.prepare(`
    SELECT id, name FROM locations WHERE active = 1
    ORDER BY CASE name COLLATE NOCASE
      WHEN 'Dry Store' THEN 0
      WHEN 'Chemical Store' THEN 1
      WHEN 'Protein Store' THEN 2
      WHEN 'Fruit Store' THEN 3
      WHEN 'Vegetable Store' THEN 4
      ELSE 5
    END, name COLLATE NOCASE
  `).all();
}

function itemById(id, active = true) {
  const row = db.prepare("SELECT * FROM items WHERE id = ?").get(id);
  if (!row || (active && !row.active)) throw httpError(404, "Stock item not found.");
  return row;
}

function locationById(id) {
  const row = db.prepare("SELECT id, name FROM locations WHERE id = ? AND active = 1").get(id);
  if (!row) throw httpError(400, "Select a valid stock location.");
  return row;
}

function positiveItemQuantity(value, itemName) {
  const quantity = finitePositive(value, `Quantity for ${itemName}`);
  return Math.round(quantity * 1000) / 1000;
}

function addMovement({ kind, item, batchId = null, location, quantity, department = "", person = "", area = "", issuedBy = "", supplier = "", purchaseReference = "", reason = "", notes = "", requestDate = todayKey(), expiresOn = null, requestGroupId = null, actor }) {
  db.prepare(`
    INSERT INTO stock_transactions (
      id, kind, item_id, item_sku, item_name, batch_id, location_id, location_name,
      quantity, unit, department, person, area, issued_by, supplier, purchase_reference,
      reason, notes, request_date, expires_on, created_by, created_at, request_group_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    crypto.randomUUID(), kind, item.id, item.sku, item.name, batchId, location.id, location.name,
    quantity, item.unit, department, person, area, issuedBy, supplier, purchaseReference,
    reason, notes, requestDate, expiresOn, actor.display_name, nowIso(), requestGroupId,
  );
}

function receiveBatch(body, actor, item, defaults = {}) {
  const location = locationById(body.locationId || defaults.locationId || "");
  if (location.name.toLocaleLowerCase() !== String(item.store || "").toLocaleLowerCase()) {
    throw httpError(400, `Receive ${item.name} at its assigned store, ${item.store}.`);
  }
  const quantity = positiveItemQuantity(body.quantity, item.name);
  const unitCost = body.unitCost === "" || body.unitCost === undefined ? 0 : Number(body.unitCost);
  if (!Number.isFinite(unitCost) || unitCost < 0 || unitCost > 1_000_000_000) throw httpError(400, "Unit cost must be zero or a positive amount.");
  const expiryDate = optionalDate(body.expiryDate, "Expiry date");
  const batchNumber = String(body.batchNumber || "").trim().slice(0, 120);
  const supplier = String(body.supplier || "").trim().slice(0, 160);
  const purchaseReference = String(body.purchaseReference || "").trim().slice(0, 120);
  const movementKind = defaults.movementKind || "receipt";
  const receivedDate = optionalDate(defaults.receivedDate || todayKey(), "Stock date");
  const batchId = crypto.randomUUID();
  db.prepare(`
    INSERT INTO batches (id, item_id, location_id, batch_number, supplier, purchase_reference, unit_cost, quantity_received, quantity_remaining, received_at, expiry_date)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(batchId, item.id, location.id, batchNumber, supplier, purchaseReference, unitCost, quantity, quantity, receivedDate, expiryDate);
  addMovement({
    kind: movementKind, item, batchId, location, quantity, supplier, purchaseReference,
    reason: String(body.reason || "Stock received").trim().slice(0, 500),
    notes: String(body.notes || "").trim().slice(0, 1000),
    requestDate: receivedDate, expiresOn: expiryDate, actor,
  });
}

function consumeBatches(item, location, quantity, actor, movement) {
  const batches = db.prepare(`
    SELECT * FROM batches
    WHERE item_id = ? AND location_id = ? AND quantity_remaining > 0
    ORDER BY CASE WHEN expiry_date IS NULL THEN 1 ELSE 0 END, expiry_date, received_at, id
  `).all(item.id, location.id);
  const available = batches.reduce((total, batch) => total + Number(batch.quantity_remaining), 0);
  if (available + 0.000001 < quantity) {
    throw httpError(409, `Not enough ${item.unit} of ${item.name} at ${location.name}. Available: ${available}.`);
  }

  let left = quantity;
  for (const batch of batches) {
    if (left <= 0.000001) break;
    const take = Math.min(left, Number(batch.quantity_remaining));
    db.prepare("UPDATE batches SET quantity_remaining = quantity_remaining - ? WHERE id = ?").run(take, batch.id);
    addMovement({
      ...movement,
      item,
      batchId: batch.id,
      location,
      quantity: -take,
      expiresOn: batch.expiry_date,
      actor,
    });
    left = Math.round((left - take) * 1000) / 1000;
  }
}

function validateStockRequest(body, actor, forcedKind = "") {
  if (!body || !Array.isArray(body.lines) || body.lines.length === 0 || body.lines.length > 200) {
    throw httpError(400, "Add at least one stock item (up to 200 lines per requisition).");
  }
  const department = String(body.department || "").trim();
  const departmentRecord = departmentByName(department);
  if (!departmentRecord) throw httpError(400, "Select a valid department.");
  const isSpecialDepartment = ["expiry", "spoilage"].includes(departmentRecord.kind);
  const person = isSpecialDepartment ? "" : String(body.person || "").trim();
  if (!isSpecialDepartment &&
    !db.prepare("SELECT 1 FROM requesters WHERE scope = 'stock' AND department = ? AND name = ? COLLATE NOCASE AND active = 1")
      .get(department, person)) {
    throw httpError(400, "Select a valid name for this department.");
  }
  const areas = Array.isArray(body.areas) ? [...new Set(body.areas.map(value => String(value)))] : [];
  const allowedAreas = departmentRecord.kind === "housekeeping" ? getAreas() : [];
  if (areas.some(area => !allowedAreas.includes(area))) throw httpError(400, "Select valid housekeeping areas.");
  if (departmentRecord.kind === "housekeeping" && areas.length === 0) throw httpError(400, "Select at least one area for Housekeeping.");
  const area = areas.join(", ");
  const issuedBy = String(body.issuedBy || "").trim();
  if (!issuedBy || issuedBy.length > 120) throw httpError(400, "Enter the issuer's name (up to 120 characters).");
  const notes = String(body.notes || "").trim().slice(0, 1000);
  const requestDate = optionalDate(body.date || todayKey(), "Request date");
  if (requestDate > todayKey()) throw httpError(400, "A stock requisition date cannot be in the future.");
  const seen = new Set();
  const lines = body.lines.map(line => {
    if (!line || typeof line.itemId !== "string") throw httpError(400, "Each stock line must select a valid item.");
    if (seen.has(line.itemId)) throw httpError(400, "Duplicate items are not allowed in one requisition.");
    seen.add(line.itemId);
    const item = itemById(line.itemId);
    const location = locationById(line.locationId || body.locationId);
    if (item.store !== location.name) {
      throw httpError(400, `Select an item assigned to ${location.name}.`);
    }
    return { item, location, quantity: positiveItemQuantity(line.quantity, item.name) };
  });
  const kind = forcedKind || (isSpecialDepartment ? departmentRecord.kind : "requisition");
  return { department, person, area, issuedBy, notes, requestDate, lines, kind, actor };
}

function issueStock(body, actor, forcedKind = "") {
  const request = validateStockRequest(body, actor, forcedKind);
  const result = transaction(() => {
    for (const line of request.lines) {
      const requestGroupId = crypto.randomUUID();
      consumeBatches(line.item, line.location, line.quantity, actor, {
        kind: request.kind,
        requestGroupId,
        department: request.department,
        person: request.person,
        area: request.area,
        issuedBy: request.issuedBy,
        reason: String(body.reason || "").trim().slice(0, 500),
        notes: request.notes,
        requestDate: request.requestDate,
      });
    }
    addAudit(actor, "stock.issue", `${request.department}: ${request.lines.map(line => `${line.item.name} × ${line.quantity} ${line.item.unit} from ${line.location.name}`).join(", ")}`);
    return { lines: request.lines.length };
  });
  return { ...result, inventory: stockItems() };
}

function createItem(body, actor) {
  const sku = String(body?.sku || "").trim().toUpperCase();
  const name = String(body?.name || "").trim();
  const category = String(body?.category || "").trim();
  const store = String(body?.store || "").trim();
  const unit = String(body?.unit || "").trim();
  if (!/^[A-Z0-9][A-Z0-9._/-]{0,39}$/.test(sku)) throw httpError(400, "SKU must be 1–40 letters, numbers, dots, dashes, slashes or underscores.");
  if (db.prepare("SELECT 1 FROM items WHERE sku = ? COLLATE NOCASE").get(sku)) {
    throw httpError(409, "SKU already exists. Delete the archived item or choose a different SKU.");
  }
  if (name.length < 2 || name.length > 120) throw httpError(400, "Item name must be 2–120 characters.");
  if (!getLocations().some(location => location.name === store)) throw httpError(400, "Select a valid inventory store.");
  if (!getCategories().some(entry => entry.name === category)) throw httpError(400, "Select a valid category.");
  if (!/^[A-Za-z0-9 .()/_-]{1,24}$/.test(unit)) throw httpError(400, "Enter a valid unit, such as packs, bottles, kg or pieces.");
  const reorderLevel = Number(body.reorderLevel ?? 0);
  if (!Number.isFinite(reorderLevel) || reorderLevel < 0 || reorderLevel > 1_000_000_000) throw httpError(400, "Reorder level must be zero or a positive number.");
  const previousMonthQuantity = body.previousMonthQuantity === "" || body.previousMonthQuantity === undefined ? 0 : Number(body.previousMonthQuantity);
  if (!Number.isFinite(previousMonthQuantity) || previousMonthQuantity < 0 || previousMonthQuantity > 1_000_000_000) {
    throw httpError(400, "Previous month stock quantity must be zero or a positive number.");
  }
  const initialQuantity = body.initialQuantity === "" || body.initialQuantity === undefined
    ? previousMonthQuantity + Number(body.receivedStockQuantity || 0)
    : Number(body.initialQuantity);
  if (!Number.isFinite(initialQuantity) || initialQuantity < 0 || initialQuantity > 1_000_000_000) {
    throw httpError(400, "Current quantity must be zero or a positive number.");
  }
  const receivedStockQuantity = body.receivedStockQuantity === undefined || body.receivedStockQuantity === ""
    ? initialQuantity - previousMonthQuantity
    : Number(body.receivedStockQuantity);
  if (!Number.isFinite(receivedStockQuantity) || receivedStockQuantity < 0 || receivedStockQuantity > 1_000_000_000) {
    throw httpError(400, "Received stock quantity must be zero or a positive number.");
  }
  if (Math.abs(initialQuantity - (previousMonthQuantity + receivedStockQuantity)) > 0.000001) {
    throw httpError(400, "Current quantity must equal previous month stock quantity plus received stock quantity.");
  }
  const item = { id: crypto.randomUUID(), sku, name, category, store, unit, reorder_level: reorderLevel };
  transaction(() => {
    db.prepare(`
      INSERT INTO items (id, sku, name, category, store, unit, description, reorder_level, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, '', ?, ?, ?)
    `).run(item.id, sku, name, category, store, unit, reorderLevel, nowIso(), nowIso());
    const locationId = String(body.locationId || "");
    if (previousMonthQuantity > 0) {
      const currentMonthStart = `${todayKey().slice(0, 7)}-01`;
      const [year, month] = currentMonthStart.split("-").map(Number);
      const previousMonthEnd = new Date(Date.UTC(year, month - 1, 0)).toISOString().slice(0, 10);
      receiveBatch({
        ...body,
        quantity: previousMonthQuantity,
        reason: "Previous month opening stock",
        locationId,
      }, actor, item, { receivedDate: previousMonthEnd });
    }
    const currentMonthQuantity = receivedStockQuantity;
    if (currentMonthQuantity > 0) {
      receiveBatch({
        ...body,
        quantity: currentMonthQuantity,
        reason: "Current month opening stock",
        locationId,
      }, actor, item);
    }
    saveInventoryColumnValues(item.id, body.customValues);
    addAudit(actor, "item.create", `${sku} — ${name} in ${store}`);
  });
  return stockItems({ includeInactive: true }).find(row => row.id === item.id);
}

function updateItem(id, body, actor) {
  const existing = itemById(id, false);
  const sku = String(body?.sku || "").trim().toUpperCase();
  const name = String(body?.name || "").trim();
  const category = String(body?.category || "").trim();
  const store = String(body?.store || "").trim();
  const unit = String(body?.unit || "").trim();
  const reorderLevel = Number(body.reorderLevel);
  const currentPreviousMonthQuantity = previousMonthStock(existing.id);
  const previousMonthQuantity = body.previousMonthQuantity === undefined
    ? currentPreviousMonthQuantity
    : Number(body.previousMonthQuantity);
  const monthStart = `${todayKey().slice(0, 7)}-01`;
  const currentReceivedStockQuantity = Number(db.prepare(`
    SELECT COALESCE(SUM(quantity), 0) AS quantity
    FROM stock_transactions
    WHERE item_id = ? AND request_date >= ? AND request_date <= ?
      AND quantity > 0 AND voided_at IS NULL AND reversal_of IS NULL
  `).get(existing.id, monthStart, todayKey()).quantity);
  const receivedStockQuantity = body.receivedStockQuantity === undefined
    ? currentReceivedStockQuantity
    : Number(body.receivedStockQuantity);
  if (!/^[A-Z0-9][A-Z0-9._/-]{0,39}$/.test(sku)) throw httpError(400, "SKU must be 1–40 letters, numbers, dots, dashes, slashes or underscores.");
  if (db.prepare("SELECT 1 FROM items WHERE sku = ? COLLATE NOCASE AND id <> ?").get(sku, existing.id)) {
    throw httpError(409, "SKU already exists. Delete the archived item or choose a different SKU.");
  }
  if (name.length < 2 || name.length > 120) throw httpError(400, "Item name must be 2–120 characters.");
  if (!getLocations().some(location => location.name === store)) throw httpError(400, "Select a valid inventory store.");
  if (!getCategories().some(entry => entry.name === category)) throw httpError(400, "Select a valid category.");
  if (!/^[A-Za-z0-9 .()/_-]{1,24}$/.test(unit)) throw httpError(400, "Enter a valid unit.");
  if (!Number.isFinite(reorderLevel) || reorderLevel < 0 || reorderLevel > 1_000_000_000) throw httpError(400, "Reorder level must be zero or a positive number.");
  if (!Number.isFinite(previousMonthQuantity) || previousMonthQuantity < 0 || previousMonthQuantity > 1_000_000_000) {
    throw httpError(400, "Previous month stock quantity must be zero or a positive number.");
  }
  if (!Number.isFinite(receivedStockQuantity) || receivedStockQuantity < 0 || receivedStockQuantity > 1_000_000_000) {
    throw httpError(400, "Received stock quantity must be zero or a positive number.");
  }
  const previousMonthDelta = previousMonthQuantity - currentPreviousMonthQuantity;
  const receivedStockDelta = receivedStockQuantity - currentReceivedStockQuantity;
  const storeLocation = db.prepare("SELECT id FROM locations WHERE name = ? COLLATE NOCASE AND active = 1").get(store);
  if (!storeLocation) throw httpError(409, "Assign this item to an active stock location before correcting its stock.");
  transaction(() => {
    db.prepare(`
      UPDATE items SET sku = ?, name = ?, category = ?, store = ?, unit = ?, description = '', reorder_level = ?, updated_at = ?
      WHERE id = ?
    `).run(sku, name, category, store, unit, reorderLevel, nowIso(), existing.id);
    db.prepare("UPDATE batches SET location_id = ? WHERE item_id = ? AND location_id <> ?")
      .run(storeLocation.id, existing.id, storeLocation.id);
    if (previousMonthDelta > 0) {
      const monthStart = `${todayKey().slice(0, 7)}-01`;
      const [year, month] = monthStart.split("-").map(Number);
      const previousMonthEnd = new Date(Date.UTC(year, month - 1, 0)).toISOString().slice(0, 10);
      receiveBatch({
        locationId: storeLocation.id,
        quantity: previousMonthDelta,
        reason: "Previous month stock correction",
      }, actor, { ...existing, sku, name, store, unit }, {
        movementKind: "adjustment",
        receivedDate: previousMonthEnd,
      });
    } else if (previousMonthDelta < 0) {
      const quantityToRemove = -previousMonthDelta;
      const available = stockBalance(existing.id);
      if (available + 0.000001 < quantityToRemove) {
        throw httpError(409, `Previous month stock cannot be reduced by ${quantityToRemove}; only ${available} remains on hand. Correct earlier stock issues first.`);
      }
      const locations = db.prepare(`
        SELECT location_id, SUM(quantity_remaining) AS available
        FROM batches
        WHERE item_id = ? AND quantity_remaining > 0
        GROUP BY location_id
        ORDER BY location_id
      `).all(existing.id);
      let remaining = quantityToRemove;
      const monthStart = `${todayKey().slice(0, 7)}-01`;
      const [year, month] = monthStart.split("-").map(Number);
      const previousMonthEnd = new Date(Date.UTC(year, month - 1, 0)).toISOString().slice(0, 10);
      for (const batchLocation of locations) {
        if (remaining <= 0.000001) break;
        const quantity = Math.min(remaining, Number(batchLocation.available));
        consumeBatches({ ...existing, sku, name, unit }, locationById(batchLocation.location_id), quantity, actor, {
          kind: "adjustment",
          requestDate: previousMonthEnd,
          reason: "Previous month stock correction",
        });
        remaining = Math.round((remaining - quantity) * 1000) / 1000;
      }
    }
    if (receivedStockDelta > 0.000001) {
      receiveBatch({
        locationId: storeLocation.id,
        quantity: receivedStockDelta,
        reason: "Current month received stock correction",
      }, actor, { ...existing, sku, name, store, unit });
    } else if (receivedStockDelta < -0.000001) {
      let quantityToRemove = -receivedStockDelta;
      const receipts = db.prepare(`
        SELECT t.id, t.batch_id, t.quantity, b.quantity_remaining, b.quantity_received
        FROM stock_transactions t
        JOIN batches b ON b.id = t.batch_id
        WHERE t.item_id = ? AND t.request_date >= ? AND t.request_date <= ?
          AND t.quantity > 0 AND t.voided_at IS NULL AND t.reversal_of IS NULL
        ORDER BY t.request_date DESC, t.created_at DESC, t.id DESC
      `).all(existing.id, monthStart, todayKey());
      const reducible = receipts.reduce((total, receipt) => total + Math.min(Number(receipt.quantity), Number(receipt.quantity_remaining)), 0);
      if (reducible + 0.000001 < quantityToRemove) {
        const formatQuantity = value => Number(value).toLocaleString("en-US", { maximumFractionDigits: 3 });
        throw httpError(409, `Received stock cannot be reduced by ${formatQuantity(quantityToRemove)}; only ${formatQuantity(reducible)} has not been issued.`);
      }
      for (const receipt of receipts) {
        if (quantityToRemove <= 0.000001) break;
        const remainingInBatch = Number(db.prepare("SELECT quantity_remaining FROM batches WHERE id = ?").get(receipt.batch_id)?.quantity_remaining || 0);
        const receivedInBatch = Number(db.prepare("SELECT quantity_received FROM batches WHERE id = ?").get(receipt.batch_id)?.quantity_received || 0);
        const reduction = Math.min(quantityToRemove, Number(receipt.quantity), remainingInBatch);
        if (reduction <= 0) continue;
        const newTransactionQuantity = Number(receipt.quantity) - reduction;
        const newBatchReceived = receivedInBatch - reduction;
        if (newTransactionQuantity <= 0.000001) {
          db.prepare("DELETE FROM stock_transactions WHERE id = ?").run(receipt.id);
        } else {
          db.prepare("UPDATE stock_transactions SET quantity = ? WHERE id = ?").run(newTransactionQuantity, receipt.id);
        }
        if (newBatchReceived <= 0.000001) {
          db.prepare("DELETE FROM batches WHERE id = ?").run(receipt.batch_id);
        } else {
          db.prepare("UPDATE batches SET quantity_received = ?, quantity_remaining = quantity_remaining - ? WHERE id = ?")
            .run(newBatchReceived, reduction, receipt.batch_id);
        }
        quantityToRemove = Math.round((quantityToRemove - reduction) * 1_000_000) / 1_000_000;
      }
    }
    saveInventoryColumnValues(existing.id, body.customValues);
    addAudit(actor, "item.update", `${existing.sku} → ${sku} — ${name} in ${store}; previous month quantity ${currentPreviousMonthQuantity} → ${previousMonthQuantity}; received stock ${currentReceivedStockQuantity} → ${receivedStockQuantity}`);
  });
  return stockItems({ includeInactive: true }).find(row => row.id === id);
}

function addLocation(body, actor) {
  const name = String(body?.name || "").trim();
  if (name.length < 2 || name.length > 80) throw httpError(400, "Location name must be 2–80 characters.");
  const existing = db.prepare("SELECT id, active FROM locations WHERE name = ? COLLATE NOCASE").get(name);
  if (existing?.active) {
    throw httpError(409, "A stock location with that name already exists.");
  }
  if (existing) return updateLocation(existing.id, { name, active: true }, actor);
  const id = crypto.randomUUID();
  db.prepare("INSERT INTO locations (id, name) VALUES (?, ?)").run(id, name);
  addAudit(actor, "location.create", name);
  return db.prepare("SELECT id, name FROM locations WHERE id = ?").get(id);
}

function updateLocation(id, body, actor) {
  const location = db.prepare("SELECT * FROM locations WHERE id = ?").get(id);
  if (!location) throw httpError(404, "Store location not found.");
  const name = String(body?.name || "").trim();
  const active = body.active === false ? 0 : 1;
  if (name.length < 2 || name.length > 80) throw httpError(400, "Location name must be 2–80 characters.");
  if (db.prepare("SELECT 1 FROM locations WHERE name = ? COLLATE NOCASE AND id <> ?").get(name, id)) {
    throw httpError(409, "A stock location with that name already exists.");
  }
  if (location.active && !active) {
    if (db.prepare("SELECT 1 FROM batches WHERE location_id = ? AND quantity_remaining > 0 LIMIT 1").get(id)) {
      throw httpError(409, "Move or issue the remaining stock before disabling this location.");
    }
    if (db.prepare("SELECT 1 FROM items WHERE store = ? COLLATE NOCASE AND active = 1 LIMIT 1").get(location.name)) {
      throw httpError(409, "Move active catalog items to another store before deleting this store.");
    }
    if (db.prepare("SELECT COUNT(*) AS count FROM locations WHERE active = 1").get().count <= 1) {
      throw httpError(409, "At least one active store location must remain.");
    }
  }
  transaction(() => {
    db.prepare("UPDATE locations SET name = ?, active = ? WHERE id = ?").run(name, active, id);
    if (location.name !== name) {
      db.prepare("UPDATE items SET store = ?, updated_at = ? WHERE store = ? COLLATE NOCASE")
        .run(name, nowIso(), location.name);
    }
  });
  addAudit(actor, "location.update", `${location.name} → ${name}; active=${Boolean(active)}`);
  return { id, name, active: Boolean(active) };
}

function deleteLocation(id, actor) {
  const location = db.prepare("SELECT * FROM locations WHERE id = ?").get(id);
  if (!location) throw httpError(404, "Store location not found.");
  return updateLocation(id, { name: location.name, active: false }, actor);
}

function updateCategory(id, body, actor) {
  const category = db.prepare("SELECT * FROM categories WHERE id = ?").get(id);
  if (!category) throw httpError(404, "Category not found.");
  const name = String(body?.name || "").trim();
  const active = body.active === false ? 0 : 1;
  if (name.length < 2 || name.length > 60) throw httpError(400, "Category name must be 2–60 characters.");
  if (db.prepare("SELECT 1 FROM categories WHERE name = ? COLLATE NOCASE AND id <> ?").get(name, id)) {
    throw httpError(409, "A category with that name already exists.");
  }
  transaction(() => {
    db.prepare("UPDATE categories SET name = ?, active = ? WHERE id = ?").run(name, active, id);
    if (category.name !== name) db.prepare("UPDATE items SET category = ?, updated_at = ? WHERE category = ?").run(name, nowIso(), category.name);
    if (category.active && !active && db.prepare("SELECT 1 FROM items WHERE category = ? AND active = 1 LIMIT 1").get(category.name)) {
      throw httpError(409, "Move or archive active items in this category before disabling it.");
    }
    addAudit(actor, "category.update", `${category.name} → ${name}; active=${Boolean(active)}`);
  });
  return { id, name, active: Boolean(active) };
}

function addCategory(body, actor) {
  const name = String(body?.name || "").trim();
  if (name.length < 2 || name.length > 60) throw httpError(400, "Category name must be 2–60 characters.");
  if (db.prepare("SELECT 1 FROM categories WHERE name = ? COLLATE NOCASE").get(name)) {
    throw httpError(409, "A category with that name already exists.");
  }
  const id = crypto.randomUUID();
  db.prepare("INSERT INTO categories (id, name) VALUES (?, ?)").run(id, name);
  addAudit(actor, "category.create", name);
  return { id, name, active: true };
}

function deleteCategory(id, actor) {
  const category = db.prepare("SELECT * FROM categories WHERE id = ?").get(id);
  if (!category) throw httpError(404, "Category not found.");
  if (db.prepare("SELECT 1 FROM items WHERE category = ? LIMIT 1").get(category.name)) {
    throw httpError(409, "This category is used by catalog items. Reassign or archive those items first.");
  }
  db.prepare("DELETE FROM categories WHERE id = ?").run(id);
  addAudit(actor, "category.delete", category.name);
  return { deleted: true };
}

function addRequester(body, actor) {
  const scope = body?.scope === "water" ? "water" : body?.scope === "stock" ? "stock" : "";
  const department = scope === "stock" ? String(body.department || "") : "";
  const name = String(body?.name || "").trim();
  if (!scope) throw httpError(400, "Choose water or stock requester type.");
  if (scope === "stock" && !departmentByName(department)) throw httpError(400, "Choose a valid stock department.");
  if (name.length < 2 || name.length > 80) throw httpError(400, "Requester name must be 2–80 characters.");
  if (db.prepare("SELECT 1 FROM requesters WHERE scope = ? AND department = ? AND name = ? COLLATE NOCASE").get(scope, department, name)) {
    throw httpError(409, "That requester already exists in this list.");
  }
  const id = crypto.randomUUID();
  db.prepare("INSERT INTO requesters (id, scope, department, name) VALUES (?, ?, ?, ?)").run(id, scope, department, name);
  addAudit(actor, "requester.create", `${scope}/${department}: ${name}`);
  return { id, scope, department, name, active: true };
}

function updateRequester(id, body, actor) {
  const existing = db.prepare("SELECT * FROM requesters WHERE id = ?").get(id);
  if (!existing) throw httpError(404, "Requester not found.");
  const name = String(body?.name || "").trim();
  const active = body.active === false ? 0 : 1;
  if (name.length < 2 || name.length > 80) throw httpError(400, "Requester name must be 2–80 characters.");
  if (db.prepare("SELECT 1 FROM requesters WHERE scope = ? AND department = ? AND name = ? COLLATE NOCASE AND id <> ?")
    .get(existing.scope, existing.department, name, id)) throw httpError(409, "That requester already exists in this list.");
  db.prepare("UPDATE requesters SET name = ?, active = ? WHERE id = ?").run(name, active, id);
  addAudit(actor, "requester.update", `${existing.scope}/${existing.department}: ${existing.name} → ${name}; active=${Boolean(active)}`);
  return { ...existing, name, active: Boolean(active) };
}

function deleteRequester(id, actor) {
  const requester = db.prepare("SELECT * FROM requesters WHERE id = ?").get(id);
  if (!requester) throw httpError(404, "Requester not found.");
  db.prepare("DELETE FROM requesters WHERE id = ?").run(id);
  addAudit(actor, "requester.delete", `${requester.scope}/${requester.department}: ${requester.name}`);
  return { deleted: true };
}

function addDepartment(body, actor) {
  const name = String(body?.name || "").trim();
  const kind = ["standard", "housekeeping", "expiry", "spoilage"].includes(body?.kind) ? body.kind : "standard";
  if (name.length < 2 || name.length > 80) throw httpError(400, "Department name must be 2–80 characters.");
  if (kind === "housekeeping" && db.prepare("SELECT 1 FROM departments WHERE kind = 'housekeeping'").get()) {
    throw httpError(409, "A Housekeeping department already exists. Rename the existing department instead.");
  }
  if (db.prepare("SELECT 1 FROM departments WHERE name = ? COLLATE NOCASE").get(name)) {
    throw httpError(409, "A department with that name already exists.");
  }
  const id = crypto.randomUUID();
  const timestamp = nowIso();
  db.prepare("INSERT INTO departments (id, name, kind, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
    .run(id, name, kind, timestamp, timestamp);
  addAudit(actor, "department.create", name);
  return { id, name, kind };
}

function updateDepartment(id, body, actor) {
  const department = db.prepare("SELECT * FROM departments WHERE id = ?").get(id);
  if (!department) throw httpError(404, "Department not found.");
  const name = String(body?.name || "").trim();
  if (name.length < 2 || name.length > 80) throw httpError(400, "Department name must be 2–80 characters.");
  if (db.prepare("SELECT 1 FROM departments WHERE name = ? COLLATE NOCASE AND id <> ?").get(name, id)) {
    throw httpError(409, "A department with that name already exists.");
  }
  transaction(() => {
    db.prepare("UPDATE departments SET name = ?, updated_at = ? WHERE id = ?").run(name, nowIso(), id);
    if (department.name !== name) {
      db.prepare("UPDATE requesters SET department = ? WHERE scope = 'stock' AND department = ? COLLATE NOCASE")
        .run(name, department.name);
      db.prepare("UPDATE stock_transactions SET department = ? WHERE department = ? COLLATE NOCASE")
        .run(name, department.name);
    }
    addAudit(actor, "department.update", `${department.name} → ${name}`);
  });
  return { id, name, kind: department.kind };
}

function deleteDepartment(id, actor) {
  const department = db.prepare("SELECT * FROM departments WHERE id = ?").get(id);
  if (!department) throw httpError(404, "Department not found.");
  transaction(() => {
    db.prepare("DELETE FROM requesters WHERE scope = 'stock' AND department = ? COLLATE NOCASE").run(department.name);
    if (department.kind === "housekeeping") db.exec("DELETE FROM housekeeping_areas");
    db.prepare("DELETE FROM departments WHERE id = ?").run(id);
    addAudit(actor, "department.delete", department.name);
  });
  return { deleted: true };
}

function addHousekeepingArea(body, actor) {
  const name = String(body?.name || "").trim();
  if (name.length < 2 || name.length > 80) throw httpError(400, "Area name must be 2–80 characters.");
  if (!db.prepare("SELECT 1 FROM departments WHERE kind = 'housekeeping'").get()) {
    throw httpError(409, "Create a Housekeeping department before adding areas.");
  }
  if (db.prepare("SELECT 1 FROM housekeeping_areas WHERE name = ? COLLATE NOCASE").get(name)) {
    throw httpError(409, "A housekeeping area with that name already exists.");
  }
  const id = crypto.randomUUID();
  const timestamp = nowIso();
  db.prepare("INSERT INTO housekeeping_areas (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)")
    .run(id, name, timestamp, timestamp);
  addAudit(actor, "housekeeping_area.create", name);
  return { id, name };
}

function updateHousekeepingArea(id, body, actor) {
  const area = db.prepare("SELECT * FROM housekeeping_areas WHERE id = ?").get(id);
  if (!area) throw httpError(404, "Housekeeping area not found.");
  const name = String(body?.name || "").trim();
  if (name.length < 2 || name.length > 80) throw httpError(400, "Area name must be 2–80 characters.");
  if (db.prepare("SELECT 1 FROM housekeeping_areas WHERE name = ? COLLATE NOCASE AND id <> ?").get(name, id)) {
    throw httpError(409, "A housekeeping area with that name already exists.");
  }
  transaction(() => {
    db.prepare("UPDATE housekeeping_areas SET name = ?, updated_at = ? WHERE id = ?").run(name, nowIso(), id);
    if (area.name !== name) {
      db.prepare("UPDATE stock_transactions SET area = ? WHERE area = ? COLLATE NOCASE").run(name, area.name);
    }
    addAudit(actor, "housekeeping_area.update", `${area.name} → ${name}`);
  });
  return { id, name };
}

function deleteHousekeepingArea(id, actor) {
  const area = db.prepare("SELECT * FROM housekeeping_areas WHERE id = ?").get(id);
  if (!area) throw httpError(404, "Housekeeping area not found.");
  db.prepare("DELETE FROM housekeeping_areas WHERE id = ?").run(id);
  addAudit(actor, "housekeeping_area.delete", area.name);
  return { deleted: true };
}

function deleteItem(id, actor) {
  const item = itemById(id, false);
  if (!item.active) throw httpError(409, "This item is already archived.");
  transaction(() => {
    db.prepare("UPDATE items SET active = 0, updated_at = ? WHERE id = ?").run(nowIso(), id);
    addAudit(actor, "item.archive", `${item.sku} — ${item.name}`);
  });
  return { archived: true };
}

function permanentlyDeleteArchivedItem(id, actor) {
  const item = itemById(id, false);
  if (item.active) throw httpError(409, "Only archived items can be permanently deleted.");
  transaction(() => {
    db.prepare("DELETE FROM stock_transactions WHERE item_id = ?").run(id);
    db.prepare("DELETE FROM batches WHERE item_id = ?").run(id);
    db.prepare("DELETE FROM items WHERE id = ?").run(id);
    addAudit(actor, "item.permanently_delete", `${item.sku} — ${item.name}; related stock history and batches deleted.`);
  });
  return { deleted: true, sku: item.sku };
}

function latestWaterRecords() {
  return db.prepare(`
    SELECT w.* FROM water_records w
    WHERE NOT EXISTS (
      SELECT 1 FROM water_records newer
      WHERE newer.recipient = w.recipient
        AND (newer.date > w.date OR (newer.date = w.date AND newer.created_at > w.created_at))
    )
    ORDER BY w.recipient COLLATE NOCASE
  `).all();
}

function waterSnapshot() {
  const latest = new Map(latestWaterRecords().map(record => [record.recipient, record]));
  const today = todayKey();
  const recipients = WATER_RECIPIENTS.map(recipient => {
    const lastRecord = latest.get(recipient) || null;
    const dailyAllowed = WATER_STAFF.includes(recipient) || WATER_EXEMPT.has(recipient);
    const elapsed = lastRecord ? Math.max(0, dateDiff(lastRecord.date, today)) : null;
    const remainingDays = lastRecord && !dailyAllowed ? Math.max(0, 3 - elapsed) : 0;
    return {
      recipient,
      category: WATER_STAFF.includes(recipient) ? "staff" : "room",
      dailyAllowed,
      lastRecord,
      remainingDays,
      eligible: dailyAllowed || !lastRecord || remainingDays === 0,
    };
  });
  return {
    today,
    cooldownDays: 3,
    recipients,
    records: db.prepare("SELECT * FROM water_records ORDER BY date DESC, created_at DESC").all(),
  };
}

function issueWater(body, actor) {
  if (!body || !Array.isArray(body.recipients) || body.recipients.length === 0 ||
    body.recipients.length > 46 || body.recipients.some(name => !WATER_RECIPIENTS.includes(name))) {
    throw httpError(400, "Select at least one valid room or staff unit.");
  }
  if (new Set(body.recipients).size !== body.recipients.length) throw httpError(400, "Duplicate water recipients are not allowed.");
  const quantity = Number(body.quantity);
  if (!Number.isSafeInteger(quantity) || quantity <= 0 || quantity > 1_000_000) throw httpError(400, "Water quantity must be a positive whole number of packs.");
  if (!getWaterRequesters().includes(body.requestedBy)) throw httpError(400, "Choose an active water requester.");
  const issuedBy = String(body.issuedBy || "").trim();
  if (!issuedBy || issuedBy.length > 120) throw httpError(400, "Enter the issuer's name.");

  const previous = new Map(latestWaterRecords().map(record => [record.recipient, record]));
  const today = todayKey();
  const issued = [];
  const skipped = [];
  for (const recipient of body.recipients) {
    const last = previous.get(recipient);
    const dailyAllowed = WATER_STAFF.includes(recipient) || WATER_EXEMPT.has(recipient);
    const elapsed = last ? dateDiff(last.date, today) : Number.POSITIVE_INFINITY;
    if (!dailyAllowed && last && elapsed < 3) {
      skipped.push({ recipient, remainingDays: Math.max(1, 3 - Math.max(0, elapsed)) });
      continue;
    }
    issued.push({ id: crypto.randomUUID(), date: today, recipient, quantity, requestedBy: body.requestedBy, issuedBy, actor });
  }
  if (!issued.length) return { issued: [], skipped, snapshot: waterSnapshot() };
  transaction(() => {
    const insert = db.prepare(`
      INSERT INTO water_records (id, date, recipient, quantity, requested_by, issued_by, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const record of issued) {
      insert.run(record.id, record.date, record.recipient, record.quantity, record.requestedBy, record.issuedBy, actor.display_name, nowIso());
      delete record.actor;
    }
    addAudit(actor, "water.issue", issued.map(record => `${record.recipient} × ${record.quantity}`).join(", "));
  });
  return { issued, skipped, snapshot: waterSnapshot() };
}

function updateWaterRecord(id, body, actor) {
  const record = db.prepare("SELECT * FROM water_records WHERE id = ?").get(id);
  if (!record) throw httpError(404, "Water record not found.");
  const date = optionalDate(body.date, "Water issue date");
  const recipient = String(body.recipient || "").trim();
  const quantity = Number(body.quantity);
  const requestedBy = String(body.requestedBy || "").trim();
  const issuedBy = String(body.issuedBy || "").trim();
  if (!date || date > todayKey()) throw httpError(400, "Water issue date must be today or earlier.");
  if (!WATER_RECIPIENTS.includes(recipient)) throw httpError(400, "Choose a valid water recipient.");
  if (!Number.isSafeInteger(quantity) || quantity <= 0 || quantity > 1_000_000) throw httpError(400, "Water quantity must be a positive whole number of packs.");
  if (!getWaterRequesters().includes(requestedBy)) throw httpError(400, "Choose an active water requester.");
  if (!issuedBy || issuedBy.length > 120) throw httpError(400, "Enter the issuer's name.");
  const nearby = db.prepare("SELECT date FROM water_records WHERE recipient = ? AND id <> ? ORDER BY date").all(recipient, id);
  if (!WATER_STAFF.includes(recipient) && !WATER_EXEMPT.has(recipient) &&
      nearby.some(other => Math.abs(dateDiff(other.date, date)) < 3)) {
    throw httpError(409, "This edit conflicts with the room's three-day cooldown.");
  }
  db.prepare(`
    UPDATE water_records SET date = ?, recipient = ?, quantity = ?, requested_by = ?, issued_by = ?
    WHERE id = ?
  `).run(date, recipient, quantity, requestedBy, issuedBy, id);
  addAudit(actor, "water.record.update",
    `${record.recipient} ${record.date} × ${record.quantity} → ${recipient} ${date} × ${quantity}; requester=${requestedBy}; issuer=${issuedBy}`);
  return { record: db.prepare("SELECT * FROM water_records WHERE id = ?").get(id), snapshot: waterSnapshot() };
}

function deleteWaterRecords(ids, actor) {
  if (!Array.isArray(ids) || !ids.length || ids.length > 1000 || ids.some(id => typeof id !== "string")) {
    throw httpError(400, "Select one or more water records to delete.");
  }
  if (new Set(ids).size !== ids.length) throw httpError(400, "Duplicate water record IDs are not allowed.");
  const placeholders = ids.map(() => "?").join(",");
  const selected = db.prepare(`SELECT id, recipient, date, quantity FROM water_records WHERE id IN (${placeholders})`).all(...ids);
  if (selected.length !== ids.length) throw httpError(404, "One or more selected water records no longer exist. Refresh and retry.");
  const removed = db.prepare(`DELETE FROM water_records WHERE id IN (${placeholders})`).run(...ids).changes;
  addAudit(actor, "water.record.delete", selected.map(record => `${record.recipient} ${record.date} × ${record.quantity}`).join("; "));
  return { removed, snapshot: waterSnapshot() };
}

function updateStockTransaction(id, body, actor) {
  const movement = db.prepare("SELECT * FROM stock_transactions WHERE id = ?").get(id);
  if (!movement) throw httpError(404, "Stock movement not found.");
  if (movement.voided_at || movement.reversal_of) throw httpError(409, "Voided or reversal movements cannot be edited.");
  if (!movement.batch_id) throw httpError(409, "This movement has no linked batch and cannot be safely edited.");
  const quantity = Number(body.quantity);
  if (!Number.isFinite(quantity) || quantity === 0 || Math.abs(quantity) > 1_000_000_000 ||
      Math.sign(quantity) !== Math.sign(movement.quantity)) {
    throw httpError(400, "Enter a non-zero quantity with the same direction as the original movement.");
  }
  const requestDate = optionalDate(body.requestDate, "Movement date");
  if (!requestDate || requestDate > todayKey()) throw httpError(400, "Movement date must be today or earlier.");
  const department = String(body.department ?? movement.department).trim().slice(0, 80);
  const person = String(body.person ?? movement.person).trim().slice(0, 80);
  const area = String(body.area ?? movement.area).trim().slice(0, 500);
  const issuedBy = String(body.issuedBy ?? movement.issued_by).trim().slice(0, 120);
  const reason = String(body.reason ?? movement.reason).trim().slice(0, 500);
  const notes = String(body.notes ?? movement.notes).trim().slice(0, 1000);
  const batch = db.prepare("SELECT * FROM batches WHERE id = ?").get(movement.batch_id);
  if (!batch) throw httpError(409, "The linked stock batch no longer exists.");
  const delta = quantity - movement.quantity;
  transaction(() => {
    const remaining = Number(batch.quantity_remaining) + delta;
    if (movement.quantity > 0) {
      const received = Number(batch.quantity_received) + delta;
      if (received <= 0 || remaining < 0 || remaining > received) {
        throw httpError(409, "That edit would conflict with stock already consumed from this batch.");
      }
      db.prepare("UPDATE batches SET quantity_received = ?, quantity_remaining = ? WHERE id = ?")
        .run(received, remaining, batch.id);
    } else {
      if (remaining < 0 || remaining > Number(batch.quantity_received)) {
        throw httpError(409, "That edit would make the batch balance invalid.");
      }
      db.prepare("UPDATE batches SET quantity_remaining = ? WHERE id = ?").run(remaining, batch.id);
    }
    db.prepare(`
      UPDATE stock_transactions
      SET quantity = ?, request_date = ?, department = ?, person = ?, area = ?, issued_by = ?, reason = ?, notes = ?
      WHERE id = ?
    `).run(quantity, requestDate, department, person, area, issuedBy, reason, notes, id);
    addAudit(actor, "stock.movement.update",
      `${movement.item_sku}: ${movement.quantity} → ${quantity}; date=${movement.request_date} → ${requestDate}; reason=${reason}`);
  });
  return { movement: db.prepare("SELECT * FROM stock_transactions WHERE id = ?").get(id) };
}

function reverseStockMovement(movement, reason, actor) {
  if (movement.voided_at || movement.reversal_of) throw httpError(409, "This movement has already been voided or is a reversal.");
  if (!movement.batch_id) throw httpError(409, "This movement has no linked batch and cannot be safely reversed.");
  const batch = db.prepare("SELECT * FROM batches WHERE id = ?").get(movement.batch_id);
  if (!batch) throw httpError(409, "The linked stock batch no longer exists.");
  const delta = -Number(movement.quantity);
  const remaining = Number(batch.quantity_remaining) + delta;
  if (movement.quantity > 0) {
    if (remaining < 0 || remaining > Number(batch.quantity_received)) {
      throw httpError(409, "This receipt cannot be reversed because some of its stock has already been consumed.");
    }
  } else if (remaining < 0 || remaining > Number(batch.quantity_received)) {
    throw httpError(409, "Reversing this issue would make the batch balance invalid.");
  }
  db.prepare("UPDATE batches SET quantity_remaining = ? WHERE id = ?").run(remaining, batch.id);
  db.prepare("UPDATE stock_transactions SET voided_at = ?, voided_by = ?, void_reason = ? WHERE id = ?")
    .run(nowIso(), actor.display_name, reason, movement.id);
  const reversalId = crypto.randomUUID();
  db.prepare(`
    INSERT INTO stock_transactions (
      id, kind, item_id, item_sku, item_name, batch_id, location_id, location_name, quantity, unit,
      department, person, area, issued_by, supplier, purchase_reference, reason, notes, request_date,
      expires_on, created_by, created_at, reversal_of
    ) VALUES (?, 'adjustment', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    reversalId, movement.item_id, movement.item_sku, movement.item_name, movement.batch_id, movement.location_id,
    movement.location_name, delta, movement.unit, movement.department, movement.person, movement.area,
    movement.issued_by, movement.supplier, movement.purchase_reference, `Reversal of ${movement.id}: ${reason}`,
    `Reverses stock movement ${movement.id}.`, movement.request_date, movement.expires_on, actor.display_name, nowIso(), movement.id,
  );
}

function voidStockTransaction(id, body, actor) {
  const movement = db.prepare("SELECT * FROM stock_transactions WHERE id = ?").get(id);
  if (!movement) throw httpError(404, "Stock movement not found.");
  const reason = String(body.reason || "").trim();
  if (reason.length < 3 || reason.length > 500) throw httpError(400, "Enter a void reason (3–500 characters).");
  transaction(() => {
    reverseStockMovement(movement, reason, actor);
    addAudit(actor, "stock.movement.void", `${movement.item_sku} ${movement.quantity} reversed: ${reason}`);
  });
  return { voided: true };
}

function getStockRequestMovements(id) {
  return db.prepare(`
    SELECT * FROM stock_transactions
    WHERE (request_group_id = ? OR (request_group_id IS NULL AND id = ?))
      AND quantity < 0 AND kind IN ('requisition', 'issue')
      AND voided_at IS NULL AND reversal_of IS NULL
    ORDER BY created_at, id
  `).all(id, id);
}

function updateStockRequest(id, body, actor) {
  const movements = getStockRequestMovements(id);
  if (!movements.length) throw httpError(404, "Stock request not found or has already been removed.");
  const first = movements[0];
  const quantity = finitePositive(body.quantity, "Requested quantity");
  const requestDate = optionalDate(body.requestDate, "Request date");
  if (!requestDate || requestDate > todayKey()) throw httpError(400, "Request date must be today or earlier.");
  const person = String(body.person ?? first.person).trim().slice(0, 80);
  const issuedBy = String(body.issuedBy ?? first.issued_by).trim().slice(0, 120);
  const item = db.prepare("SELECT * FROM items WHERE id = ?").get(first.item_id);
  if (!item) throw httpError(409, "The requested catalog item no longer exists.");
  const location = db.prepare("SELECT id, name FROM locations WHERE name = ? COLLATE NOCASE AND active = 1").get(item.store);
  if (!location) throw httpError(409, "The request's store is no longer active.");
  const requestGroupId = first.request_group_id || id;
  const reason = `Correction of stock request ${id}`;
  transaction(() => {
    for (const movement of movements) reverseStockMovement(movement, reason, actor);
    consumeBatches(item, location, quantity, actor, {
      kind: first.kind,
      requestGroupId,
      department: first.department,
      person,
      area: first.area,
      issuedBy,
      reason,
      notes: first.notes,
      requestDate,
    });
    addAudit(actor, "stock.request.update",
      `${first.item_sku}: ${Math.abs(movements.reduce((sum, movement) => sum + Number(movement.quantity), 0))} → ${quantity}; date=${first.request_date} → ${requestDate}`);
  });
  refreshRequestsMonthArchive(first.request_date.slice(0, 7));
  refreshRequestsMonthArchive(requestDate.slice(0, 7));
  return { updated: true };
}

function voidStockRequest(id, body, actor) {
  const movements = getStockRequestMovements(id);
  if (!movements.length) throw httpError(404, "Stock request not found or has already been removed.");
  const reason = String(body.reason || "").trim();
  if (reason.length < 3 || reason.length > 500) throw httpError(400, "Enter a removal reason (3–500 characters).");
  transaction(() => {
    for (const movement of movements) reverseStockMovement(movement, reason, actor);
    const quantity = movements.reduce((sum, movement) => sum + Math.abs(Number(movement.quantity)), 0);
    addAudit(actor, "stock.request.remove", `${movements[0].item_sku} × ${quantity}: ${reason}`);
  });
  refreshRequestsMonthArchive(movements[0].request_date.slice(0, 7));
  return { removed: true };
}

function validateReportRange(from, to) {
  if (!isDate(from) || !isDate(to) || from > to) throw httpError(400, "Choose valid dates with the start on or before the end.");
  if (dateDiff(from, to) > 3660) throw httpError(400, "Report date ranges may not exceed ten years.");
}

function stockReport(body) {
  const reportKind = String(body.reportKind || "movements");
  if (!["requisition", "updates", "entries", "movements"].includes(reportKind)) {
    throw httpError(400, "Choose a valid stock report.");
  }
  if (reportKind === "updates") {
    const store = String(body.store || "");
    if (!getLocations().some(location => location.name === store)) throw httpError(400, "Choose a valid store for the stock updates report.");
    const items = stockItems({ store });
    const inventoryColumns = getInventoryColumns();
    const today = todayKey();
    return {
      type: "stock",
      reportType: "current",
      reportKind,
      store,
      from: today,
      to: today,
      title: `Current stock updates · ${store} · ${today}`,
      headers: [
        "SKU", "Item", "Store", "Category", "Previous Month Stock Quantity", "Received Stock Quantity",
        "Current Quantity", "Removed", "Remainder", "Status",
        ...inventoryColumns.map(column => column.name),
        "Live On Hand", "Unit",
      ],
      rows: items.map(item => ({
        SKU: item.sku,
        Item: item.name,
        Store: item.store,
        Category: item.category,
        "Previous Month Stock Quantity": item.previous_month_quantity,
        "Received Stock Quantity": item.received_stock_quantity,
        "Current Quantity": item.current_quantity,
        Removed: item.removed,
        Remainder: item.remainder,
        Status: `${item.status_percent.toFixed(1)}%`,
        ...Object.fromEntries(inventoryColumns.map(column => [column.name, item.custom_values[column.id] || ""])),
        "Live On Hand": item.on_hand,
        Unit: item.unit,
      })),
    };
  }
  const type = body.type;
  const from = String(body.from || "");
  const to = String(body.to || "");
  let start;
  let end;
  if (type === "daily") {
    start = end = String(body.date || "");
    validateReportRange(start, end);
  } else if (type === "monthly") {
    const month = String(body.month || "");
    if (!/^\d{4}-\d{2}$/.test(month) || Number(month.slice(5)) < 1 || Number(month.slice(5)) > 12) throw httpError(400, "Choose a valid report month.");
    const [year, monthNumber] = month.split("-").map(Number);
    start = `${month}-01`;
    end = new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10);
  } else if (type === "range") {
    start = from;
    end = to;
    validateReportRange(start, end);
  } else {
    throw httpError(400, "Choose a valid stock report type.");
  }
  const category = body.category && body.category !== "All" ? String(body.category) : "";
  if (category && !getCategories().some(entry => entry.name === category)) throw httpError(400, "Select a valid stock category.");
  const store = reportKind === "requisition" && body.store ? String(body.store) : "";
  if (store && !getLocations().some(location => location.name === store)) throw httpError(400, "Select a valid store for the requisition report.");
  const rows = db.prepare(`
    SELECT t.request_date AS date, t.item_name AS item, t.item_sku AS sku, i.category,
      COALESCE(t.request_group_id, t.id) AS requestId,
      COALESCE(l.name, t.location_name) AS location,
      t.quantity, t.unit, t.kind, t.department, t.person, t.area, t.issued_by AS issuedBy, t.supplier,
      t.purchase_reference AS purchaseReference, t.reason, t.expires_on AS expiresOn, t.created_by AS createdBy
    FROM stock_transactions t
    LEFT JOIN items i ON i.id = t.item_id
    LEFT JOIN locations l ON l.id = t.location_id
    WHERE t.request_date >= ? AND t.request_date <= ? AND t.voided_at IS NULL
      AND (
        ? = 'movements'
        OR (? = 'requisition' AND t.quantity < 0 AND t.kind IN ('requisition', 'issue'))
        OR (? = 'entries' AND t.quantity > 0 AND t.kind IN ('receipt', 'adjustment'))
      )
      AND (? = '' OR i.category = ? OR (i.category IS NULL AND t.item_sku IN
        (SELECT sku FROM items WHERE category = ?)))
      AND (? = '' OR COALESCE(l.name, t.location_name) = ?)
    ORDER BY t.created_at, t.item_name
  `).all(start, end, reportKind, reportKind, reportKind, category, category, category, store, store);
  const filtered = category
    ? rows.filter(row => row.category === category)
    : rows;
  const reportRows = reportKind === "requisition"
    ? [...filtered.reduce((grouped, row) => {
      const current = grouped.get(row.requestId);
      if (current) current.quantity += row.quantity;
      else grouped.set(row.requestId, { ...row });
      return grouped;
    }, new Map()).values()]
    : filtered;
  const totals = new Map();
  for (const row of filtered) {
    const key = `${row.item}\u0000${row.location}\u0000${row.unit}`;
    const existing = totals.get(key) || { item: row.item, sku: row.sku, category: row.category || "Archived", location: row.location, unit: row.unit, received: 0, issued: 0, net: 0 };
    if (row.quantity > 0) existing.received += row.quantity;
    else existing.issued += Math.abs(row.quantity);
    existing.net += row.quantity;
    totals.set(key, existing);
  }
  const reportTitle = reportKind === "requisition" ? "Requisition report" :
    reportKind === "entries" ? "Stock entries report" : "All stock movements report";
  const storeLabel = reportKind === "requisition" && store ? ` · ${store}` : "";
  const title = type === "daily" ? `${reportTitle}${storeLabel} · ${start}` :
    type === "monthly" ? `${reportTitle} · ${start.slice(0, 7)}` :
      `${reportTitle}${storeLabel} · ${start} to ${end}`;
  return {
    type: "stock",
    reportType: type,
    reportKind,
    from: start,
    to: end,
    category: category || "All",
    title,
    headers: ["Date", "SKU", "Item", "Category", "Location", "Movement", "Quantity", "Unit", "Department", "Person", "Area", "Issued By", "Supplier", "Reference", "Reason", "Expiry"],
    rows: reportRows.map(row => ({
      Date: row.date,
      SKU: row.sku,
      Item: row.item,
      Category: row.category || "Archived",
      Location: row.location,
      Movement: row.kind,
      Quantity: row.quantity,
      Unit: row.unit,
      Department: row.department,
      Person: row.person,
      Area: row.area,
      "Issued By": row.issuedBy,
      Supplier: row.supplier,
      Reference: row.purchaseReference,
      Reason: row.reason,
      Expiry: row.expiresOn,
    })),
    summary: [...totals.values()],
  };
}

function waterReport(body) {
  const type = body.type;
  let from;
  let to;
  let label;
  if (type === "daily") {
    from = to = String(body.date || "");
    validateReportRange(from, to);
    label = from;
  } else if (type === "monthly") {
    const month = String(body.month || "");
    if (!/^\d{4}-\d{2}$/.test(month) || Number(month.slice(5)) < 1 || Number(month.slice(5)) > 12) throw httpError(400, "Choose a valid report month.");
    const [year, monthNumber] = month.split("-").map(Number);
    from = `${month}-01`;
    to = new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10);
    label = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" })
      .format(new Date(Date.UTC(year, monthNumber - 1, 1)));
  } else if (type === "range") {
    from = String(body.from || "");
    to = String(body.to || "");
    validateReportRange(from, to);
    label = `${from} to ${to}`;
  } else {
    throw httpError(400, "Choose a valid water report type.");
  }
  const records = db.prepare(`
    SELECT date AS date, recipient AS recipient, quantity, requested_by AS requestedBy, issued_by AS issuedBy, created_by AS createdBy
    FROM water_records WHERE date >= ? AND date <= ? ORDER BY date, recipient COLLATE NOCASE, created_at
  `).all(from, to);
  if (type === "daily") {
    return {
      type: "water",
      reportType: type,
      from,
      to,
      title: `Daily water report · ${label}`,
      headers: ["Rooms/ Area", "Quantity In Packs", "Requested By", "Issued By"],
      rows: records.map(record => ({
        "Rooms/ Area": record.recipient,
        "Quantity In Packs": record.quantity,
        "Requested By": record.requestedBy,
        "Issued By": record.issuedBy,
      })),
    };
  }
  const totals = new Map();
  for (const record of records) totals.set(record.recipient, (totals.get(record.recipient) || 0) + record.quantity);
  return {
    type: "water",
    reportType: type,
    from,
    to,
    title: type === "monthly" ? `Monthly water report · ${label}` : `Water report · ${label}`,
    headers: ["Date", "Rooms/ Area", "Quantity In packs"],
    rows: [...totals.entries()].sort(([first], [second]) => first.localeCompare(second)).map(([recipient, quantity]) => ({
      Date: label,
      "Rooms/ Area": recipient,
      "Quantity In packs": quantity,
    })),
  };
}

function reportFromBody(body) {
  if (!body || typeof body !== "object") throw httpError(400, "Choose a valid report.");
  return body.report === "water" ? waterReport(body) : stockReport(body);
}

function csvCell(value) {
  const text = String(value ?? "");
  const safeText = typeof value === "string" && /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safeText.replaceAll('"', '""')}"`;
}

function reportCsv(report) {
  return [report.headers, ...report.rows.map(row => report.headers.map(header => row[header]))]
    .map(row => row.map(csvCell).join(","))
    .join("\r\n");
}

function csvFilename(report) {
  return `${report.type}-report-${report.from}-to-${report.to}.csv`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

async function sendReportEmail(body, actor) {
  if (!gmailAppPassword || !mailerAddress) throw httpError(400, "Configure the Gmail sender and App Password in Admin → Email first.");
  const to = String(body.to || "").trim();
  if (!validateEmail(to)) throw httpError(400, "Enter a valid destination email address.");
  const report = reportFromBody(body);
  if (!report.rows.length) throw httpError(404, "No records were found for this report period. Nothing was emailed.");
  const nodemailer = require("nodemailer");
  mailer = nodemailer.createTransport({
    service: "gmail",
    auth: { user: mailerAddress, pass: gmailAppPassword },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 30000,
  });
  try {
    await mailer.sendMail({
      from: { name: "Capitol Stock Management", address: mailerAddress },
      to,
      subject: report.title,
      text: `Your generated Capitol Stock Management report is attached.\n\n${report.title}\n${report.rows.length} report rows\n\nGenerated by ${actor.display_name}.`,
      html: `<p>Your generated Capitol Stock Management report is attached.</p><p><strong>${escapeHtml(report.title)}</strong><br>${report.rows.length} report rows</p>`,
      attachments: [{
        filename: csvFilename(report),
        content: `\uFEFF${reportCsv(report)}`,
        contentType: "text/csv; charset=utf-8",
      }],
    });
  } catch (error) {
    console.error("Gmail report delivery failed:", error.message);
    throw httpError(502, "Gmail could not send the report. Check the sender address, App Password, Gmail security settings, and internet connection.");
  }
  addAudit(actor, "report.email", `${report.title} → ${to}`);
  return { sent: true, to, title: report.title };
}

function createUser(body, actor) {
  const username = String(body?.username || "").trim();
  const displayName = String(body?.displayName || "").trim();
  const password = String(body?.password || "");
  const role = ["admin", "user", "auditor"].includes(body?.role) ? body.role : "";
  if (!/^[A-Za-z0-9._-]{3,40}$/.test(username)) throw httpError(400, "Username must be 3–40 letters, numbers, dots, dashes or underscores.");
  if (displayName.length < 2 || displayName.length > 80) throw httpError(400, "Display name must be 2–80 characters.");
  if (!role) throw httpError(400, "Select a valid account role.");
  validateNewPassword(password);
  const salt = crypto.randomBytes(16).toString("hex");
  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO users (id, username, display_name, role, password_salt, password_hash, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, username, displayName, role, salt, passwordHash(password, salt), nowIso());
  addAudit(actor, "user.create", `${username} (${role})`);
  return userView(db.prepare("SELECT * FROM users WHERE id = ?").get(id));
}

function validateNewPassword(password) {
  if (usePostgres) {
    if (typeof password !== "string" || !/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{12,128}$/.test(password)) {
      throw httpError(400, "Cloud passwords must be 12–128 characters and include an uppercase letter, a lowercase letter, and a number.");
    }
    return;
  }
  if (typeof password !== "string" || !/^\d{4}$/.test(password)) {
    throw httpError(400, "Password must be exactly four numbers.");
  }
}

function updateUser(id, body, actor) {
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
  if (!user) throw httpError(404, "User not found.");
  const displayName = String(body?.displayName || "").trim();
  if (displayName.length < 2 || displayName.length > 80) throw httpError(400, "Display name must be 2–80 characters.");
  const active = body.active === false ? 0 : 1;
  const role = ["admin", "user", "auditor"].includes(body.role) ? body.role : user.role;
  if (user.id === actor.id && active === 0) throw httpError(400, "You cannot disable your own account.");
  if (user.id === actor.id && role !== user.role) throw httpError(400, "You cannot change your own account role.");
  if (user.role === "admin" && user.active && (active === 0 || role !== "admin") && countAdmins() <= 1) {
    throw httpError(400, "At least one active administrator must remain.");
  }
  db.prepare("UPDATE users SET display_name = ?, role = ?, active = ? WHERE id = ?").run(displayName, role, active, id);
  addAudit(actor, "user.update", `${user.username}: role=${role}, active=${Boolean(active)}`);
  return userView(db.prepare("SELECT * FROM users WHERE id = ?").get(id));
}

function deleteUser(id, actor) {
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
  if (!user) throw httpError(404, "User not found.");
  if (user.id === actor.id) throw httpError(400, "You cannot delete your own account.");
  if (user.role === "admin" && user.active && countAdmins() <= 1) {
    throw httpError(400, "At least one active administrator must remain.");
  }
  db.prepare("DELETE FROM users WHERE id = ?").run(id);
  for (const [sessionId, session] of sessions) {
    if (session.userId === id) sessions.delete(sessionId);
  }
  addAudit(actor, "user.delete", `${user.username} (${user.role}); historical entries retain the recorded name.`);
  return { deleted: true };
}

function resetUserPassword(id, body, actor) {
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(id);
  if (!user) throw httpError(404, "User not found.");
  validateNewPassword(body?.password);
  const salt = crypto.randomBytes(16).toString("hex");
  if (usePostgres) {
    transaction(() => {
      db.prepare("UPDATE users SET password_salt = ?, password_hash = ?, password_reset_required = 0 WHERE id = ?")
        .run(salt, passwordHash(body.password, salt), id);
      db.prepare("DELETE FROM login_attempts WHERE user_id = ?").run(id);
    });
  } else {
    db.prepare("UPDATE users SET password_salt = ?, password_hash = ? WHERE id = ?")
      .run(salt, passwordHash(body.password, salt), id);
  }
  addAudit(actor, "user.password_reset", user.username);
  return { updated: true };
}

function adminOverview() {
  const settings = getSettings();
  return {
    users: db.prepare("SELECT * FROM users ORDER BY created_at").all().map(userView),
    locations: db.prepare("SELECT id, name, active FROM locations ORDER BY name COLLATE NOCASE").all().map(row => ({ ...row, active: Boolean(row.active) })),
    categories: getCategories(true),
    inventoryColumns: getInventoryColumns(true),
    requesters: db.prepare("SELECT id, scope, department, name, active FROM requesters ORDER BY scope, department, name COLLATE NOCASE").all().map(row => ({ ...row, active: Boolean(row.active) })),
    departments: getDepartmentRecords(),
    housekeepingAreas: getHousekeepingAreas(),
    settings: {
      gmailAddress: settings.gmailAddress || "",
      appPasswordConfigured: Boolean(gmailAppPassword && mailerAddress),
      appearance: getAppearanceSettings(settings),
    },
    audit: db.prepare("SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 100").all(),
  };
}

function resetSystemData(actor) {
  const counts = {
    movements: Number(db.prepare("SELECT COUNT(*) AS count FROM stock_transactions").get().count),
    items: Number(db.prepare("SELECT COUNT(*) AS count FROM items").get().count),
    batches: Number(db.prepare("SELECT COUNT(*) AS count FROM batches").get().count),
    inventoryArchives: Number(db.prepare("SELECT COUNT(*) AS count FROM inventory_month_archives").get().count),
    requestArchives: Number(db.prepare("SELECT COUNT(*) AS count FROM requests_month_archives").get().count),
    waterRecords: Number(db.prepare("SELECT COUNT(*) AS count FROM water_records").get().count),
    requesters: Number(db.prepare("SELECT COUNT(*) AS count FROM requesters").get().count),
    users: Number(db.prepare("SELECT COUNT(*) AS count FROM users").get().count),
  };
  transaction(() => {
    db.exec(`
      DELETE FROM stock_transactions;
      DELETE FROM batches;
      DELETE FROM items;
      DELETE FROM inventory_month_archives;
      DELETE FROM requests_month_archives;
      DELETE FROM inventory_columns;
      DELETE FROM water_records;
      DELETE FROM requesters;
      DELETE FROM housekeeping_areas;
      DELETE FROM departments;
      DELETE FROM categories;
      DELETE FROM locations;
      DELETE FROM audit_log;
      DELETE FROM settings;
    `);
    for (const name of DEFAULT_CATEGORIES) {
      db.prepare("INSERT INTO categories (id, name) VALUES (?, ?)").run(crypto.randomUUID(), name);
    }
    for (const name of DEFAULT_STORES) {
      db.prepare("INSERT INTO locations (id, name) VALUES (?, ?)").run(crypto.randomUUID(), name);
    }
    const insertDepartment = db.prepare(`
      INSERT INTO departments (id, name, kind, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const department of DEFAULT_DEPARTMENTS) {
      insertDepartment.run(department.id, department.name, department.kind, nowIso(), nowIso());
    }
    const insertArea = db.prepare(`
      INSERT INTO housekeeping_areas (id, name, created_at, updated_at)
      VALUES (?, ?, ?, ?)
    `);
    for (const name of DEFAULT_AREAS) insertArea.run(crypto.randomUUID(), name, nowIso(), nowIso());
    for (const name of WATER_REQUESTERS) {
      db.prepare("INSERT INTO requesters (id, scope, department, name) VALUES (?, 'water', '', ?)").run(crypto.randomUUID(), name);
    }
    for (const [department, names] of Object.entries(DEPARTMENT_PEOPLE)) {
      for (const name of names) {
        db.prepare("INSERT INTO requesters (id, scope, department, name) VALUES (?, 'stock', ?, ?)")
          .run(crypto.randomUUID(), department, name);
      }
    }
    db.prepare("INSERT INTO settings (key, value) VALUES ('inventory_store_migration_v2', '1')").run();
    db.prepare("INSERT INTO settings (key, value) VALUES ('departments_areas_seed_v1', '1')").run();
    db.prepare("INSERT INTO settings (key, value) VALUES ('stock_requesters_seed_v1', '1')").run();
    addAudit(actor, "system.clear_all", `Cleared ${counts.items} items, ${counts.movements} stock movements, ${counts.batches} batches and ${counts.waterRecords} water records; retained ${counts.users} user accounts.`);
  });
  gmailAppPassword = "";
  mailerAddress = "";
  mailer = null;
  return { cleared: true, counts, stores: DEFAULT_STORES, categories: DEFAULT_CATEGORIES };
}

function publicBootstrap(request) {
  const adminCount = db.prepare("SELECT COUNT(*) AS count FROM users").get().count;
  const session = currentSession(request);
  const base = {
    setupRequired: adminCount === 0,
    passwordPolicy: usePostgres ? "strong" : "pin",
    categories: getCategories().map(category => category.name),
    stores: getLocations().map(location => location.name),
    inventoryColumns: getInventoryColumns(),
    departments: getDepartments(),
    departmentKinds: Object.fromEntries(getDepartmentRecords().map(department => [department.name, department.kind])),
    people: getPeople(),
    areas: getAreas(),
    waterStaff: WATER_STAFF,
    waterRooms: WATER_ROOMS,
    waterRequesters: getWaterRequesters(),
    appearance: getAppearanceSettings(),
    user: null,
    csrfToken: null,
    gmailConfigured: Boolean(gmailAppPassword && mailerAddress),
  };
  if (!session) return base;
  const user = db.prepare("SELECT * FROM users WHERE id = ? AND active = 1").get(session.userId);
  if (!user) {
    sessions.delete(parseCookies(request)[SESSION_COOKIE]);
    return base;
  }
  session.expiresAt = Date.now() + SESSION_MS;
  return {
    ...base,
    setupRequired: false,
    user: userView(user),
    csrfToken: session.csrfToken,
    gmailConfigured: Boolean(gmailAppPassword && mailerAddress),
  };
}

function assertBodyObject(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw httpError(400, "Request data must be a JSON object.");
}

function asyncRoute(handler) {
  return async (request, response) => {
    try {
      const session = currentSession(request);
      const body = ["POST", "PUT", "PATCH", "DELETE"].includes(request.method) ? await readBody(request) : {};
      if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) ensureSameOrigin(request);
      assertBodyObject(body);
      const result = await handler(request, response, body, session);
      if (response.writableEnded) return;
      sendJson(response, result?.statusCode || 200, result?.body ?? result);
    } catch (error) {
      const status = error.statusCode || (usePostgres && error.code === "23505" ? 409 : 500);
      if (status >= 500) console.error("Request failed:", error);
      const message = status === 409
        ? "A record with the same unique value already exists."
        : status >= 500
          ? "A server error occurred. Please try again or contact an administrator."
          : error.message;
      if (!response.headersSent && !response.destroyed) sendJson(response, status, { error: message });
    }
  };
}

const routes = new Map();
function route(method, pathname, handler) {
  routes.set(`${method} ${pathname}`, asyncRoute(handler));
}

route("GET", "/api/bootstrap", request => {
  ensurePreviousMonthInventoryArchive();
  return publicBootstrap(request);
});
route("POST", "/api/setup", (_request, _response, body) => {
  if (db.prepare("SELECT 1 AS found FROM users LIMIT 1").get()) throw httpError(409, "Initial setup is already complete. Sign in instead.");
  const username = String(body.username || "").trim();
  const displayName = String(body.displayName || "").trim();
  if (!/^[A-Za-z0-9._-]{3,40}$/.test(username)) throw httpError(400, "Username must be 3–40 letters, numbers, dots, dashes or underscores.");
  if (displayName.length < 2 || displayName.length > 80) throw httpError(400, "Administrator name must be 2–80 characters.");
  validateNewPassword(body.password);
  const salt = crypto.randomBytes(16).toString("hex");
  const id = crypto.randomUUID();
  transaction(() => {
    db.prepare(`
      INSERT INTO users (id, username, display_name, role, password_salt, password_hash, created_at)
      VALUES (?, ?, ?, 'admin', ?, ?, ?)
    `).run(id, username, displayName, salt, passwordHash(body.password, salt), nowIso());
    addAudit({ id, display_name: displayName }, "setup.complete", "Initial administrator created.");
  });
  return { body: { created: true } };
});
route("POST", "/api/login", (request, response, body) => {
  const username = String(body.username || "").trim();
  let user = db.prepare("SELECT * FROM users WHERE username = ? COLLATE NOCASE AND active = 1").get(username);
  const key = user ? user.id : username.toLowerCase();
  const storedAttempts = usePostgres && user
    ? db.prepare("SELECT failures AS count, window_started_at AS since FROM login_attempts WHERE user_id = ?").get(user.id)
    : loginAttempts.get(key);
  const attempts = storedAttempts
    ? { count: Number(storedAttempts.count), since: Number(storedAttempts.since) }
    : { count: 0, since: Date.now() };
  if (Date.now() - attempts.since > 15 * 60_000) {
    attempts.count = 0;
    attempts.since = Date.now();
  }
  if (attempts.count >= 8) throw httpError(429, "Too many sign-in attempts. Wait 15 minutes and try again.");
  const valid = user && passwordMatches(String(body.password || ""), user.password_salt, user.password_hash);
  if (!valid) {
    attempts.count += 1;
    if (usePostgres && user) {
      db.prepare(`
        INSERT INTO login_attempts (user_id, failures, window_started_at)
        VALUES (?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE
        SET failures = excluded.failures, window_started_at = excluded.window_started_at
      `).run(user.id, attempts.count, attempts.since);
    } else if (!usePostgres) {
      loginAttempts.set(key, attempts);
    }
    throw httpError(401, "Username or password is incorrect.");
  }
  if (usePostgres && user.password_reset_required) {
    if (!body.newPassword) return { body: { passwordResetRequired: true } };
    validateNewPassword(body.newPassword);
    const salt = crypto.randomBytes(16).toString("hex");
    transaction(() => {
      db.prepare("UPDATE users SET password_salt = ?, password_hash = ?, password_reset_required = 0 WHERE id = ?")
        .run(salt, passwordHash(body.newPassword, salt), user.id);
      db.prepare("DELETE FROM login_attempts WHERE user_id = ?").run(user.id);
    });
    addAudit(user, "auth.password_reset_required", "Replaced the imported PIN with a cloud password.");
    user = db.prepare("SELECT * FROM users WHERE id = ? AND active = 1").get(user.id);
  } else if (usePostgres) {
    db.prepare("DELETE FROM login_attempts WHERE user_id = ?").run(user.id);
  } else {
    loginAttempts.delete(key);
  }
  const sessionId = crypto.randomBytes(32).toString("base64url");
  const csrfToken = crypto.randomBytes(32).toString("base64url");
  sessions.set(sessionId, { userId: user.id, role: user.role, csrfToken, expiresAt: Date.now() + SESSION_MS });
  setSessionCookie(response, sessionId);
  addAudit(user, "auth.login", "Signed in.");
  return { body: { user: userView(user), csrfToken } };
});
route("POST", "/api/logout", (request, response) => {
  const session = requireSession(request, true);
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(session.userId);
  if (user) addAudit(user, "auth.logout", "Signed out.");
  sessions.delete(parseCookies(request)[SESSION_COOKIE]);
  clearSessionCookie(response);
  return { body: { signedOut: true } };
});
route("GET", "/api/dashboard", request => {
  requireSession(request);
  const items = stockItems();
  return {
    today: todayKey(),
    totalItems: items.length,
    totalUnits: items.reduce((sum, item) => sum + item.on_hand, 0),
    lowStock: items.filter(item => item.stock_status === "Low stock").length,
    outOfStock: items.filter(item => item.stock_status === "Out of stock").length,
    stockIssuedToday: db.prepare("SELECT COUNT(*) AS count FROM stock_transactions WHERE quantity < 0 AND voided_at IS NULL AND substr(request_date, 1, 10) = ?").get(todayKey()).count,
    waterIssuedToday: db.prepare("SELECT COUNT(*) AS count FROM water_records WHERE date = ?").get(todayKey()).count,
    expiring: getInventorySummary().expiring,
    recent: db.prepare("SELECT * FROM stock_transactions WHERE voided_at IS NULL ORDER BY created_at DESC LIMIT 10").all(),
    categoryTotals: db.prepare(`
      SELECT i.category, COALESCE(SUM(b.quantity_remaining), 0) AS quantity, COUNT(DISTINCT i.id) AS items
      FROM items i LEFT JOIN batches b ON b.item_id = i.id
      WHERE i.active = 1 GROUP BY i.category ORDER BY i.category
    `).all(),
  };
});
route("GET", "/api/inventory", (request, _response, _body, session) => {
  requireSession(request);
  const url = new URL(request.url, `http://${HOST}:${PORT}`);
  return { items: stockItems({
    search: url.searchParams.get("q") || "",
    category: url.searchParams.get("category") || "",
    locationId: url.searchParams.get("locationId") || "",
  }), locations: getLocations(), inventoryColumns: getInventoryColumns() };
});
route("GET", "/api/inventory/archives", request => {
  requireSession(request);
  ensurePreviousMonthInventoryArchive();
  return { archives: listInventoryArchives() };
});
route("GET", "/api/admin/archived-items", request => {
  requireAdmin(request);
  return { items: stockItems({ includeInactive: true }).filter(item => !item.active) };
});
route("GET", "/api/items", request => {
  requireSession(request);
  const url = new URL(request.url, `http://${HOST}:${PORT}`);
  return {
    items: stockItems({
      search: url.searchParams.get("q") || "",
      locationId: url.searchParams.get("locationId") || "",
    }),
    locations: getLocations(),
  };
});
route("POST", "/api/stock/issue", (request, _response, body) => {
  const actor = requireNonAuditor(request, true);
  return issueStock(body, db.prepare("SELECT * FROM users WHERE id = ?").get(actor.userId));
});
route("POST", "/api/stock/receipt", (request, _response, body) => {
  const admin = requireAdmin(request, true);
  const actor = db.prepare("SELECT * FROM users WHERE id = ?").get(admin.userId);
  const item = itemById(String(body.itemId || ""));
  transaction(() => {
    receiveBatch(body, actor, item);
    addAudit(actor, "stock.receive", `${item.sku} +${body.quantity} ${item.unit} at ${locationById(body.locationId).name}`);
  });
  return { inventory: stockItems() };
});
route("GET", "/api/transactions", (request, _response, _body, session) => {
  requireSession(request);
  const url = new URL(request.url, `http://${HOST}:${PORT}`);
  const from = url.searchParams.get("from") || "";
  const to = url.searchParams.get("to") || "";
  if ((from || to) && (!isDate(from) || !isDate(to) || from > to)) throw httpError(400, "Use a valid movement date range.");
  const category = url.searchParams.get("category") || "";
  const kind = url.searchParams.get("kind") || "";
  const rows = db.prepare(`
    SELECT t.*,
      COALESCE(i.category, 'Archived') AS category,
      b.batch_number AS batch_number
    FROM stock_transactions t
    LEFT JOIN items i ON i.id = t.item_id
    LEFT JOIN batches b ON b.id = t.batch_id
    WHERE (? = '' OR t.request_date >= ?)
      AND (? = '' OR t.request_date <= ?)
      AND (? = '' OR i.category = ?)
      AND (? = '' OR t.kind = ?)
    ORDER BY t.created_at DESC
  `).all(from, from, to, to, category, category, kind, kind);
  return { rows, count: rows.length, truncated: false };
});
route("GET", "/api/requests", request => {
  requireSession(request);
  const store = new URL(request.url, `http://${HOST}:${PORT}`).searchParams.get("store") || "";
  if (store && !getLocations().some(location => location.name === store)) throw httpError(400, "Choose a valid store.");
  ensureRequestsMonthArchives();
  const month = todayKey().slice(0, 7);
  const rows = stockRequestRows(`${month}-01`, todayKey(), store, Boolean(store));
  return { month, stores: getLocations().map(location => location.name), rows, count: rows.length };
});
route("GET", "/api/requests/archives", request => {
  requireSession(request);
  ensureRequestsMonthArchives();
  return { archives: listRequestsMonthArchives() };
});
route("GET", "/api/water", request => {
  requireSession(request);
  return waterSnapshot();
});
route("POST", "/api/water/issue", (request, _response, body) => {
  const session = requireNonAuditor(request, true);
  const actor = db.prepare("SELECT * FROM users WHERE id = ?").get(session.userId);
  const result = issueWater(body, actor);
  if (!result.issued.length) throw Object.assign(httpError(409, "No selected recipients were eligible. All selected rooms are still in cooldown."), { skipped: result.skipped });
  return result;
});
route("DELETE", "/api/water/records", (request, _response, body) => {
  const admin = requireAdmin(request, true);
  const actor = db.prepare("SELECT * FROM users WHERE id = ?").get(admin.userId);
  return deleteWaterRecords(body.recordIds, actor);
});
route("PUT", "/api/admin/water-records/:id", (request, _response, body) => {
  const admin = requireAdmin(request, true);
  const id = new URL(request.url, `http://${HOST}:${PORT}`).pathname.split("/").pop();
  const actor = db.prepare("SELECT * FROM users WHERE id = ?").get(admin.userId);
  return updateWaterRecord(id, body, actor);
});
route("PUT", "/api/admin/transactions/:id", (request, _response, body) => {
  const admin = requireAdmin(request, true);
  const id = new URL(request.url, `http://${HOST}:${PORT}`).pathname.split("/").pop();
  const actor = db.prepare("SELECT * FROM users WHERE id = ?").get(admin.userId);
  return updateStockTransaction(id, body, actor);
});
route("DELETE", "/api/admin/transactions/:id", (request, _response, body) => {
  const admin = requireAdmin(request, true);
  const id = new URL(request.url, `http://${HOST}:${PORT}`).pathname.split("/").pop();
  const actor = db.prepare("SELECT * FROM users WHERE id = ?").get(admin.userId);
  return voidStockTransaction(id, body, actor);
});
route("PUT", "/api/admin/requests/:id", (request, _response, body) => {
  const admin = requireAdmin(request, true);
  const id = new URL(request.url, `http://${HOST}:${PORT}`).pathname.split("/").pop();
  const actor = db.prepare("SELECT * FROM users WHERE id = ?").get(admin.userId);
  return updateStockRequest(id, body, actor);
});
route("DELETE", "/api/admin/requests/:id", (request, _response, body) => {
  const admin = requireAdmin(request, true);
  const id = new URL(request.url, `http://${HOST}:${PORT}`).pathname.split("/").pop();
  const actor = db.prepare("SELECT * FROM users WHERE id = ?").get(admin.userId);
  return voidStockRequest(id, body, actor);
});
route("POST", "/api/admin/reset", (request, _response, body) => {
  const admin = requireAdmin(request, true);
  if (body.confirmation !== "CLEAR ALL") throw httpError(400, "Confirm the reset by entering CLEAR ALL.");
  const actor = db.prepare("SELECT * FROM users WHERE id = ?").get(admin.userId);
  return resetSystemData(actor);
});
route("GET", "/api/auditor", request => {
  const session = requireSession(request);
  if (!["admin", "auditor"].includes(session.role)) throw httpError(403, "Auditor access is required.");
  return {
    inventory: stockItems({ includeInactive: true }),
    locations: db.prepare("SELECT id, name, active FROM locations ORDER BY name COLLATE NOCASE").all().map(row => ({ ...row, active: Boolean(row.active) })),
    movements: db.prepare(`
      SELECT t.*, COALESCE(i.category, 'Archived') AS category, b.batch_number AS batch_number
      FROM stock_transactions t
      LEFT JOIN items i ON i.id = t.item_id
      LEFT JOIN batches b ON b.id = t.batch_id
      ORDER BY t.request_date DESC, t.created_at DESC
    `).all(),
    waterRecords: db.prepare("SELECT * FROM water_records ORDER BY date DESC, created_at DESC").all(),
    audit: db.prepare("SELECT * FROM audit_log ORDER BY created_at DESC").all(),
  };
});
route("POST", "/api/reports", (request, _response, body) => {
  requireSession(request, true);
  return reportFromBody(body);
});
route("POST", "/api/reports/email", async (request, _response, body) => {
  const session = requireNonAuditor(request, true);
  const actor = db.prepare("SELECT * FROM users WHERE id = ?").get(session.userId);
  return await sendReportEmail(body, actor);
});
route("GET", "/api/admin", request => {
  requireAdmin(request);
  return adminOverview();
});
route("POST", "/api/admin/departments", (request, _response, body) => {
  const admin = requireAdmin(request, true);
  const actor = db.prepare("SELECT * FROM users WHERE id = ?").get(admin.userId);
  return { department: addDepartment(body, actor) };
});
route("PUT", "/api/admin/departments/:id", (request, _response, body) => {
  const admin = requireAdmin(request, true);
  const id = new URL(request.url, `http://${HOST}:${PORT}`).pathname.split("/").pop();
  const actor = db.prepare("SELECT * FROM users WHERE id = ?").get(admin.userId);
  return { department: updateDepartment(id, body, actor) };
});
route("DELETE", "/api/admin/departments/:id", (request, _response, _body) => {
  const admin = requireAdmin(request, true);
  const id = new URL(request.url, `http://${HOST}:${PORT}`).pathname.split("/").pop();
  const actor = db.prepare("SELECT * FROM users WHERE id = ?").get(admin.userId);
  return deleteDepartment(id, actor);
});
route("POST", "/api/admin/housekeeping-areas", (request, _response, body) => {
  const admin = requireAdmin(request, true);
  const actor = db.prepare("SELECT * FROM users WHERE id = ?").get(admin.userId);
  return { area: addHousekeepingArea(body, actor) };
});
route("PUT", "/api/admin/housekeeping-areas/:id", (request, _response, body) => {
  const admin = requireAdmin(request, true);
  const id = new URL(request.url, `http://${HOST}:${PORT}`).pathname.split("/").pop();
  const actor = db.prepare("SELECT * FROM users WHERE id = ?").get(admin.userId);
  return { area: updateHousekeepingArea(id, body, actor) };
});
route("DELETE", "/api/admin/housekeeping-areas/:id", (request, _response, _body) => {
  const admin = requireAdmin(request, true);
  const id = new URL(request.url, `http://${HOST}:${PORT}`).pathname.split("/").pop();
  const actor = db.prepare("SELECT * FROM users WHERE id = ?").get(admin.userId);
  return deleteHousekeepingArea(id, actor);
});
route("POST", "/api/admin/categories", (request, _response, body) => {
  const admin = requireAdmin(request, true);
  const actor = db.prepare("SELECT * FROM users WHERE id = ?").get(admin.userId);
  return { category: addCategory(body, actor) };
});
route("PUT", "/api/admin/categories/:id", (request, _response, body) => {
  const admin = requireAdmin(request, true);
  const id = new URL(request.url, `http://${HOST}:${PORT}`).pathname.split("/").pop();
  const actor = db.prepare("SELECT * FROM users WHERE id = ?").get(admin.userId);
  return { category: updateCategory(id, body, actor) };
});
route("DELETE", "/api/admin/categories/:id", (request, _response, _body) => {
  const admin = requireAdmin(request, true);
  const id = new URL(request.url, `http://${HOST}:${PORT}`).pathname.split("/").pop();
  const actor = db.prepare("SELECT * FROM users WHERE id = ?").get(admin.userId);
  return deleteCategory(id, actor);
});
route("POST", "/api/admin/inventory-columns", (request, _response, body) => {
  const admin = requireAdmin(request, true);
  const actor = db.prepare("SELECT * FROM users WHERE id = ?").get(admin.userId);
  return { column: addInventoryColumn(body, actor) };
});
route("PUT", "/api/admin/inventory-columns/:id", (request, _response, body) => {
  const admin = requireAdmin(request, true);
  const id = new URL(request.url, `http://${HOST}:${PORT}`).pathname.split("/").pop();
  const actor = db.prepare("SELECT * FROM users WHERE id = ?").get(admin.userId);
  return { column: updateInventoryColumn(id, body, actor) };
});
route("DELETE", "/api/admin/inventory-columns/:id", (request, _response, _body) => {
  const admin = requireAdmin(request, true);
  const id = new URL(request.url, `http://${HOST}:${PORT}`).pathname.split("/").pop();
  const actor = db.prepare("SELECT * FROM users WHERE id = ?").get(admin.userId);
  return deleteInventoryColumn(id, actor);
});
route("POST", "/api/admin/items", (request, _response, body) => {
  const admin = requireAdmin(request, true);
  const actor = db.prepare("SELECT * FROM users WHERE id = ?").get(admin.userId);
  return { item: createItem(body, actor) };
});
route("PUT", "/api/admin/items/:id", (request, _response, body) => {
  const admin = requireAdmin(request, true);
  const id = new URL(request.url, `http://${HOST}:${PORT}`).pathname.split("/").pop();
  const actor = db.prepare("SELECT * FROM users WHERE id = ?").get(admin.userId);
  return { item: updateItem(id, body, actor) };
});
route("DELETE", "/api/admin/items/:id", (request, _response, _body) => {
  const admin = requireAdmin(request, true);
  const id = new URL(request.url, `http://${HOST}:${PORT}`).pathname.split("/").pop();
  const actor = db.prepare("SELECT * FROM users WHERE id = ?").get(admin.userId);
  return deleteItem(id, actor);
});
route("DELETE", "/api/admin/archived-items/:id", (request, _response, _body) => {
  const admin = requireAdmin(request, true);
  const id = new URL(request.url, `http://${HOST}:${PORT}`).pathname.split("/").pop();
  const actor = db.prepare("SELECT * FROM users WHERE id = ?").get(admin.userId);
  return permanentlyDeleteArchivedItem(id, actor);
});
route("POST", "/api/admin/locations", (request, _response, body) => {
  const admin = requireAdmin(request, true);
  const actor = db.prepare("SELECT * FROM users WHERE id = ?").get(admin.userId);
  return { location: addLocation(body, actor) };
});
route("PUT", "/api/admin/locations/:id", (request, _response, body) => {
  const admin = requireAdmin(request, true);
  const id = new URL(request.url, `http://${HOST}:${PORT}`).pathname.split("/").pop();
  const actor = db.prepare("SELECT * FROM users WHERE id = ?").get(admin.userId);
  return { location: updateLocation(id, body, actor) };
});
route("DELETE", "/api/admin/locations/:id", (request, _response, _body) => {
  const admin = requireAdmin(request, true);
  const id = new URL(request.url, `http://${HOST}:${PORT}`).pathname.split("/").pop();
  const actor = db.prepare("SELECT * FROM users WHERE id = ?").get(admin.userId);
  return { location: deleteLocation(id, actor) };
});
route("POST", "/api/admin/requesters", (request, _response, body) => {
  const admin = requireAdmin(request, true);
  const actor = db.prepare("SELECT * FROM users WHERE id = ?").get(admin.userId);
  return { requester: addRequester(body, actor) };
});
route("PUT", "/api/admin/requesters/:id", (request, _response, body) => {
  const admin = requireAdmin(request, true);
  const id = new URL(request.url, `http://${HOST}:${PORT}`).pathname.split("/").pop();
  const actor = db.prepare("SELECT * FROM users WHERE id = ?").get(admin.userId);
  return { requester: updateRequester(id, body, actor) };
});
route("DELETE", "/api/admin/requesters/:id", (request, _response, _body) => {
  const admin = requireAdmin(request, true);
  const id = new URL(request.url, `http://${HOST}:${PORT}`).pathname.split("/").pop();
  const actor = db.prepare("SELECT * FROM users WHERE id = ?").get(admin.userId);
  return deleteRequester(id, actor);
});
route("POST", "/api/admin/users", (request, _response, body) => {
  const admin = requireAdmin(request, true);
  const actor = db.prepare("SELECT * FROM users WHERE id = ?").get(admin.userId);
  return { user: createUser(body, actor) };
});
route("PUT", "/api/admin/users/:id", (request, _response, body) => {
  const admin = requireAdmin(request, true);
  const id = new URL(request.url, `http://${HOST}:${PORT}`).pathname.split("/").pop();
  const actor = db.prepare("SELECT * FROM users WHERE id = ?").get(admin.userId);
  return { user: updateUser(id, body, actor) };
});
route("PUT", "/api/admin/users/:id/password", (request, _response, body) => {
  const admin = requireAdmin(request, true);
  const id = new URL(request.url, `http://${HOST}:${PORT}`).pathname.split("/")[4];
  const actor = db.prepare("SELECT * FROM users WHERE id = ?").get(admin.userId);
  return resetUserPassword(id, body, actor);
});
route("DELETE", "/api/admin/users/:id", (request, _response, _body) => {
  const admin = requireAdmin(request, true);
  const id = new URL(request.url, `http://${HOST}:${PORT}`).pathname.split("/").pop();
  const actor = db.prepare("SELECT * FROM users WHERE id = ?").get(admin.userId);
  return deleteUser(id, actor);
});
route("POST", "/api/admin/mail", (request, response, body) => {
  const admin = requireAdmin(request, true);
  const address = String(body.gmailAddress || "").trim().toLowerCase();
  const appPassword = String(body.appPassword || "").replace(/\s/g, "");
  if (!validateEmail(address)) throw httpError(400, "Enter a valid Gmail sender address.");
  if (!address.toLowerCase().endsWith("@gmail.com")) throw httpError(400, "Use a Gmail address as the sender.");
  if (appPassword.length < 16 || appPassword.length > 32) throw httpError(400, "Enter the 16-character Google App Password.");
  const actor = db.prepare("SELECT * FROM users WHERE id = ?").get(admin.userId);
  db.prepare("INSERT INTO settings (key, value) VALUES ('gmailAddress', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(address);
  gmailAppPassword = appPassword;
  mailerAddress = address;
  mailer = null;
  addAudit(actor, "settings.gmail", `Configured Gmail sender ${address}; password retained in memory only.`);
  return { body: { configured: true, gmailAddress: address } };
});
route("PUT", "/api/admin/appearance", (request, _response, body) => {
  const admin = requireAdmin(request, true);
  const style = String(body.style || "");
  const fontFamily = String(body.fontFamily || "");
  const fontWeight = String(body.fontWeight || "");
  const fontScale = Number(body.fontScale);
  if (!["glass", "classic"].includes(style)) {
    throw httpError(400, "Choose a valid interface style.");
  }
  if (!Object.hasOwn(APPEARANCE_FONTS, fontFamily)) {
    throw httpError(400, "Choose a supported typography option.");
  }
  if (!APPEARANCE_FONT_WEIGHTS.includes(fontWeight)) {
    throw httpError(400, "Choose a valid interface font weight.");
  }
  if (!Number.isFinite(fontScale) || fontScale < 0.75 || fontScale > 1.75) {
    throw httpError(400, "Text size must be between 75% and 175%.");
  }
  const themes = {};
  for (const theme of Object.keys(APPEARANCE_COLOR_DEFAULTS)) {
    themes[theme] = {};
    for (const field of APPEARANCE_COLOR_FIELDS) {
      const value = String(body[`${theme}${field[0].toUpperCase()}${field.slice(1)}`] || "");
      if (!/^#[0-9a-f]{6}$/i.test(value)) {
        throw httpError(400, `Choose a valid ${theme} theme ${field} color.`);
      }
      themes[theme][field] = value.toLowerCase();
    }
  }
  const actor = db.prepare("SELECT * FROM users WHERE id = ?").get(admin.userId);
  transaction(() => {
    const saveSetting = db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
    saveSetting.run("appearanceStyle", style);
    saveSetting.run("appearanceFont", fontFamily);
    saveSetting.run("appearanceWeight", fontWeight);
    saveSetting.run("appearanceFontScale", String(fontScale));
    for (const [theme, colors] of Object.entries(themes)) {
      for (const [field, value] of Object.entries(colors)) {
        saveSetting.run(`appearance_${theme}_${field}`, value);
      }
    }
    addAudit(actor, "settings.appearance", `Updated shared typography, ${fontScale}x text size, and light/dark theme colors.`);
  });
  return { appearance: getAppearanceSettings() };
});
route("GET", "/api/admin/audit", request => {
  requireAdmin(request);
  return { rows: db.prepare("SELECT * FROM audit_log ORDER BY created_at DESC LIMIT 500").all() };
});

function findRoute(method, pathname) {
  const exact = routes.get(`${method} ${pathname}`);
  if (exact) return exact;
  for (const [key, handler] of routes) {
    const [routeMethod, routePath] = key.split(" ");
    if (routeMethod !== method || !routePath.includes(":id")) continue;
    const pattern = new RegExp(`^${routePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(":id", "[^/]+")}$`);
    if (pattern.test(pathname)) return handler;
  }
  return null;
}

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".png": "image/png",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".ttf": "font/ttf",
  ".txt": "text/plain; charset=utf-8",
};

function serveStatic(request, response, pathname) {
  const allowed = new Map([
    ["/", "index.html"],
    ["/index.html", "index.html"],
    ["/styles.css", "styles.css"],
    ["/app.js", "app.js"],
    ["/manifest.json", "manifest.json"],
    ["/service-worker.js", "service-worker.js"],
    ["/assets/capitol-catering-logo.png", path.join("assets", "capitol-catering-logo.png")],
    ["/assets/capitol-catering-icon.png", path.join("assets", "capitol-catering-icon.png")],
    ["/assets/capitol-stock-icon-180.png", path.join("assets", "capitol-stock-icon-180.png")],
    ["/assets/capitol-stock-icon-192.png", path.join("assets", "capitol-stock-icon-192.png")],
    ["/assets/capitol-stock-icon-512.png", path.join("assets", "capitol-stock-icon-512.png")],
    ["/assets/fonts/inter-regular.ttf", path.join("assets", "fonts", "inter-regular.ttf")],
    ["/assets/fonts/inter-bold.ttf", path.join("assets", "fonts", "inter-bold.ttf")],
    ["/assets/fonts/manrope-regular.ttf", path.join("assets", "fonts", "manrope-regular.ttf")],
    ["/assets/fonts/manrope-bold.ttf", path.join("assets", "fonts", "manrope-bold.ttf")],
    ["/assets/fonts/OFL-Inter.txt", path.join("assets", "fonts", "OFL-Inter.txt")],
    ["/assets/fonts/OFL-Manrope.txt", path.join("assets", "fonts", "OFL-Manrope.txt")],
    ["/vendor/bootstrap.min.css", path.join("node_modules", "bootstrap", "dist", "css", "bootstrap.min.css")],
    ["/vendor/bootstrap.bundle.min.js", path.join("node_modules", "bootstrap", "dist", "js", "bootstrap.bundle.min.js")],
  ]);
  const filename = allowed.get(pathname);
  const pretextModule = /^\/vendor\/pretext\/((?:[a-z0-9_-]+\/)*[a-z0-9_-]+\.js)$/i.exec(pathname);
  const pretextFile = pretextModule
    ? path.join(ROOT, "node_modules", "@chenglou", "pretext", "dist", pretextModule[1])
    : filename ? path.join(ROOT, filename) : null;
  if (!pretextFile) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not found");
    return;
  }
  fs.readFile(pretextFile, (error, contents) => {
    if (error) {
      console.error(`Unable to read ${pretextFile}:`, error.message);
      response.writeHead(500).end("The application could not be loaded.");
      return;
    }
    response.writeHead(200, {
      "Content-Type": mimeTypes[path.extname(pretextFile)],
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com data:; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    });
    response.end(contents);
  });
}

const server = http.createServer((request, response) => {
  let pathname;
  try {
    pathname = new URL(request.url, `http://${HOST}:${PORT}`).pathname;
  } catch {
    sendJson(response, 400, { error: "Invalid request URL." });
    return;
  }
  if (pathname.startsWith("/api/")) {
    if (pathname === "/api/health" && request.method === "GET") {
      try {
        db.prepare("SELECT 1 AS ok").get();
        sendJson(response, 200, { ok: true, database: usePostgres ? "postgres" : "sqlite", sqlite: !usePostgres });
      } catch (error) {
        console.error("Health check failed:", error.message);
        sendJson(response, 503, { ok: false });
      }
      return;
    }
    const handler = findRoute(request.method, pathname);
    if (!handler) {
      sendJson(response, 404, { error: "API endpoint not found." });
      return;
    }
    handler(request, response);
    return;
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" }).end();
    return;
  }
  serveStatic(request, response, pathname);
});

server.on("error", error => {
  console.error(`Capitol Stock Management could not start on ${HOST}:${PORT}:`, error.message);
  process.exitCode = 1;
});

server.listen(PORT, HOST, () => {
  console.log(`Capitol Stock Management is ready on ${HOST}:${PORT}`);
  console.log(usePostgres ? "Connected to the hosted PostgreSQL database." : `Local SQLite database: ${DB_PATH}`);
  const createPreviousMonthArchive = () => {
    try {
      ensurePreviousMonthInventoryArchive();
    } catch (error) {
      console.error("Monthly inventory archive could not be created:", error.message);
    }
    try {
      ensureRequestsMonthArchives();
    } catch (error) {
      console.error("Monthly requests archive could not be created:", error.message);
    }
  };
  createPreviousMonthArchive();
  const archiveTimer = setInterval(createPreviousMonthArchive, 60_000);
  archiveTimer.unref();
});

function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 3000).unref();
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
