CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  username text NOT NULL,
  display_name text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin', 'user', 'auditor')),
  password_salt text NOT NULL,
  password_hash text NOT NULL,
  active smallint NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  password_reset_required smallint NOT NULL DEFAULT 0 CHECK (password_reset_required IN (0, 1)),
  created_at text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_key ON users (lower(username));

CREATE TABLE IF NOT EXISTS login_attempts (
  user_id text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  failures integer NOT NULL CHECK (failures >= 0),
  window_started_at bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS locations (
  id text PRIMARY KEY,
  name text NOT NULL,
  active smallint NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
);
CREATE UNIQUE INDEX IF NOT EXISTS locations_name_lower_key ON locations (lower(name));

CREATE TABLE IF NOT EXISTS categories (
  id text PRIMARY KEY,
  name text NOT NULL,
  active smallint NOT NULL DEFAULT 1 CHECK (active IN (0, 1))
);
CREATE UNIQUE INDEX IF NOT EXISTS categories_name_lower_key ON categories (lower(name));

CREATE TABLE IF NOT EXISTS departments (
  id text PRIMARY KEY,
  name text NOT NULL,
  kind text NOT NULL DEFAULT 'standard' CHECK (kind IN ('standard', 'housekeeping', 'expiry', 'spoilage')),
  created_at text NOT NULL,
  updated_at text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS departments_name_lower_key ON departments (lower(name));

CREATE TABLE IF NOT EXISTS housekeeping_areas (
  id text PRIMARY KEY,
  name text NOT NULL,
  created_at text NOT NULL,
  updated_at text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS housekeeping_areas_name_lower_key ON housekeeping_areas (lower(name));

CREATE TABLE IF NOT EXISTS requesters (
  id text PRIMARY KEY,
  scope text NOT NULL CHECK (scope IN ('water', 'stock')),
  department text NOT NULL DEFAULT '',
  name text NOT NULL,
  active smallint NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  UNIQUE (scope, department, name)
);
CREATE UNIQUE INDEX IF NOT EXISTS requesters_scope_department_name_lower_key
  ON requesters (scope, department, lower(name));

CREATE TABLE IF NOT EXISTS items (
  id text PRIMARY KEY,
  sku text NOT NULL,
  name text NOT NULL,
  category text NOT NULL,
  store text NOT NULL DEFAULT 'Dry Store',
  unit text NOT NULL,
  description text NOT NULL DEFAULT '',
  reorder_level double precision NOT NULL DEFAULT 0 CHECK (reorder_level >= 0),
  active smallint NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at text NOT NULL,
  updated_at text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS items_sku_lower_key ON items (lower(sku));

CREATE TABLE IF NOT EXISTS inventory_columns (
  id text PRIMARY KEY,
  name text NOT NULL,
  active smallint NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at text NOT NULL,
  updated_at text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS inventory_columns_name_lower_key ON inventory_columns (lower(name));

CREATE TABLE IF NOT EXISTS inventory_column_values (
  item_id text NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  column_id text NOT NULL REFERENCES inventory_columns(id) ON DELETE CASCADE,
  value text NOT NULL DEFAULT '',
  PRIMARY KEY (item_id, column_id)
);

CREATE TABLE IF NOT EXISTS batches (
  id text PRIMARY KEY,
  item_id text NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  location_id text NOT NULL REFERENCES locations(id) ON DELETE RESTRICT,
  batch_number text NOT NULL DEFAULT '',
  supplier text NOT NULL DEFAULT '',
  purchase_reference text NOT NULL DEFAULT '',
  unit_cost double precision NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
  quantity_received double precision NOT NULL CHECK (quantity_received > 0),
  quantity_remaining double precision NOT NULL CHECK (quantity_remaining >= 0),
  received_at text NOT NULL,
  expiry_date text
);

CREATE TABLE IF NOT EXISTS stock_transactions (
  id text PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('receipt', 'issue', 'adjustment', 'expiry', 'spoilage', 'requisition')),
  item_id text REFERENCES items(id) ON DELETE SET NULL,
  item_sku text NOT NULL,
  item_name text NOT NULL,
  batch_id text REFERENCES batches(id) ON DELETE SET NULL,
  location_id text REFERENCES locations(id) ON DELETE SET NULL,
  location_name text NOT NULL,
  quantity double precision NOT NULL CHECK (quantity <> 0),
  unit text NOT NULL,
  department text NOT NULL DEFAULT '',
  person text NOT NULL DEFAULT '',
  area text NOT NULL DEFAULT '',
  issued_by text NOT NULL DEFAULT '',
  supplier text NOT NULL DEFAULT '',
  purchase_reference text NOT NULL DEFAULT '',
  reason text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  request_date text NOT NULL,
  expires_on text,
  created_by text NOT NULL,
  created_at text NOT NULL,
  voided_at text,
  voided_by text,
  void_reason text NOT NULL DEFAULT '',
  reversal_of text,
  request_group_id text
);

CREATE TABLE IF NOT EXISTS water_records (
  id text PRIMARY KEY,
  date text NOT NULL,
  recipient text NOT NULL,
  quantity integer NOT NULL CHECK (quantity > 0),
  requested_by text NOT NULL,
  issued_by text NOT NULL,
  created_by text NOT NULL,
  created_at text NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key text PRIMARY KEY,
  value text NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id text PRIMARY KEY,
  actor_id text,
  actor_name text NOT NULL,
  action text NOT NULL,
  detail text NOT NULL,
  created_at text NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_batches_item_location ON batches(item_id, location_id);
CREATE INDEX IF NOT EXISTS idx_batches_expiry ON batches(expiry_date);
CREATE INDEX IF NOT EXISTS idx_transactions_date ON stock_transactions(created_at);
CREATE INDEX IF NOT EXISTS idx_transactions_item ON stock_transactions(item_id);
CREATE INDEX IF NOT EXISTS idx_water_date_recipient ON water_records(date, recipient);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE login_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE housekeeping_areas ENABLE ROW LEVEL SECURITY;
ALTER TABLE requesters ENABLE ROW LEVEL SECURITY;
ALTER TABLE items ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_columns ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_column_values ENABLE ROW LEVEL SECURITY;
ALTER TABLE batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE water_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE users, login_attempts, locations, categories, departments, housekeeping_areas,
  requesters, items, inventory_columns, inventory_column_values, batches,
  stock_transactions, water_records, settings, audit_log
FROM anon, authenticated;
