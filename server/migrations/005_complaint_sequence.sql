-- Sequential complaint ids (M039).
--
-- A single row holds the next numeric id. The mock ledger reads and advances it
-- inside the same SQLite transaction that inserts the complaint, so ids are
-- strictly sequential and cannot collide under concurrent filings.
CREATE TABLE IF NOT EXISTS ml_complaint_sequence (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  next_value INTEGER NOT NULL
);

INSERT OR IGNORE INTO ml_complaint_sequence (id, next_value) VALUES (1, 1);
