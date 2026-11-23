import { createHash } from 'node:crypto';
import { z } from 'zod';
import type Database from 'better-sqlite3';
import { getUniversity } from './universities.js';

export interface RosterImportResult {
  accepted: number;
  rejected: number;
  errors: Array<{ row: number; reason: string }>;
}

const emailSchema = z.string().email();

export const emailHash = (salt: string, email: string): string =>
  createHash('sha256').update(salt + email.toLowerCase()).digest('hex');

export const importRoster = (
  db: Database.Database,
  universityId: string,
  csvText: string,
  salt: string,
): RosterImportResult => {
  const university = getUniversity(db, universityId);
  if (university === null) {
    throw new Error('university not found');
  }

  const rawLines = csvText.split(/\r?\n/);
  const numbered = rawLines
    .map((line, idx) => ({ line, no: idx + 1 }))
    .filter((entry) => entry.line.trim() !== '');

  let dataRows = numbered;
  if (dataRows.length > 0 && dataRows[0]?.line.toLowerCase().includes('email') === true) {
    dataRows = dataRows.slice(1);
  }

  const errors: Array<{ row: number; reason: string }> = [];
  let accepted = 0;
  const seen = new Set<string>();

  const existingRows = db
    .prepare('SELECT email_hash FROM roster WHERE university_id = ?')
    .all(university.id) as Array<{ email_hash: string }>;
  const existing = new Set(existingRows.map((r) => r.email_hash));

  for (const { line, no } of dataRows) {
    const parts = line.split(',');
    if (parts.length < 2) {
      errors.push({ row: no, reason: 'expected email,index_number' });
      continue;
    }
    const emailRaw = parts[0];
    if (emailRaw === undefined) {
      errors.push({ row: no, reason: 'expected email,index_number' });
      continue;
    }
    const email = emailRaw.trim().toLowerCase();
    // index_number is intentionally not stored

    const parsed = emailSchema.safeParse(email);
    if (!parsed.success) {
      errors.push({ row: no, reason: 'invalid email' });
      continue;
    }

    const domain = email.split('@')[1] ?? '';
    if (domain !== university.domain) {
      errors.push({ row: no, reason: 'domain mismatch' });
      continue;
    }

    const hash = emailHash(salt, email);
    if (existing.has(hash) || seen.has(hash)) {
      errors.push({ row: no, reason: 'duplicate' });
      continue;
    }

    db.prepare('INSERT INTO roster (university_id, email_hash) VALUES (?, ?)').run(
      university.id,
      hash,
    );
    seen.add(hash);
    existing.add(hash);
    accepted += 1;
  }

  return { accepted, rejected: errors.length, errors };
};
