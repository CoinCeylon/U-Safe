import { MockLedger } from '@usafe/chain';
import Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import type { Config } from './config.js';
import { runMigrations } from './db/migrate.js';
import { issueSession } from './services/staffAuth.js';

const migrationsDir = fileURLToPath(new URL('../migrations', import.meta.url));

const config: Config = {
  NODE_ENV: 'test',
  PORT: 3000,
  HOST: '127.0.0.1',
  CHAIN_MODE: 'mock',
  WEB_ORIGIN: 'http://localhost:5173',
  DATABASE_PATH: ':memory:',
  EMAIL_HASH_SALT: 'test-salt',
  MAIL_MODE: 'dev',
  SMTP_HOST: '',
  SMTP_PORT: 587,
  SMTP_USER: '',
  SMTP_PASS: '',
  MAIL_FROM: 'noreply@usafe.local',
};

describe('POST /api/complaints/:id/status', () => {
  let db: Database.Database;
  let app: FastifyInstance | undefined;

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db, migrationsDir);
    db.prepare(
      `INSERT INTO universities
         (id, name, domain, enrollment_ceiling, status)
       VALUES ('uni-1', 'University One', 'one.edu', 10, 'active')`,
    ).run();
  });

  afterEach(async () => {
    await app?.close();
    app = undefined;
    db.close();
  });

  it('returns 403 when university staff update a UGC-owned complaint', async () => {
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO ml_complaints (
        id, university_id, category, urgency, staff_involved, owner_role,
        payload_hash, payload_locator, created_at, deadline_at, status,
        escalated, reopened, support_count, outcome_hash, last_updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, 0, 0, 0, NULL, ?)
    `).run(
      'complaint-1',
      'uni-1',
      'sexual',
      'urgent',
      1,
      'ugc',
      'payload-hash',
      now,
      now,
      'not_started',
      now,
    );

    const staffId = db
      .prepare(
        `INSERT INTO staff (university_id, role, address, public_key_jwk)
         VALUES ('uni-1', 'investigator', 'staff-1', NULL)`,
      )
      .run().lastInsertRowid;
    const token = issueSession(db, Number(staffId));
    const ledger = new MockLedger(db);
    app = await buildApp(config, db, undefined, undefined, undefined, ledger);

    const response = await app.inject({
      method: 'POST',
      url: '/api/complaints/complaint-1/status',
      headers: { authorization: `Bearer ${token}` },
      payload: {
        newStatus: 'pending_investigation',
        outcomeHash: null,
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json<{ error: string }>()).toEqual({ error: 'forbidden' });

    const history = db
      .prepare('SELECT COUNT(*) AS count FROM ml_history WHERE complaint_id = ?')
      .get('complaint-1') as { count: number };
    expect(history.count).toBe(0);
  });
});
