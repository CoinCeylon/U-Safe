import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createReadStream, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type Database from 'better-sqlite3';

export const MAX_BLOB_SIZE = 25 * 1024 * 1024;

const SERVICE_DIR = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_BLOB_DIR = path.resolve(SERVICE_DIR, '..', '..', 'data', 'blobs');

export const resolveBlobDir = (override?: string): string => {
  if (override !== undefined && override !== '') {
    return path.resolve(override);
  }
  if (process.env.BLOB_DIR !== undefined && process.env.BLOB_DIR !== '') {
    return path.resolve(process.env.BLOB_DIR);
  }
  return DEFAULT_BLOB_DIR;
};

export const isOctetStreamContentType = (contentType: string | undefined): boolean => {
  const base = (contentType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
  return base === 'application/octet-stream' || base === 'application/octetstream';
};

export const baseContentType = (contentType: string | undefined): string =>
  (contentType ?? '').split(';')[0]?.trim().toLowerCase() ?? '';

export const isValidBlobHash = (value: string): boolean => /^[a-f0-9]{64}$/i.test(value);

export const normalizeBlobHash = (value: string): string => value.trim().toLowerCase();

export const sha256Buffer = (buffer: Buffer): string =>
  createHash('sha256').update(buffer).digest('hex');

export const ensureBlobDir = (dir: string): void => {
  mkdirSync(dir, { recursive: true });
};

export const blobFilePath = (dir: string, hash: string): string => path.join(dir, hash);

export const saveBlob = (
  db: Database.Database,
  dir: string,
  hash: string,
  bytes: Buffer,
): void => {
  ensureBlobDir(dir);
  writeFileSync(blobFilePath(dir, hash), bytes);
  db.prepare(
    `INSERT INTO blobs (hash, size) VALUES (?, ?)
     ON CONFLICT(hash) DO UPDATE SET size = excluded.size`,
  ).run(hash, bytes.length);
};

export const blobExists = (dir: string, hash: string): boolean =>
  existsSync(blobFilePath(dir, hash));

export const createBlobReadStream = (dir: string, hash: string) =>
  createReadStream(blobFilePath(dir, hash));

export const blobFileSize = (dir: string, hash: string): number =>
  statSync(blobFilePath(dir, hash)).size;
