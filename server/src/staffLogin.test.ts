import Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import type { Config } from './config.js';
import { runMigrations } from './db/migrate.js';

const migrationsDir = fileURLToPath(new URL('../migrations', import.meta.url));

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

describe('M063 dev login routes', () => {
  let db: Database.Database;
  let app: FastifyInstance | undefined;
  let registrarId: number;
  let investigatorId: number;

  const seedStaff = (): void => {
    const insert = db.prepare(
      `INSERT INTO staff (university_id, role, address, public_key_jwk)
       VALUES (?, ?, ?, NULL)`,
    );
    registrarId = Number(
      insert.run('uni-1', 'registrar', 'dev-registrar-uni-1').lastInsertRowid,
    );
    investigatorId = Number(
      insert.run('uni-1', 'investigator', 'dev-investigator-uni-1')
        .lastInsertRowid,
    );
  };

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db, migrationsDir);
    db.prepare(
      `INSERT INTO universities
         (id, name, domain, enrollment_ceiling, status)
       VALUES ('uni-1', 'University One', 'one.edu', 100, 'active')`,
    ).run();
    seedStaff();
  });

  afterEach(async () => {
    await app?.close();
    app = undefined;
    delete process.env.DEV_LOGIN;
    db.close();
  });

  it('reports the devLogin flag on /api/health', async () => {
    process.env.DEV_LOGIN = 'true';
    app = await buildApp(config, db);
    const enabled = await app.inject({ method: 'GET', url: '/api/health' });
    expect(enabled.statusCode).toBe(200);
    expect(enabled.json<{ devLogin: boolean }>().devLogin).toBe(true);

    await app.close();
    app = undefined;
    delete process.env.DEV_LOGIN;

    app = await buildApp(config, db);
    const disabled = await app.inject({ method: 'GET', url: '/api/health' });
    expect(disabled.json<{ devLogin: boolean }>().devLogin).toBe(false);
  });

  it('lists seeded accounts for the dropdown', async () => {
    process.env.DEV_LOGIN = 'true';
    app = await buildApp(config, db);

    const response = await app.inject({
      method: 'GET',
      url: '/api/auth/dev-accounts',
    });
    expect(response.statusCode).toBe(200);
    const accounts = response.json<{
      accounts: Array<{
        id: number;
        role: string;
        universityId: string | null;
        universityName: string | null;
      }>;
    }>().accounts;
    expect(accounts).toHaveLength(2);
    expect(accounts.map((account) => account.role).sort()).toEqual([
      'investigator',
      'registrar',
    ]);
    for (const account of accounts) {
      expect(account.universityId).toBe('uni-1');
      expect(account.universityName).toBe('University One');
    }
  });

  it('issues a session for a staffId from the dropdown', async () => {
    process.env.DEV_LOGIN = 'true';
    app = await buildApp(config, db);

    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/dev-login',
      payload: { staffId: investigatorId },
    });
    expect(login.statusCode).toBe(200);
    const token = login.json<{ token: string }>().token;

    const me = await app.inject({
      method: 'GET',
      url: '/api/staff/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(me.statusCode).toBe(200);
    const staff = me.json<{ staff: { role: string; university_id: string } }>()
      .staff;
    expect(staff.role).toBe('investigator');
    expect(staff.university_id).toBe('uni-1');
  });

  it('rejects an unknown staffId', async () => {
    process.env.DEV_LOGIN = 'true';
    app = await buildApp(config, db);

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/dev-login',
      payload: { staffId: 9999 },
    });
    expect(response.statusCode).toBe(404);
  });

  it('keeps the role-based dev-login form working', async () => {
    process.env.DEV_LOGIN = 'true';
    app = await buildApp(config, db);

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/dev-login',
      payload: { role: 'registrar', universityId: 'uni-1' },
    });
    expect(response.statusCode).toBe(200);
    expect(typeof response.json<{ token: string }>().token).toBe('string');
  });

  it('hides the dev routes when DEV_LOGIN is off', async () => {
    delete process.env.DEV_LOGIN;
    app = await buildApp(config, db);

    const accounts = await app.inject({
      method: 'GET',
      url: '/api/auth/dev-accounts',
    });
    expect(accounts.statusCode).toBe(404);

    const login = await app.inject({
      method: 'POST',
      url: '/api/auth/dev-login',
      payload: { staffId: registrarId },
    });
    expect(login.statusCode).toBe(404);

    const publish = await app.inject({
      method: 'POST',
      url: '/api/events/publish',
      payload: { type: 'test.event', id: 'e1' },
    });
    expect(publish.statusCode).toBe(404);
  });
});
