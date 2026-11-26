import Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { SecureStore } from '@usafe/crypto';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import type { Config } from '../config.js';
import { runMigrations } from '../db/migrate.js';
import { deliverCommunityKey } from './communityKey.js';
import type { ComplaintLedger } from './ledger.js';
import type { Mailer } from './mailer.js';

const DELIVERY_SECRET = 'delivery-secret';

const config: Config = {
  NODE_ENV: 'test',
  PORT: 3000,
  HOST: '127.0.0.1',
  CHAIN_MODE: 'mock',
  WEB_ORIGIN: 'http://localhost:5173',
  DATABASE_PATH: ':memory:',
  EMAIL_HASH_SALT: 'test-salt',
  COMMUNITY_DELIVERY_SECRET: DELIVERY_SECRET,
  MAIL_MODE: 'dev',
  SMTP_HOST: '',
  SMTP_PORT: 587,
  SMTP_USER: '',
  SMTP_PASS: '',
  MAIL_FROM: 'noreply@usafe.local',
};

const mailer: Mailer = { send: () => Promise.resolve() };

const migrationsDir = fileURLToPath(new URL('../../migrations', import.meta.url));

// The routes under test only need a ledger that accepts the proof; proof
// verification itself is covered by the MockLedger tests.
const acceptingLedger = {
  verifyMembershipMock: () => Promise.resolve(true),
} as unknown as ComplaintLedger;

let db: Database.Database;
let app: FastifyInstance | undefined;

const communityKey = crypto.getRandomValues(new Uint8Array(32));
const encodedKey = Buffer.from(communityKey).toString('base64');

beforeEach(async () => {
  db = new Database(':memory:');
  runMigrations(db, migrationsDir);
  const wrapped = await SecureStore.exportBackup(
    { communityKey: encodedKey },
    DELIVERY_SECRET,
  );
  db.prepare(
    `INSERT INTO universities
       (id, name, domain, enrollment_ceiling, community_key_wrapped_for_delivery, status)
     VALUES ('u1', 'Uni', 'uni.edu', 10, ?, 'active')`,
  ).run(wrapped);
  db.prepare(
    `INSERT INTO universities
       (id, name, domain, enrollment_ceiling, status)
     VALUES ('u2', 'No Key Uni', 'nokey.edu', 10, 'active')`,
  ).run();
});

afterEach(async () => {
  await app?.close();
  app = undefined;
  db?.close();
});

const getApp = async (): Promise<FastifyInstance> => {
  if (app === undefined) {
    app = await buildApp(
      config,
      db,
      mailer,
      undefined,
      undefined,
      acceptingLedger,
    );
  }
  return app;
};

describe('POST /api/universities/:id/community-key', () => {
  it('returns the community key to a caller with a valid proof', async () => {
    const response = await (
      await getApp()
    ).inject({
      method: 'POST',
      url: '/api/universities/u1/community-key',
      payload: { proof: { any: 'accepted by the stub ledger' } },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json<{ communityKey: string }>()).toEqual({
      communityKey: encodedKey,
    });
  });

  it('rejects a caller without an enrollment proof', async () => {
    const response = await (
      await getApp()
    ).inject({
      method: 'POST',
      url: '/api/universities/u1/community-key',
      payload: {},
    });
    expect(response.statusCode).toBe(401);
  });

  it('rejects an unknown university', async () => {
    const response = await (
      await getApp()
    ).inject({
      method: 'POST',
      url: '/api/universities/missing/community-key',
      payload: { proof: { any: 'accepted by the stub ledger' } },
    });
    expect(response.statusCode).toBe(404);
  });

  it('reports a university without a delivered key as unavailable', async () => {
    const response = await (
      await getApp()
    ).inject({
      method: 'POST',
      url: '/api/universities/u2/community-key',
      payload: { proof: { any: 'accepted by the stub ledger' } },
    });
    expect(response.statusCode).toBe(503);
  });
});

describe('deliverCommunityKey', () => {
  it('rejects an empty delivery secret with an actionable error', async () => {
    await expect(deliverCommunityKey(db, 'u1', '')).rejects.toThrow(
      'community key delivery not configured',
    );
  });

  it('rejects a secret that does not match the stored backup', async () => {
    await expect(
      deliverCommunityKey(db, 'u1', 'a-different-secret'),
    ).rejects.toThrow('community key backup unreadable');
  });

  it('returns the key when the delivery secret matches', async () => {
    await expect(deliverCommunityKey(db, 'u1', DELIVERY_SECRET)).resolves.toBe(
      encodedKey,
    );
  });
});

describe('GET /api/ugc/public-key', () => {
  it('returns the registered UGC public key', async () => {
    const jwk = JSON.stringify({ kty: 'RSA', e: 'AQAB' });
    db.prepare(
      `INSERT INTO staff (university_id, role, address, public_key_jwk)
       VALUES (NULL, 'ugc', 'ugc-demo-officer', ?)`,
    ).run(jwk);

    const response = await (await getApp()).inject({
      method: 'GET',
      url: '/api/ugc/public-key',
    });
    expect(response.statusCode).toBe(200);
    expect(response.json<{ publicKeyJwk: unknown }>().publicKeyJwk).toEqual(
      JSON.parse(jwk),
    );
  });

  it('returns 404 when no UGC key is registered', async () => {
    const response = await (await getApp()).inject({
      method: 'GET',
      url: '/api/ugc/public-key',
    });
    expect(response.statusCode).toBe(404);
  });
});
