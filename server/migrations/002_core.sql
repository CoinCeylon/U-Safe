-- Core database schema (M023)
-- Emails are never stored in plaintext; only salted hashes (email_hash).

CREATE TABLE IF NOT EXISTS universities (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  domain TEXT NOT NULL,
  enrollment_ceiling INTEGER NOT NULL DEFAULT 0,
  public_key_jwk TEXT,
  community_key_wrapped_for_ugc TEXT,
  status TEXT NOT NULL DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS roster (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  university_id TEXT NOT NULL,
  email_hash TEXT NOT NULL,
  enrolled_at TEXT,
  UNIQUE (university_id, email_hash),
  FOREIGN KEY (university_id) REFERENCES universities (id)
);

CREATE TABLE IF NOT EXISTS otp (
  email_hash TEXT PRIMARY KEY,
  code_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS tickets (
  id TEXT PRIMARY KEY,
  university_id TEXT NOT NULL,
  roster_id INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  FOREIGN KEY (university_id) REFERENCES universities (id),
  FOREIGN KEY (roster_id) REFERENCES roster (id)
);

CREATE TABLE IF NOT EXISTS blobs (
  hash TEXT PRIMARY KEY,
  size INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS staff (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  university_id TEXT,
  role TEXT NOT NULL,
  address TEXT NOT NULL,
  public_key_jwk TEXT,
  FOREIGN KEY (university_id) REFERENCES universities (id)
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  staff_id INTEGER NOT NULL,
  expires_at TEXT NOT NULL,
  FOREIGN KEY (staff_id) REFERENCES staff (id)
);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
