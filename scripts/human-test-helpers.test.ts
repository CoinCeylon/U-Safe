import { MockLedger } from '@usafe/chain';
import Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../server/src/app.js';
import type { Config } from '../server/src/config.js';
import { runMigrations } from '../server/src/db/migrate.js';
import { tryDuplicateSupport } from './try-duplicate.js';
import { tryForgedProof } from './try-forge.js';

const migrationsDir = fileURLToPath(
  new URL('../server/migrations', import.meta.url),
);

const config: Config = {
  NODE_ENV: 'test',
  PORT: 3000,
  HOST: '127.0.0.1',
  CHAIN_MODE: 'mock',
  WEB_ORIGIN: 'http://localhost:5173',
  DATABASE_PATH: ':memory:',
  EMAIL_HASH_SALT: 'test-salt',
  COMMUNITY_DELIVERY_SECRET: 'delivery-secret',
  MAIL_MODE: 'dev',
  SMTP_HOST: '',
  SMTP_PORT: 587,
  SMTP_USER: '',
  SMTP_PASS: '',
  MAIL_FROM: 'noreply@usafe.local',
};

describe('Human Test 4 helper scripts', () => {
  let db: Database.Database;
  let app: FastifyInstance;
  let baseUrl: string;

  beforeEach(async () => {
    db = new Database(':memory:');
    runMigrations(db, migrationsDir);
    db.prepare(
      `INSERT INTO universities
         (id, name, domain, enrollment_ceiling, status)
       VALUES ('uni-1', 'University One', 'one.edu', 100, 'active')`,
    ).run();
    const ledger = new MockLedger(db);
    app = await buildApp(config, db, undefined, ledger, undefined, ledger);
    await app.listen({ host: '127.0.0.1', port: 0 });
    const address = app.server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('test server did not provide a TCP address');
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  it('try:forge expects the server to reject a forged proof', async () => {
    const result = await tryForgedProof(baseUrl, 'uni-1');

    expect(result).toEqual({
      statusCode: 401,
      error: 'invalid enrollment proof',
    });

    const complaints = db
      .prepare('SELECT COUNT(*) AS count FROM ml_complaints')
      .get() as { count: number };
    expect(complaints.count).toBe(0);
  });

  it('try:duplicate expects the same support proof to count once', async () => {
    const result = await tryDuplicateSupport(db, baseUrl, 'uni-1');

    expect(result.firstSupportCount).toBe(1);
    expect(result.duplicateStatusCode).toBe(400);
    expect(result.duplicateError).toBe('support nullifier already used');
    expect(result.finalSupportCount).toBe(1);

    const row = db
      .prepare('SELECT support_count FROM ml_complaints WHERE id = ?')
      .get(result.complaintId) as { support_count: number };
    expect(row.support_count).toBe(1);
  });
});
