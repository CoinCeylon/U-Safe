import { MockLedger } from '@usafe/chain';
import {
  DOMAIN_TAG_COMMITMENT,
  hash,
  proveMembershipMock,
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
    db.prepare(
      `
      INSERT INTO ml_complaints (
        id, university_id, category, urgency, staff_involved, owner_role,
        payload_hash, payload_locator, created_at, deadline_at, status,
        escalated, reopened, support_count, outcome_hash, last_updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, 0, 0, 0, NULL, ?)
    `,
    ).run(
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
      .prepare(
        'SELECT COUNT(*) AS count FROM ml_history WHERE complaint_id = ?',
      )
      .get('complaint-1') as { count: number };
    expect(history.count).toBe(0);
  });
});

describe('M047 complaint routes', () => {
  let db: Database.Database;
  let app: FastifyInstance | undefined;

  beforeEach(() => {
    db = new Database(':memory:');
    runMigrations(db, migrationsDir);
    db.prepare(
      `INSERT INTO universities
         (id, name, domain, enrollment_ceiling, status)
       VALUES ('uni-1', 'University One', 'one.edu', 100, 'active')`,
    ).run();
  });

  afterEach(async () => {
    await app?.close();
    app = undefined;
    db.close();
  });

  it('files, supports, updates, lists, reads and aggregates complaints', async () => {
    const ledger = new MockLedger(db);
    app = await buildApp(config, db, undefined, undefined, undefined, ledger);

    const secret = randomBytes(32);
    const commitmentBytes = await hash(DOMAIN_TAG_COMMITMENT, secret);
    const commitment = Buffer.from(commitmentBytes).toString('hex');
    await ledger.enrollCommitment({ universityId: 'uni-1', commitment });
    const leaves = await ledger.getLeaves({ universityId: 'uni-1' });
    const yearMonth = new Date().toISOString().slice(0, 7);
    const proof = await proveMembershipMock(
      secret,
      leaves.commitments,
      0,
      `file|${yearMonth}|0`,
    );
    proof.universityId = 'uni-1';

    const missingProof = await app.inject({
      method: 'POST',
      url: '/api/complaints',
      payload: {},
    });
    expect(missingProof.statusCode).toBe(401);

    const forgedProof = { ...proof, root: '0'.repeat(64) };
    const forged = await app.inject({
      method: 'POST',
      url: '/api/complaints',
      payload: {
        universityId: 'uni-1',
        category: 'verbal',
        urgency: 'normal',
        staffInvolved: false,
        payloadHash: 'a'.repeat(64),
        payloadLocator: null,
        proof: forgedProof,
      },
    });
    expect(forged.statusCode).toBe(401);

    const filed = await app.inject({
      method: 'POST',
      url: '/api/complaints',
      payload: {
        universityId: 'uni-1',
        category: 'verbal',
        urgency: 'normal',
        staffInvolved: false,
        payloadHash: 'a'.repeat(64),
        payloadLocator: null,
        proof,
      },
    });
    expect(filed.statusCode).toBe(200);
    const complaint = filed.json<{ id: string }>();

    const supportProof = await proveMembershipMock(
      secret,
      leaves.commitments,
      0,
      `support|${complaint.id}`,
    );
    supportProof.universityId = 'uni-1';
    const supported = await app.inject({
      method: 'POST',
      url: `/api/complaints/${complaint.id}/support`,
      payload: { complaintId: complaint.id, proof: supportProof },
    });
    expect(supported.statusCode).toBe(200);
    expect(supported.json<{ supportCount: number }>()).toEqual({
      supportCount: 1,
    });

    const staffId = db
      .prepare(
        `INSERT INTO staff (university_id, role, address, public_key_jwk)
         VALUES ('uni-1', 'investigator', 'staff-1', NULL)`,
      )
      .run().lastInsertRowid;
    const token = issueSession(db, Number(staffId));
    const status = await app.inject({
      method: 'POST',
      url: `/api/complaints/${complaint.id}/status`,
      headers: { authorization: `Bearer ${token}` },
      payload: { newStatus: 'pending_investigation', outcomeHash: null },
    });
    expect(status.statusCode).toBe(200);
    expect(status.json<{ status: string }>()).toEqual({
      complaintId: complaint.id,
      status: 'pending_investigation',
    });

    const list = await app.inject({
      method: 'GET',
      url: '/api/complaints?university=uni-1',
    });
    expect(list.statusCode).toBe(200);
    const listBody = list.json<{ complaints: Array<{ id: string }> }>();
    expect(listBody.complaints.map((item) => item.id)).toEqual([complaint.id]);

    const detail = await app.inject({
      method: 'GET',
      url: `/api/complaints/${complaint.id}?university=uni-1`,
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json<{ complaint: { id: string } }>().complaint.id).toBe(
      complaint.id,
    );

    const stats = await app.inject({
      method: 'GET',
      url: '/api/stats?university=uni-1',
    });
    expect(stats.statusCode).toBe(200);
    expect(
      stats.json<{ totalComplaints: number | null }>().totalComplaints,
    ).toBeNull();

    const leafList = await app.inject({
      method: 'GET',
      url: '/api/universities/uni-1/leaves',
    });
    expect(leafList.statusCode).toBe(200);
    expect(leafList.json<{ commitments: string[] }>().commitments).toEqual([
      commitment,
    ]);

    const roots = await app.inject({
      method: 'GET',
      url: '/api/universities/uni-1/roots',
    });
    expect(roots.statusCode).toBe(200);
    expect(roots.json<{ roots: string[] }>().roots).toHaveLength(1);
  });

  it('uses the mock ledger for HTTP enrollment', async () => {
    const ledger = new MockLedger(db);
    app = await buildApp(config, db, undefined, ledger, undefined, ledger);
    db.prepare(
      'INSERT INTO roster (university_id, email_hash) VALUES (?, ?)',
    ).run('uni-1', emailHash(config.EMAIL_HASH_SALT, 'student@one.edu'));
    const tickets = new TicketService(db, config.EMAIL_HASH_SALT);
    const issued = tickets.issue('student@one.edu');
    expect(issued).not.toBeNull();

    const commitment = 'b'.repeat(64);
    const enrolled = await app.inject({
      method: 'POST',
      url: '/api/enroll',
      payload: { ticket: issued?.ticket, commitment },
    });
    expect(enrolled.statusCode).toBe(200);

    const leaves = await app.inject({
      method: 'GET',
      url: '/api/universities/uni-1/leaves',
    });
    expect(leaves.statusCode).toBe(200);
    expect(leaves.json<{ commitments: string[] }>().commitments).toEqual([
      commitment,
    ]);
  });

  it('returns 501 for UGC reopen until M079', async () => {
    const ledger = new MockLedger(db);
    app = await buildApp(config, db, undefined, undefined, undefined, ledger);
    const ugcStaffId = db
      .prepare(
        `INSERT INTO staff (university_id, role, address, public_key_jwk)
         VALUES (NULL, 'ugc', 'ugc-1', NULL)`,
      )
      .run().lastInsertRowid;
    const token = issueSession(db, Number(ugcStaffId));

    const response = await app.inject({
      method: 'POST',
      url: '/api/complaints/complaint-1/reopen',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(501);
  });
});
