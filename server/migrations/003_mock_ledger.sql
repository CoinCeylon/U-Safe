-- Mock ledger tables (M036)
-- These tables back the MockLedger implementation behind `LedgerAdapter`.
-- No student identities, emails, commitments-to-email pairings, or plaintext
-- complaints are stored here. Complaint text and evidence live off-chain.

CREATE TABLE IF NOT EXISTS ml_leaves (
  university_id TEXT NOT NULL,
  leaf_index INTEGER NOT NULL,
  commitment TEXT NOT NULL,
  PRIMARY KEY (university_id, leaf_index),
  UNIQUE (university_id, commitment),
  FOREIGN KEY (university_id) REFERENCES universities (id)
);

CREATE TABLE IF NOT EXISTS ml_roots (
  university_id TEXT NOT NULL,
  root TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (university_id, root),
  FOREIGN KEY (university_id) REFERENCES universities (id)
);

CREATE TABLE IF NOT EXISTS ml_complaints (
  id TEXT PRIMARY KEY,
  university_id TEXT NOT NULL,
  category TEXT NOT NULL,
  urgency TEXT NOT NULL,
  staff_involved INTEGER NOT NULL DEFAULT 0,
  owner_role TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  payload_locator TEXT,
  created_at TEXT NOT NULL,
  deadline_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'not_started',
  escalated INTEGER NOT NULL DEFAULT 0,
  reopened INTEGER NOT NULL DEFAULT 0,
  support_count INTEGER NOT NULL DEFAULT 0,
  outcome_hash TEXT,
  last_updated_at TEXT NOT NULL,
  FOREIGN KEY (university_id) REFERENCES universities (id)
);

CREATE TABLE IF NOT EXISTS ml_nullifiers (
  kind TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (kind, value)
);

CREATE TABLE IF NOT EXISTS ml_history (
  complaint_id TEXT NOT NULL,
  status TEXT NOT NULL,
  at TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  note_hash TEXT,
  FOREIGN KEY (complaint_id) REFERENCES ml_complaints (id)
);

CREATE TABLE IF NOT EXISTS ml_notes (
  complaint_id TEXT NOT NULL,
  sealed_blob_hash TEXT NOT NULL,
  at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (complaint_id) REFERENCES ml_complaints (id)
);
