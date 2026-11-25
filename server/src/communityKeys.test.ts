import {
  SecureStore,
  openPayload,
  sealPayload,
} from '@usafe/crypto';
import Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import type { Config } from './config.js';
import { runMigrations } from './db/migrate.js';
import { emailHash } from './services/roster.js';
import { issueSession } from './services/staffAuth.js';
import { TicketService } from './services/tickets.js';

const migrationsDir = fileURLToPath(new URL('../migrations', import.meta.url));
const deliverySecret = 'test-community-delivery-secret';
const ugcPublicKeyJwk = JSON.stringify({
  kty: 'RSA',
  n: 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG',
  e: 'AQAB',
});

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
  COMMUNITY_DELIVERY_SECRET: deliverySecret,
};

interface Setup {
  db: Database.Database;
  app: FastifyInstance;
  adminToken: string;
  investigatorToken: string;
  otherAdminToken: string;
}

const createStaff = (
  db: Database.Database,
  universityId: string | null,
  role: string,
  address: string,
): string => {
  const id = db
    .prepare(
      `INSERT INTO staff (university_id, role, address, public_key_jwk)
       VALUES (?, ?, ?, NULL)`,
    )
    .run(universityId, role, address).lastInsertRowid;
  return issueSession(db, Number(id));
};

const setup = async (): Promise<Setup> => {
  const db = new Database(':memory:');
  runMigrations(db, migrationsDir);
  db.prepare(
    `INSERT INTO universities
       (id, name, domain, enrollment_ceiling, status)
     VALUES ('uni-1', 'University One', 'one.edu', 10, 'active')`,
  ).run();
  db.prepare(
    `INSERT INTO universities
       (id, name, domain, enrollment_ceiling, status)
     VALUES ('uni-2', 'University Two', 'two.edu', 10, 'active')`,
  ).run();
  db.prepare(
    `INSERT INTO staff (university_id, role, address, public_key_jwk)
     VALUES (NULL, 'ugc', 'ugc-demo', ?)`,
  ).run(ugcPublicKeyJwk);

  const adminToken = createStaff(db, 'uni-1', 'admin', 'admin-1');
  const investigatorToken = createStaff(
    db,
    'uni-1',
    'investigator',
    'investigator-1',
  );
  const otherAdminToken = createStaff(db, 'uni-2', 'admin', 'admin-2');

  const app = await buildApp(config, db);
  return { db, app, adminToken, investigatorToken, otherAdminToken };
};

describe('M065 community key management', () => {
  let env: Setup;

  beforeEach(async () => {
    env = await setup();
  });

  afterEach(async () => {
    await env.app.close();
    env.db.close();
  });

  it('returns key metadata and the UGC public key to an admin', async () => {
    const response = await env.app.inject({
      method: 'GET',
      url: '/api/university/uni-1/community-key',
      headers: { authorization: `Bearer ${env.adminToken}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      hasKey: false,
      createdAt: null,
      academicYear: null,
      ugcPublicKeyJwk,
    });
  });

  it('rejects non-admin staff and other universities', async () => {
    for (const token of [env.investigatorToken, env.otherAdminToken]) {
      const response = await env.app.inject({
        method: 'GET',
        url: '/api/university/uni-1/community-key',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.statusCode).toBe(403);
    }

    const missing = await env.app.inject({
      method: 'GET',
      url: '/api/university/uni-1/community-key',
    });
    expect(missing.statusCode).toBe(401);
  });

  it('stores a wrapped copy and never the plaintext key', async () => {
    const keyBase64 = randomBytes(32).toString('base64');
    const wrappedForUgc = randomBytes(256).toString('base64');

    const response = await env.app.inject({
      method: 'POST',
      url: '/api/university/uni-1/community-key',
      headers: { authorization: `Bearer ${env.adminToken}` },
      payload: { communityKey: keyBase64, wrappedForUgc },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{ createdAt: string; academicYear: string }>();
    expect(body.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(body.academicYear).toMatch(/^\d{4}\/\d{4}$/);

    const row = env.db
      .prepare(
        `SELECT community_key_wrapped_for_ugc,
                community_key_wrapped_for_delivery,
                community_key_created_at,
                community_key_academic_year
         FROM universities WHERE id = ?`,
      )
      .get('uni-1') as {
      community_key_wrapped_for_ugc: string;
      community_key_wrapped_for_delivery: string;
      community_key_created_at: string;
      community_key_academic_year: string;
    };

    expect(row.community_key_wrapped_for_ugc).toBe(wrappedForUgc);
    expect(row.community_key_wrapped_for_delivery).not.toContain(keyBase64);
    expect(row.community_key_created_at).toBe(body.createdAt);
    expect(row.community_key_academic_year).toBe(body.academicYear);

    const opened = await SecureStore.importBackup(
      row.community_key_wrapped_for_delivery,
      deliverySecret,
    );
    expect(opened.communityKey).toBe(keyBase64);
  });

  it('rejects a key that is not 32 bytes or a malformed wrapped copy', async () => {
    const response = await env.app.inject({
      method: 'POST',
      url: '/api/university/uni-1/community-key',
      headers: { authorization: `Bearer ${env.adminToken}` },
      payload: {
        communityKey: randomBytes(16).toString('base64'),
        wrappedForUgc: randomBytes(256).toString('base64'),
      },
    });
    expect(response.statusCode).toBe(400);

    const shortWrapped = await env.app.inject({
      method: 'POST',
      url: '/api/university/uni-1/community-key',
      headers: { authorization: `Bearer ${env.adminToken}` },
      payload: {
        communityKey: randomBytes(32).toString('base64'),
        wrappedForUgc: 'short',
      },
    });
    expect(shortWrapped.statusCode).toBe(400);
  });

  it('lets a newly enrolled student receive the key and open a complaint payload', async () => {
    const keyBase64 = randomBytes(32).toString('base64');
    const created = await env.app.inject({
      method: 'POST',
      url: '/api/university/uni-1/community-key',
      headers: { authorization: `Bearer ${env.adminToken}` },
      payload: {
        communityKey: keyBase64,
        wrappedForUgc: randomBytes(256).toString('base64'),
      },
    });
    expect(created.statusCode).toBe(200);

    const email = 'student@one.edu';
    env.db
      .prepare('INSERT INTO roster (university_id, email_hash) VALUES (?, ?)')
      .run('uni-1', emailHash(config.EMAIL_HASH_SALT, email));
    const ticket = new TicketService(env.db, config.EMAIL_HASH_SALT).issue(email);
    expect(ticket).not.toBeNull();

    const enrolled = await env.app.inject({
      method: 'POST',
      url: '/api/enroll',
      payload: { ticket: ticket?.ticket, commitment: 'c'.repeat(64) },
    });
    expect(enrolled.statusCode).toBe(200);
    const delivered = enrolled.json<{ communityKey: string }>().communityKey;
    expect(delivered).toBe(keyBase64);

    const keyBytes = new Uint8Array(Buffer.from(keyBase64, 'base64'));
    const sealed = await sealPayload(
      { description: 'A complaint filed before this student enrolled.' },
      keyBytes,
    );
    const opened = (await openPayload(
      sealed,
      new Uint8Array(Buffer.from(delivered, 'base64')),
    )) as { description: string };
    expect(opened.description).toBe(
      'A complaint filed before this student enrolled.',
    );
  });
});
