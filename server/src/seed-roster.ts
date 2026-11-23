import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadConfig } from './config.js';
import { openDatabase } from './db/index.js';
import { importRoster } from './services/roster.js';

const collectArgs = (): string[] => {
  // Direct invocation or npm-forwarded args land after the script path.
  return process.argv.slice(2);
};

const [universityId, filePath] = collectArgs();

if (universityId === undefined || filePath === undefined) {
  console.error('Usage: npm run seed:roster -- <university> <file>');
  process.exit(1);
}

const config = loadConfig();
const db = openDatabase(config.DATABASE_PATH, './migrations');

try {
  const baseDir = process.env.INIT_CWD ?? process.cwd();
  const resolvedPath = resolve(baseDir, filePath);
  const csv = readFileSync(resolvedPath, 'utf8');
  const result = importRoster(db, universityId, csv, config.EMAIL_HASH_SALT);
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error((error as Error).message);
  process.exit(1);
} finally {
  db.close();
}
