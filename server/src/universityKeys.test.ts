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
  COMMUNITY_DELIVERY_SECRET: 'delivery-secret',
  MAIL_MODE: 'dev',
  SMTP_HOST: '',
  SMTP_PORT: 587,
  SMTP_USER: '',
  SMTP_PASS: '',
  MAIL_FROM: 'noreply@usafe.local',
};

const validPublicKeyJwk = JSON.stringify({
  kty: 'RSA',
  n: 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG',
  e: 'AQAB',
});

describe('M064 PUT /api/university/:id/public-key', () => {
  let db: Database.Database;
  let app: FastifyInstance | undefined;
  let staffToken: string;
  let otherUniversityToken: string;

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db, migrationsDir);
    db.prepare(
      `INSERT INTO universities
         (id, name, domain, enrollment_ceiling, status)
       VALUES ('uni-1', 'University One', 'one.edu', 100, 'active')`,
    ).run();
    db.prepare(
      `INSERT INTO universities
         (id, name, domain, enrollment_ceiling, status)
       VALUES ('uni-2', 'University Two', 'two.edu', 100, 'active')`,
    ).run();
    const staffId = db
      .prepare(
        `INSERT INTO staff (university_id, role, address, public_key_jwk)
         VALUES ('uni-1', 'investigator', 'staff-1', NULL)`,
      )
      .run().lastInsertRowid;
    staffToken = issueSession(db, Number(staffId));
    const otherStaffId = db
      .prepare(
        `INSERT INTO staff (university_id, role, address, public_key_jwk)
         VALUES ('uni-2', 'investigator', 'staff-2', NULL)`,
      )
      .run().lastInsertRowid;
    otherUniversityToken = issueSession(db, Number(otherStaffId));
  });

  afterEach(async () => {
    await app?.close();
    app = undefined;
    db.close();
  });

  it('stores the public key for staff of that university', async () => {
    app = await buildApp(config, db);
    const response = await app.inject({
      method: 'PUT',
      url: '/api/university/uni-1/public-key',
      headers: { authorization: `Bearer ${staffToken}` },
      payload: { publicKeyJwk: validPublicKeyJwk },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json<{ ok: boolean }>().ok).toBe(true);

    const stored = db
      .prepare('SELECT public_key_jwk FROM universities WHERE id = ?')
      .get('uni-1') as { public_key_jwk: string };
    expect(stored.public_key_jwk).toBe(validPublicKeyJwk);
  });

  it('rejects staff of another university with 403', async () => {
    app = await buildApp(config, db);
    const response = await app.inject({
      method: 'PUT',
      url: '/api/university/uni-1/public-key',
      headers: { authorization: `Bearer ${otherUniversityToken}` },
      payload: { publicKeyJwk: validPublicKeyJwk },
    });
    expect(response.statusCode).toBe(403);
  });

  it('rejects a missing token with 401', async () => {
    app = await buildApp(config, db);
    const response = await app.inject({
      method: 'PUT',
      url: '/api/university/uni-1/public-key',
      payload: { publicKeyJwk: validPublicKeyJwk },
    });
    expect(response.statusCode).toBe(401);
  });

  it('rejects a private key or malformed JWK with 400', async () => {
    app = await buildApp(config, db);
    const privateKey = JSON.stringify({
      kty: 'RSA',
      n: 'abc',
      e: 'AQAB',
      d: 'secret-private-exponent',
    });
    const privateResponse = await app.inject({
      method: 'PUT',
      url: '/api/university/uni-1/public-key',
      headers: { authorization: `Bearer ${staffToken}` },
      payload: { publicKeyJwk: privateKey },
    });
    expect(privateResponse.statusCode).toBe(400);

    const malformed = await app.inject({
      method: 'PUT',
      url: '/api/university/uni-1/public-key',
      headers: { authorization: `Bearer ${staffToken}` },
      payload: { publicKeyJwk: 'not-json{' },
    });
    expect(malformed.statusCode).toBe(400);

    const missing = await app.inject({
      method: 'PUT',
      url: '/api/university/uni-1/public-key',
      headers: { authorization: `Bearer ${staffToken}` },
      payload: {},
    });
    expect(missing.statusCode).toBe(400);
  });
});
