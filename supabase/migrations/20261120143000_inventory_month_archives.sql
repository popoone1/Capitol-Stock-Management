CREATE TABLE IF NOT EXISTS inventory_month_archives (
  month text PRIMARY KEY,
  payload text NOT NULL,
  created_at text NOT NULL
);

ALTER TABLE inventory_month_archives ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE inventory_month_archives FROM anon, authenticated;
