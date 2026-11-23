import { MERKLE_TREE_DEPTH, MerkleTree, Sha256Adapter } from '@usafe/crypto';
import Database from 'better-sqlite3';
import type { FastifyInstance } from 'fastify';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app.js';
import type { Config } from '../config.js';
import { runMigrations } from '../db/migrate.js';
import { EnrollmentService } from './enrollment.js';
import { StubLedger } from './ledger.js';
import type { Mailer } from './mailer.js';
import { emailHash } from './roster.js';
import { TicketService } from './tickets.js';

const salt = 'test-salt';
const email = 'student@uni.edu';
const secondEmail = 'second@uni.edu';
const commitment = 'a'.repeat(64);
const secondCommitment = 'b'.repeat(64);
const migrationsDir = fileURLToPath(new URL('../../migrations', import.meta.url));

const config: Config = {
  NODE_ENV: 'test',
  PORT: 3000,
  HOST: '127.0.0.1',
  CHAIN_MODE: 'mock',
  WEB_ORIGIN: 'http://localhost:5173',
  DATABASE_PATH: ':memory:',
  EMAIL_HASH_SALT: salt,
  MAIL_MODE: 'dev',
  SMTP_HOST: '',
  SMTP_PORT: 587,
  SMTP_USER: '',
  SMTP_PASS: '',
  MAIL_FROM: 'noreply@usafe.local',
};

const mailer: Mailer = { send: () => Promise.resolve() };

let db: Database.Database;
let tickets: TicketService;
let enrollment: EnrollmentService;
let ledger: StubLedger;

beforeEach(() => {
  db = new Database(':memory:');
  runMigrations(db, migrationsDir);
  db.prepare(
    `INSERT INTO universities
       (id, name, domain, enrollment_ceiling, community_key_wrapped_for_ugc, status)
       VALUES ('u1', 'Uni', 'uni.edu', 2, 'wrapped-key', 'active')`,
  ).run();
  db.prepare('INSERT INTO roster (university_id, email_hash) VALUES (?, ?)').run(
    'u1',
    emailHash(salt, email),
  );
  db.prepare('INSERT INTO roster (university_id, email_hash) VALUES (?, ?)').run(
    'u1',
    emailHash(salt, secondEmail),
  );
  tickets = new TicketService(db, salt);
  ledger = new StubLedger();
  enrollment = new EnrollmentService(db, tickets, ledger);
});

afterEach(() => {
  db.close();
});

const ticketFor = (address: string): string => tickets.issue(address)?.ticket ?? '';

describe('EnrollmentService.enroll', () => {
  it('returns a valid Merkle receipt and the wrapped community key', async () => {
    const result = enrollment.enroll(ticketFor(email), commitment);
    expect(result.leafIndex).toBe(0);
    expect(result.path).toHaveLength(MERKLE_TREE_DEPTH);
    expect(result.root).toMatch(/^[a-f0-9]{64}$/);
    expect(result.communityKeyWrapped).toBe('wrapped-key');

    const adapter = new Sha256Adapter();
    const proof = result.path.map((sibling) => new Uint8Array(Buffer.from(sibling, 'hex')));
    expect(
      await MerkleTree.verify(
        new Uint8Array(Buffer.from(commitment, 'hex')),
        proof,
        result.leafIndex,
        new Uint8Array(Buffer.from(result.root, 'hex')),
        adapter,
      ),
    ).toBe(true);
  });

  it('burns the ticket and leaves no commitment beside the roster row', () => {
    const ticket = ticketFor(email);
    enrollment.enroll(ticket, commitment);

    expect(() => enrollment.enroll(ticket, commitment)).toThrow('invalid ticket');
    const roster = db
      .prepare('SELECT enrolled_at FROM roster WHERE email_hash = ?')
      .get(emailHash(salt, email)) as { enrolled_at: string | null };
    expect(roster.enrolled_at).not.toBeNull();

    const columns = db.prepare('PRAGMA table_info(roster)').all() as Array<{ name: string }>;
    expect(columns.map((column) => column.name)).not.toContain('commitment');

    const used = db.prepare('SELECT used FROM tickets WHERE id = ?').get(ticket) as {
      used: number;
    };
    expect(used.used).toBe(1);
  });

  it('rejects enrollment past the ceiling without burning the ticket', () => {
    db.prepare('UPDATE universities SET enrollment_ceiling = 1 WHERE id = ?').run('u1');
    const first = ticketFor(email);
    const second = ticketFor(secondEmail);
    enrollment.enroll(first, commitment);

    expect(() => enrollment.enroll(second, secondCommitment)).toThrow('ceiling reached');
    const used = db.prepare('SELECT used FROM tickets WHERE id = ?').get(second) as {
      used: number;
    };
    expect(used.used).toBe(0);
  });

  it('rejects a duplicate commitment without burning the ticket', () => {
    const first = ticketFor(email);
    const second = ticketFor(secondEmail);
    enrollment.enroll(first, commitment);

    expect(() => enrollment.enroll(second, commitment)).toThrow('duplicate commitment');
    const used = db.prepare('SELECT used FROM tickets WHERE id = ?').get(second) as {
      used: number;
    };
    expect(used.used).toBe(0);
  });
});

describe('POST /api/enroll', () => {
  let app: FastifyInstance | undefined;

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  const getApp = async (): Promise<FastifyInstance> => {
    if (app === undefined) {
      app = await buildApp(config, db, mailer, ledger);
    }
    return app;
  };

  it('returns leaf index, path, root and wrapped key only', async () => {
    const ticket = ticketFor(email);
    const response = await (await getApp()).inject({
      method: 'POST',
      url: '/api/enroll',
      payload: { ticket, commitment },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json<{
      leafIndex: number;
      path: string[];
      root: string;
      communityKeyWrapped: string;
    }>();
    expect(body.leafIndex).toBe(0);
    expect(body.path).toHaveLength(MERKLE_TREE_DEPTH);
    expect(body.communityKeyWrapped).toBe('wrapped-key');
    expect(Object.keys(body).sort()).toEqual([
      'communityKeyWrapped',
      'leafIndex',
      'path',
      'root',
    ]);
  });

  it('rejects a reused ticket', async () => {
    const ticket = ticketFor(email);
    const instance = await getApp();
    const payload = { ticket, commitment };
    await instance.inject({ method: 'POST', url: '/api/enroll', payload });
    const second = await instance.inject({ method: 'POST', url: '/api/enroll', payload });
    expect(second.statusCode).toBe(400);
    expect(second.json<{ error: string }>()).toEqual({ error: 'invalid ticket' });
  });

  it('rejects a malformed commitment', async () => {
    const ticket = ticketFor(email);
    const response = await (await getApp()).inject({
      method: 'POST',
      url: '/api/enroll',
      payload: { ticket, commitment: 'not-hex' },
    });
    expect(response.statusCode).toBe(400);
  });
});
