-- Outcome blob locator (M041).
-- The ledger stores the hash and the off-chain locator of the sealed outcome
-- message. The portal's outcome hash is normally also the blob hash, so the
-- column is nullable and falls back to the hash when a caller omits it.
ALTER TABLE ml_complaints ADD COLUMN outcome_locator TEXT;
