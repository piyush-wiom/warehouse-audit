-- Warehouse Audit Tool — Database Setup
-- Run this in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  role TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  is_active BOOLEAN DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS inventory_uploads (
  id TEXT PRIMARY KEY,
  filename TEXT NOT NULL,
  uploaded_by TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS inventory (
  id TEXT PRIMARY KEY,
  upload_id TEXT NOT NULL REFERENCES inventory_uploads(id) ON DELETE CASCADE,
  location_code TEXT NOT NULL,
  item_no TEXT,
  no2 TEXT,
  description TEXT,
  inventory TEXT,
  bin_code TEXT NOT NULL,
  zone_code TEXT,
  serial_no TEXT,
  mac_id TEXT,
  device_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS assignments (
  id TEXT PRIMARY KEY,
  upload_id TEXT NOT NULL,
  warehouse TEXT NOT NULL,
  bin_code TEXT NOT NULL,
  assigned_to TEXT NOT NULL,
  assigned_by TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_sessions (
  id TEXT PRIMARY KEY,
  auditor_email TEXT NOT NULL,
  warehouse TEXT NOT NULL,
  start_time TIMESTAMPTZ DEFAULT NOW(),
  end_time TIMESTAMPTZ,
  is_reaudit BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS scanned_devices (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES audit_sessions(id) ON DELETE CASCADE,
  bin_code TEXT NOT NULL,
  warehouse TEXT NOT NULL,
  raw_input TEXT NOT NULL,
  extracted_serial TEXT,
  matched BOOLEAN DEFAULT FALSE,
  device_type TEXT,
  serial_no TEXT,
  mac_id TEXT,
  device_id TEXT,
  scan_type TEXT NOT NULL,
  scanned_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS corrections (
  id TEXT PRIMARY KEY,
  warehouse TEXT NOT NULL,
  bin_code TEXT NOT NULL,
  remark TEXT NOT NULL,
  corrected_by TEXT NOT NULL,
  corrected_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reaudit_assignments (
  id TEXT PRIMARY KEY,
  warehouse TEXT NOT NULL,
  bin_code TEXT NOT NULL,
  assigned_to TEXT NOT NULL,
  assigned_by TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  completed BOOLEAN DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS otp_tokens (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  otp TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_inventory_location_bin ON inventory(location_code, bin_code);
CREATE INDEX IF NOT EXISTS idx_inventory_serial ON inventory(serial_no);
CREATE INDEX IF NOT EXISTS idx_scanned_session_bin ON scanned_devices(session_id, bin_code);
CREATE INDEX IF NOT EXISTS idx_otp_email ON otp_tokens(email);
CREATE INDEX IF NOT EXISTS idx_assignments_to ON assignments(assigned_to);
CREATE INDEX IF NOT EXISTS idx_sessions_auditor ON audit_sessions(auditor_email);

SELECT 'All tables created successfully!' AS status;
