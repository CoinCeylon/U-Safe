import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { runMigrations } from './migrate.js';

export const openDatabase = (dbPath: string, migrationsDir: string): Database.Database => {
  mkdirSync(dirname(resolve(dbPath)), { recursive: true });
  const db = new Database(resolve(dbPath));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  runMigrations(db, resolve(migrationsDir));
  return db;
};