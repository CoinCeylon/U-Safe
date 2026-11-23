import type Database from 'better-sqlite3';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const MIGRATION_PATTERN = /^\d+_.*\.sql$/;

export const runMigrations = (db: Database.Database, migrationsDir: string): void => {
  db.exec(
    'CREATE TABLE IF NOT EXISTS migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)',
  );

  const files = readdirSync(migrationsDir)
    .filter((name) => MIGRATION_PATTERN.test(name))
    .sort();

  const applied = new Set(
    (
      db.prepare('SELECT name FROM migrations').all() as Array<{
        name: string;
      }>
    ).map((row) => row.name),
  );

  for (const file of files) {
    if (applied.has(file)) {
      continue;
    }

    const sql = readFileSync(join(migrationsDir, file), 'utf8');

    const transaction = db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO migrations (name, applied_at) VALUES (?, ?)').run(
        file,
        new Date().toISOString(),
      );
    });

    transaction();
  }
};