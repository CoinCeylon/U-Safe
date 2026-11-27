import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import {
  MerkleTree,
  Sha256Adapter,
  proveMembershipMock,
  hash,
} from '@usafe/crypto';
import { DOMAIN_TAG_COMMITMENT } from '@usafe/crypto';
import { MockLedger } from './mock.js';

const newDb = (): { db: Database.Database; dir: string } => {
  const dir = mkdtempSync(join(tmpdir(), 'usafe-mock-'));
  const db = new Database(join(dir, 'usafe.db'));
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE universities (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      domain TEXT NOT NULL,
      enrollment_ceiling INTEGER NOT NULL DEFAULT 0,
      public_key_jwk TEXT,
      community_key_wrapped_for_ugc TEXT,
      status TEXT NOT NULL DEFAULT 'active'
    );
    CREATE TABLE ml_leaves (
      university_id TEXT NOT NULL,
      leaf_index INTEGER NOT NULL,
      commitment TEXT NOT NULL,
      PRIMARY KEY (university_id, leaf_index),
      UNIQUE (university_id, commitment),
      FOREIGN KEY (university_id) REFERENCES universities (id)
    );
    CREATE TABLE ml_roots (
      university_id TEXT NOT NULL,
      root TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (university_id, root),
      FOREIGN KEY (university_id) REFERENCES universities (id)
    );
    CREATE TABLE ml_nullifiers (
      kind TEXT NOT NULL,
      value TEXT NOT NULL,
      PRIMARY KEY (kind, value)
    );
    CREATE TABLE ml_complaints (
      id TEXT PRIMARY KEY,
      university_id TEXT NOT NULL,
      category TEXT NOT NULL,
      urgency TEXT NOT NULL,
      staff_involved INTEGER NOT NULL DEFAULT 0,
      owner_role TEXT NOT NULL,
      payload_hash TEXT NOT NULL,
      payload_locator TEXT,
      created_at TEXT NOT NULL,
      deadline_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'not_started',
      escalated INTEGER NOT NULL DEFAULT 0,
      reopened INTEGER NOT NULL DEFAULT 0,
      support_count INTEGER NOT NULL DEFAULT 0,
      outcome_hash TEXT,
      outcome_locator TEXT,
      last_updated_at TEXT NOT NULL,
      FOREIGN KEY (university_id) REFERENCES universities (id)
    );
    CREATE TABLE ml_history (
      complaint_id TEXT NOT NULL,
      status TEXT NOT NULL,
      at TEXT NOT NULL,
      actor_role TEXT NOT NULL,
      note_hash TEXT,
      FOREIGN KEY (complaint_id) REFERENCES ml_complaints (id)
    );
    CREATE TABLE ml_complaint_sequence (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      next_value INTEGER NOT NULL
    );
    INSERT INTO ml_complaint_sequence (id, next_value) VALUES (1, 1);
  `);
  return { db, dir };
};

const commitment = (): string => randomBytes(32).toString('hex');

const insertStatsComplaint = (
  db: Database.Database,
  id: string,
  universityId: string,
  category: string,
): void => {
  db.prepare(`
    INSERT INTO ml_complaints (
      id, university_id, category, urgency, staff_involved, owner_role,
      payload_hash, payload_locator, created_at, deadline_at, status,
      escalated, reopened, support_count, outcome_hash, last_updated_at
    ) VALUES (?, ?, ?, 'normal', 0, 'university', ?, NULL, ?, ?, 'not_started', 0, 0, 0, NULL, ?)
  `).run(
    id,
    universityId,
    category,
    `payload-${id}`,
    '2026-03-01T00:00:00.000Z',
    '2027-01-01T00:00:00.000Z',
    '2026-03-01T00:00:00.000Z',
  );
};

// Verifies a returned membership proof recomputes to the reported root.
const verifyProof = async (
  commitmentHex: string,
  leafIndex: number,
  pathHex: string[],
  rootHex: string,
): Promise<boolean> => {
  const hashAdapter = new Sha256Adapter();
  return MerkleTree.verify(
    Buffer.from(commitmentHex, 'hex'),
    pathHex.map((h) => Buffer.from(h, 'hex')),
    leafIndex,
    Buffer.from(rootHex, 'hex'),
    hashAdapter,
    20,
  );
};

describe('MockLedger (M037)', () => {
  it('enrolls 50 commitments consistently, then rejects the 51st at ceiling 50, and rejects duplicates', async () => {
    const { db, dir } = newDb();
    db.prepare(
      `INSERT INTO universities (id, name, domain, enrollment_ceiling) VALUES (?, ?, ?, ?)`,
    ).run('uni-1', 'Test University', 'test.ac.lk', 50);
    const ledger = new MockLedger(db);

    const commitments: string[] = [];
    const receipts: Array<{ leafIndex: number; root: string; path: string[] }> =
      [];

    // 50 enrollments succeed with consistent, verifiable roots.
    for (let i = 0; i < 50; i += 1) {
      const c = commitment();
      commitments.push(c);
      const r = await ledger.enrollCommitment({
        universityId: 'uni-1',
        commitment: c,
      });
      expect(r.leafIndex).toBe(i);
      expect(r.path).toHaveLength(20);
      expect(await verifyProof(c, r.leafIndex, r.path, r.root)).toBe(true);
      receipts.push(r);
    }

    // Roots advance with each enrollment (no two consecutive enrollments share
    // the same root once at least one leaf exists).
    const roots = receipts.map((r) => r.root);
    expect(new Set(roots).size).toBeGreaterThan(1);

    // 51st enrollment hits the ceiling.
    await expect(
      ledger.enrollCommitment({ universityId: 'uni-1', commitment: commitment() }),
    ).rejects.toThrow('enrollment ceiling reached');

    // A duplicate commitment is rejected.
    await expect(
      ledger.enrollCommitment({
        universityId: 'uni-1',
        commitment: commitments[0]!,
      }),
    ).rejects.toThrow('duplicate commitment');

    // Unknown university is rejected.
    await expect(
      ledger.enrollCommitment({ universityId: 'no-such', commitment: commitment() }),
    ).rejects.toThrow('unknown university');

    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('getLeaves returns the public list of commitments', async () => {
    const { db, dir } = newDb();
    db.prepare(
      `INSERT INTO universities (id, name, domain, enrollment_ceiling) VALUES (?, ?, ?, ?)`,
    ).run('uni-1', 'Test University', 'test.ac.lk', 10);
    const ledger = new MockLedger(db);

    const c1 = commitment();
    const c2 = commitment();
    await ledger.enrollCommitment({ universityId: 'uni-1', commitment: c1 });
    await ledger.enrollCommitment({ universityId: 'uni-1', commitment: c2 });

    const leaves = await ledger.getLeaves({ universityId: 'uni-1' });
    expect(leaves.commitments).toEqual([c1, c2]);

    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('getRoots returns the current root and roots within the grace window', async () => {
    const { db, dir } = newDb();
    db.prepare(
      `INSERT INTO universities (id, name, domain, enrollment_ceiling) VALUES (?, ?, ?, ?)`,
    ).run('uni-1', 'Test University', 'test.ac.lk', 10);
    const ledger = new MockLedger(db);

    const r1 = await ledger.enrollCommitment({
      universityId: 'uni-1',
      commitment: commitment(),
    });
    const r2 = await ledger.enrollCommitment({
      universityId: 'uni-1',
      commitment: commitment(),
    });

    const roots = await ledger.getRoots({ universityId: 'uni-1' });
    expect(roots.currentRoot).toBe(r2.root);
    expect(roots.roots).toContain(r1.root);
    expect(roots.roots).toContain(r2.root);

    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('keeps the current root valid after the grace window when no new enrollment happens', async () => {
    const { db, dir } = newDb();
    db.prepare(
      `INSERT INTO universities (id, name, domain, enrollment_ceiling) VALUES (?, ?, ?, ?)`,
    ).run('uni-1', 'Test University', 'test.ac.lk', 10);
    const ledger = new MockLedger(db);

    const secret = randomBytes(32);
    const commitmentHex = Buffer.from(
      await hash(DOMAIN_TAG_COMMITMENT, secret),
    ).toString('hex');
    await ledger.enrollCommitment({
      universityId: 'uni-1',
      commitment: commitmentHex,
    });

    // Simulate a university with no new enrollment for 15 days. The current
    // root is older than the 14-day grace window, but it must stay valid.
    const old = new Date(
      Date.now() - 15 * 24 * 60 * 60 * 1000,
    ).toISOString();
    db.prepare(
      'UPDATE ml_roots SET created_at = ? WHERE university_id = ?',
    ).run(old, 'uni-1');

    const roots = await ledger.getRoots({ universityId: 'uni-1' });
    expect(roots.roots).toContain(roots.currentRoot);

    const leaves = await ledger.getLeaves({ universityId: 'uni-1' });
    const yearMonth = new Date().toISOString().slice(0, 7);
    const proof = await proveMembershipMock(
      secret,
      leaves.commitments,
      0,
      `file|${yearMonth}|0`,
    );
    proof.universityId = 'uni-1';

    const filed = await ledger.fileComplaint({
      universityId: 'uni-1',
      category: 'verbal',
      urgency: 'normal',
      staffInvolved: false,
      payloadHash: 'hash-' + randomBytes(16).toString('hex'),
      payloadLocator: null,
      proof,
    });
    expect(filed.id).toMatch(/^c-/);

    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('fileComplaint accepts a valid filing, rejects duplicate nullifier, and enforces two slots per month', async () => {
    const yearMonth = new Date().toISOString().slice(0, 7);
    const { db, dir } = newDb();
    db.prepare(
      `INSERT INTO universities (id, name, domain, enrollment_ceiling) VALUES (?, ?, ?, ?)`,
    ).run('uni-1', 'Test University', 'test.ac.lk', 10);
    const ledger = new MockLedger(db);

    // Enroll a student.
    const secret = randomBytes(32);
    const commitmentBytes = await hash(DOMAIN_TAG_COMMITMENT, secret);
    const commitmentHex = Buffer.from(commitmentBytes).toString('hex');

    await ledger.enrollCommitment({
      universityId: 'uni-1',
      commitment: commitmentHex,
    });

    const leaves = await ledger.getLeaves({ universityId: 'uni-1' });
    expect(leaves.commitments).toContain(commitmentHex);
    const leafIndex = leaves.commitments.indexOf(commitmentHex);

    // Build a mock proof for filing (slot 0).
    const proof0 = await proveMembershipMock(
      secret,
      leaves.commitments,
      leafIndex,
      `file|${yearMonth}|0`,
    );
    proof0.universityId = 'uni-1';

    const result0 = await ledger.fileComplaint({
      universityId: 'uni-1',
      category: 'verbal',
      urgency: 'normal',
      staffInvolved: false,
      payloadHash: 'hash-' + randomBytes(16).toString('hex'),
      payloadLocator: null,
      proof: proof0,
    });
    expect(result0.id).toMatch(/^c-/);

    // Same nullifier again (same slot 0) -> rejected.
    await expect(
      ledger.fileComplaint({
        universityId: 'uni-1',
        category: 'verbal',
        urgency: 'normal',
        staffInvolved: false,
        payloadHash: 'hash-' + randomBytes(16).toString('hex'),
        payloadLocator: null,
        proof: proof0,
      }),
    ).rejects.toThrow('filing nullifier already used');

    // Second filing with slot 1 -> accepted (different nullifier).
    const proof1 = await proveMembershipMock(
      secret,
      leaves.commitments,
      leafIndex,
      `file|${yearMonth}|1`,
    );
    proof1.universityId = 'uni-1';
    const result1 = await ledger.fileComplaint({
      universityId: 'uni-1',
      category: 'physical',
      urgency: 'urgent',
      staffInvolved: false,
      payloadHash: 'hash-' + randomBytes(16).toString('hex'),
      payloadLocator: null,
      proof: proof1,
    });
    expect(result1.id).toMatch(/^c-/);

    // Third filing with slot 0 -> rejected (both slots used).
    await expect(
      ledger.fileComplaint({
        universityId: 'uni-1',
        category: 'verbal',
        urgency: 'normal',
        staffInvolved: false,
        payloadHash: 'hash-' + randomBytes(16).toString('hex'),
        payloadLocator: null,
        proof: proof0,
      }),
    ).rejects.toThrow('filing nullifier already used');

    // Invalid proof (wrong universityId) -> rejected.
    const badProof = { ...proof0, universityId: 'no-such' };
    await expect(
      ledger.fileComplaint({
        universityId: 'no-such',
        category: 'verbal',
        urgency: 'normal',
        staffInvolved: false,
        payloadHash: 'hash-' + randomBytes(16).toString('hex'),
        payloadLocator: null,
        proof: badProof,
      }),
    ).rejects.toThrow();

    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('rejects a filing whose proof context names a different month (M039)', async () => {
    const { db, dir } = newDb();
    db.prepare(
      `INSERT INTO universities (id, name, domain, enrollment_ceiling) VALUES (?, ?, ?, ?)`,
    ).run('uni-1', 'Test University', 'test.ac.lk', 10);
    const ledger = new MockLedger(db);

    const secret = randomBytes(32);
    const commitmentHex = Buffer.from(
      await hash(DOMAIN_TAG_COMMITMENT, secret),
    ).toString('hex');
    await ledger.enrollCommitment({
      universityId: 'uni-1',
      commitment: commitmentHex,
    });

    const leaves = await ledger.getLeaves({ universityId: 'uni-1' });
    const proof = await proveMembershipMock(
      secret,
      leaves.commitments,
      0,
      'file|1999-01|0',
    );
    proof.universityId = 'uni-1';

    await expect(
      ledger.fileComplaint({
        universityId: 'uni-1',
        category: 'verbal',
        urgency: 'normal',
        staffInvolved: false,
        payloadHash: 'hash-' + randomBytes(16).toString('hex'),
        payloadLocator: null,
        proof,
      }),
    ).rejects.toThrow('filing context month is not the current month');

    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('fileComplaint sets ownerRole to ugc when staffInvolved', async () => {
    const yearMonth = new Date().toISOString().slice(0, 7);
    const { db, dir } = newDb();
    db.prepare(
      `INSERT INTO universities (id, name, domain, enrollment_ceiling) VALUES (?, ?, ?, ?)`,
    ).run('uni-1', 'Test University', 'test.ac.lk', 10);
    const ledger = new MockLedger(db);

    const secret = randomBytes(32);
    const { hash, DOMAIN_TAG_COMMITMENT } = await import('@usafe/crypto');
    const commitmentBytes = await hash(DOMAIN_TAG_COMMITMENT, secret);
    const commitmentHex = Buffer.from(commitmentBytes).toString('hex');

    await ledger.enrollCommitment({
      universityId: 'uni-1',
      commitment: commitmentHex,
    });

    const leaves = await ledger.getLeaves({ universityId: 'uni-1' });
    const leafIndex = leaves.commitments.indexOf(commitmentHex);

    const proof = await proveMembershipMock(
      secret,
      leaves.commitments,
      leafIndex,
      `file|${yearMonth}|0`,
    );
    proof.universityId = 'uni-1';

    const result = await ledger.fileComplaint({
      universityId: 'uni-1',
      category: 'sexual',
      urgency: 'urgent',
      staffInvolved: true,
      payloadHash: 'hash-' + randomBytes(16).toString('hex'),
      payloadLocator: null,
      proof,
    });
    expect(result.id).toMatch(/^c-/);

    // Verify the stored record has owner_role = 'ugc'.
    const row = db
      .prepare(
        `SELECT owner_role, staff_involved, status, support_count
         FROM ml_complaints WHERE id = ?`,
      )
      .get(result.id) as {
      owner_role: string;
      staff_involved: number;
      status: string;
      support_count: number;
    };
    expect(row.owner_role).toBe('ugc');
    expect(row.staff_involved).toBe(1);
    expect(row.status).toBe('not_started');
    expect(row.support_count).toBe(0);

    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('redacts staff-involved complaints in the university list', async () => {
    const { db, dir } = newDb();
    db.prepare(
      `INSERT INTO universities (id, name, domain, enrollment_ceiling) VALUES (?, ?, ?, ?)`,
    ).run('uni-1', 'Test University', 'test.ac.lk', 10);
    const ledger = new MockLedger(db);

    const insert = db.prepare(`
      INSERT INTO ml_complaints (
        id, university_id, category, urgency, staff_involved, owner_role,
        payload_hash, payload_locator, created_at, deadline_at, status,
        escalated, reopened, support_count, outcome_hash, last_updated_at
      ) VALUES (?, 'uni-1', ?, 'normal', ?, ?, ?, NULL, ?, ?, 'not_started', 0, 0, ?, NULL, ?)
    `);
    insert.run(
      'c-staff',
      'sexual',
      1,
      'ugc',
      'payload-hash',
      '2026-01-01T00:00:00.000Z',
      '2026-01-08T00:00:00.000Z',
      4,
      '2026-01-01T00:00:00.000Z',
    );
    insert.run(
      'c-normal',
      'verbal',
      0,
      'university',
      'other-payload-hash',
      '2026-01-02T00:00:00.000Z',
      '2026-01-09T00:00:00.000Z',
      2,
      '2026-01-02T00:00:00.000Z',
    );

    const result = await ledger.listComplaints({
      viewerRole: 'university',
      universityId: 'uni-1',
    });

    expect(result.complaints).toHaveLength(2);
    expect(result.complaints[0]).toEqual({
      id: 'c-normal',
      universityId: 'uni-1',
      category: 'verbal',
      urgency: 'normal',
      staffInvolved: false,
      ownerRole: 'university',
      payloadHash: 'other-payload-hash',
      createdAt: '2026-01-02T00:00:00.000Z',
      deadlineAt: '2026-01-09T00:00:00.000Z',
      status: 'not_started',
      escalated: false,
      reopened: false,
      supportCount: 2,
      outcomeHash: null,
      lastUpdatedAt: '2026-01-02T00:00:00.000Z',
    });
    expect(result.complaints[1]).toEqual({
      id: 'c-staff',
      createdAt: '2026-01-01T00:00:00.000Z',
      category: 'sexual',
      supportCount: 4,
      status: 'not_started',
    });
    expect(Object.keys(result.complaints[1]!)).toEqual([
      'id',
      'createdAt',
      'category',
      'supportCount',
      'status',
    ]);

    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('filters list, detail, history and stats by viewer role', async () => {
    const { db, dir } = newDb();
    db.prepare(
      `INSERT INTO universities (id, name, domain, enrollment_ceiling) VALUES (?, ?, ?, ?)`,
    ).run('uni-1', 'Test University', 'test.ac.lk', 10);
    db.prepare(
      `INSERT INTO universities (id, name, domain, enrollment_ceiling) VALUES (?, ?, ?, ?)`,
    ).run('uni-2', 'Other University', 'other.ac.lk', 10);
    const ledger = new MockLedger(db);

    const insertComplaint = db.prepare(`
      INSERT INTO ml_complaints (
        id, university_id, category, urgency, staff_involved, owner_role,
        payload_hash, payload_locator, created_at, deadline_at, status,
        escalated, reopened, support_count, outcome_hash, last_updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, 0, 0, ?, NULL, ?)
    `);
    insertComplaint.run(
      'c-uni1-normal',
      'uni-1',
      'verbal',
      'normal',
      0,
      'university',
      'payload-1',
      '2026-02-01T00:00:00.000Z',
      '2026-01-01T00:00:00.000Z',
      'not_started',
      3,
      '2026-02-01T00:00:00.000Z',
    );
    insertComplaint.run(
      'c-uni1-staff',
      'uni-1',
      'sexual',
      'urgent',
      1,
      'ugc',
      'payload-2',
      '2026-02-02T00:00:00.000Z',
      '2027-01-01T00:00:00.000Z',
      'pending_investigation',
      2,
      '2026-02-02T00:00:00.000Z',
    );
    insertComplaint.run(
      'c-uni2-normal',
      'uni-2',
      'cyber',
      'normal',
      0,
      'university',
      'payload-3',
      '2026-02-03T00:00:00.000Z',
      '2027-02-01T00:00:00.000Z',
      'finished',
      1,
      '2026-02-03T00:00:00.000Z',
    );

    const insertHistory = db.prepare(`
      INSERT INTO ml_history (complaint_id, status, at, actor_role, note_hash)
      VALUES (?, ?, ?, ?, NULL)
    `);
    insertHistory.run(
      'c-uni1-normal',
      'not_started',
      '2026-02-01T00:00:00.000Z',
      'student',
    );
    insertHistory.run(
      'c-uni1-normal',
      'pending_investigation',
      '2026-02-04T00:00:00.000Z',
      'university',
    );

    const studentList = await ledger.listComplaints({
      viewerRole: 'student',
      universityId: 'uni-1',
    });
    expect(studentList.complaints.map((complaint) => complaint.id)).toEqual([
      'c-uni1-staff',
      'c-uni1-normal',
    ]);
    expect(Object.keys(studentList.complaints[0]!)).not.toContain(
      'payloadLocator',
    );
    expect(Object.keys(studentList.complaints[0]!)).not.toContain(
      'evidenceLocator',
    );

    const universityList = await ledger.listComplaints({
      viewerRole: 'university',
      universityId: 'uni-1',
    });
    expect(universityList.complaints.map((complaint) => complaint.id)).toEqual([
      'c-uni1-staff',
      'c-uni1-normal',
    ]);
    expect(universityList.complaints[0]).toEqual({
      id: 'c-uni1-staff',
      createdAt: '2026-02-02T00:00:00.000Z',
      category: 'sexual',
      supportCount: 2,
      status: 'pending_investigation',
    });

    const ugcList = await ledger.listComplaints({ viewerRole: 'ugc' });
    expect(ugcList.complaints.map((complaint) => complaint.id)).toEqual([
      'c-uni2-normal',
      'c-uni1-staff',
      'c-uni1-normal',
    ]);
    expect(
      (ugcList.complaints[1]! as { staffInvolved: boolean }).staffInvolved,
    ).toBe(true);

    const studentComplaint = await ledger.getComplaint({
      viewerRole: 'student',
      universityId: 'uni-1',
      complaintId: 'c-uni1-normal',
    });
    expect(studentComplaint.complaint.id).toBe('c-uni1-normal');
    expect(Object.keys(studentComplaint.complaint)).not.toContain(
      'payloadLocator',
    );

    await expect(
      ledger.getComplaint({
        viewerRole: 'student',
        universityId: 'uni-1',
        complaintId: 'c-uni2-normal',
      }),
    ).rejects.toThrow('viewer cannot access this complaint');

    const universityComplaint = await ledger.getComplaint({
      viewerRole: 'university',
      universityId: 'uni-1',
      complaintId: 'c-uni1-staff',
    });
    expect(universityComplaint.complaint).toEqual({
      id: 'c-uni1-staff',
      createdAt: '2026-02-02T00:00:00.000Z',
      category: 'sexual',
      supportCount: 2,
      status: 'pending_investigation',
    });

    await expect(
      ledger.getComplaint({
        viewerRole: 'university',
        universityId: 'uni-2',
        complaintId: 'c-uni1-normal',
      }),
    ).rejects.toThrow('viewer cannot access this complaint');

    const ugcComplaint = await ledger.getComplaint({
      viewerRole: 'ugc',
      complaintId: 'c-uni1-staff',
    });
    expect(ugcComplaint.complaint.id).toBe('c-uni1-staff');
    expect(
      (ugcComplaint.complaint as { staffInvolved: boolean }).staffInvolved,
    ).toBe(true);

    const studentHistory = await ledger.getHistory({
      viewerRole: 'student',
      universityId: 'uni-1',
      complaintId: 'c-uni1-normal',
    });
    expect(studentHistory.entries).toEqual([
      {
        complaintId: 'c-uni1-normal',
        status: 'not_started',
        at: '2026-02-01T00:00:00.000Z',
        actorRole: 'student',
        noteHash: null,
      },
      {
        complaintId: 'c-uni1-normal',
        status: 'pending_investigation',
        at: '2026-02-04T00:00:00.000Z',
        actorRole: 'university',
        noteHash: null,
      },
    ]);

    await expect(
      ledger.getHistory({
        viewerRole: 'student',
        universityId: 'uni-1',
        complaintId: 'c-uni2-normal',
      }),
    ).rejects.toThrow('viewer cannot access this complaint');

    const ugcHistory = await ledger.getHistory({
      viewerRole: 'ugc',
      complaintId: 'c-uni1-normal',
    });
    expect(ugcHistory.entries).toHaveLength(2);

    const studentStats = await ledger.getStats({
      viewerRole: 'student',
      universityId: 'uni-1',
    });
    expect(studentStats).toEqual({
      totalComplaints: null,
      byCategory: {
        verbal: null,
        physical: null,
        sexual: null,
        cyber: null,
        financial: null,
        other: null,
      },
      byUrgency: { normal: null, urgent: null, other: null },
      byStatus: {
        not_started: null,
        pending_investigation: null,
        finished: null,
        other: null,
      },
      overdue: null,
      staffInvolved: null,
    });

    const ugcStats = await ledger.getStats({ viewerRole: 'ugc' });
    expect(ugcStats.totalComplaints).toBe(3);
    expect(ugcStats.byCategory.cyber).toBeNull();
    expect(ugcStats.byStatus.finished).toBeNull();
    expect(ugcStats.overdue).toBe(1);
    expect(ugcStats.staffInvolved).toBe(1);
    expect(ugcStats.byUniversity).toEqual({ 'uni-1': 2, 'uni-2': 1 });

    expect(() =>
      ledger.listComplaints({ viewerRole: 'student' }),
    ).toThrow('universityId is required for this viewer role');

    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('protects stats totals below the minimum group size', async () => {
    for (const count of [1, 4, 5]) {
      const { db, dir } = newDb();
      db.prepare(
        `INSERT INTO universities (id, name, domain, enrollment_ceiling) VALUES (?, ?, ?, ?)`,
      ).run('uni-1', 'Test University', 'test.ac.lk', 10);
      const ledger = new MockLedger(db);

      for (let index = 0; index < count; index += 1) {
        insertStatsComplaint(db, `c-${count}-${index}`, 'uni-1', 'verbal');
      }

      const stats = await ledger.getStats({
        viewerRole: 'student',
        universityId: 'uni-1',
      });
      expect(stats.totalComplaints).toBe(count < 5 ? null : 5);
      expect(stats.byCategory.verbal).toBe(count < 5 ? null : 5);
      expect(stats.byCategory.other).toBeNull();
      expect(stats.byUrgency.normal).toBe(count < 5 ? null : 5);
      expect(stats.byUrgency.other).toBeNull();
      expect(stats.byStatus.not_started).toBe(count < 5 ? null : 5);
      expect(stats.byStatus.other).toBeNull();
      expect(stats.overdue).toBeNull();
      expect(stats.staffInvolved).toBeNull();

      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('merges small breakdown groups and gives UGC exact university totals', async () => {
    const { db, dir } = newDb();
    db.prepare(
      `INSERT INTO universities (id, name, domain, enrollment_ceiling) VALUES (?, ?, ?, ?)`,
    ).run('uni-1', 'Test University', 'test.ac.lk', 10);
    db.prepare(
      `INSERT INTO universities (id, name, domain, enrollment_ceiling) VALUES (?, ?, ?, ?)`,
    ).run('uni-2', 'Other University', 'other.ac.lk', 10);
    const ledger = new MockLedger(db);

    for (let index = 0; index < 4; index += 1) {
      insertStatsComplaint(db, `c-uni1-${index}`, 'uni-1', 'verbal');
    }
    insertStatsComplaint(db, 'c-uni2-0', 'uni-2', 'physical');

    const studentStats = await ledger.getStats({
      viewerRole: 'student',
      universityId: 'uni-1',
    });
    expect(studentStats.totalComplaints).toBeNull();
    expect(studentStats.byCategory.verbal).toBeNull();
    expect(studentStats.byCategory.other).toBeNull();

    const ugcStats = await ledger.getStats({ viewerRole: 'ugc' });
    expect(ugcStats.totalComplaints).toBe(5);
    expect(ugcStats.byUniversity).toEqual({ 'uni-1': 4, 'uni-2': 1 });
    expect(ugcStats.byCategory.verbal).toBeNull();
    expect(ugcStats.byCategory.physical).toBeNull();
    expect(ugcStats.byCategory.other).toBe(5);
    expect(ugcStats.byUrgency.normal).toBe(5);
    expect(ugcStats.byUrgency.other).toBeNull();
    expect(ugcStats.byStatus.not_started).toBe(5);
    expect(ugcStats.byStatus.other).toBeNull();

    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('supportComplaint accepts a valid support, rejects duplicate nullifier, and rejects other university', async () => {
    const yearMonth = new Date().toISOString().slice(0, 7);
    const { db, dir } = newDb();
    db.prepare(
      `INSERT INTO universities (id, name, domain, enrollment_ceiling) VALUES (?, ?, ?, ?)`,
    ).run('uni-1', 'Test University', 'test.ac.lk', 10);
    db.prepare(
      `INSERT INTO universities (id, name, domain, enrollment_ceiling) VALUES (?, ?, ?, ?)`,
    ).run('uni-2', 'Other University', 'other.ac.lk', 10);
    const ledger = new MockLedger(db, {
      publish: (event) => {
        publishedEvents.push(event);
      },
    });

    const publishedEvents: Array<{ type: string; id: string }> = [];

    // Enroll a student at uni-1.
    const secret = randomBytes(32);
    const { hash, DOMAIN_TAG_COMMITMENT } = await import('@usafe/crypto');
    const commitmentBytes = await hash(DOMAIN_TAG_COMMITMENT, secret);
    const commitmentHex = Buffer.from(commitmentBytes).toString('hex');

    await ledger.enrollCommitment({
      universityId: 'uni-1',
      commitment: commitmentHex,
    });

    const leaves = await ledger.getLeaves({ universityId: 'uni-1' });
    const leafIndex = leaves.commitments.indexOf(commitmentHex);

    // File a complaint at uni-1.
    const complaintResult = await ledger.fileComplaint({
      universityId: 'uni-1',
      category: 'verbal',
      urgency: 'normal',
      staffInvolved: false,
      payloadHash: 'hash-' + randomBytes(16).toString('hex'),
      payloadLocator: null,
      proof: await (async () => {
        const p = await proveMembershipMock(
          secret,
          leaves.commitments,
          leafIndex,
          `file|${yearMonth}|0`,
        );
        p.universityId = 'uni-1';
        return p;
      })(),
    });
    const complaintId = complaintResult.id;

    // First support → accepted, count becomes 1.
    const supportProof = await proveMembershipMock(
      secret,
      leaves.commitments,
      leafIndex,
      `support|${complaintId}`,
    );
    supportProof.universityId = 'uni-1';

    const result0 = await ledger.supportComplaint({
      complaintId,
      proof: supportProof,
    });
    expect(result0.supportCount).toBe(1);
    const supportedEvents = publishedEvents.filter(
      (event) => event.type === 'complaint.supported',
    );
    expect(supportedEvents).toHaveLength(1);
    expect(supportedEvents[0]!.id).toBe(complaintId);

    // Same support nullifier again → rejected.
    await expect(
      ledger.supportComplaint({
        complaintId,
        proof: supportProof,
      }),
    ).rejects.toThrow('support nullifier already used');

    // Count stays at 1 after the rejected duplicate.
    const row = db
      .prepare('SELECT support_count FROM ml_complaints WHERE id = ?')
      .get(complaintId) as { support_count: number };
    expect(row.support_count).toBe(1);

    // Enroll a second student at uni-2.
    const secret2 = randomBytes(32);
    const commitmentBytes2 = await hash(DOMAIN_TAG_COMMITMENT, secret2);
    const commitmentHex2 = Buffer.from(commitmentBytes2).toString('hex');

    await ledger.enrollCommitment({
      universityId: 'uni-2',
      commitment: commitmentHex2,
    });

    const leaves2 = await ledger.getLeaves({ universityId: 'uni-2' });
    const leafIndex2 = leaves2.commitments.indexOf(commitmentHex2);

    // Proof from uni-2 student trying to support uni-1's complaint → rejected.
    const otherProof = await proveMembershipMock(
      secret2,
      leaves2.commitments,
      leafIndex2,
      `support|${complaintId}`,
    );
    otherProof.universityId = 'uni-2';

    await expect(
      ledger.supportComplaint({
        complaintId,
        proof: otherProof,
      }),
    ).rejects.toThrow('proof university does not match complaint university');

    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('updateStatus enforces forward-only transitions, outcome requirement, and ownership', async () => {
    const yearMonth = new Date().toISOString().slice(0, 7);
    const { db, dir } = newDb();
    db.prepare(
      `INSERT INTO universities (id, name, domain, enrollment_ceiling) VALUES (?, ?, ?, ?)`,
    ).run('uni-1', 'Test University', 'test.ac.lk', 10);
    const ledger = new MockLedger(db);

    // Enroll a student.
    const secret = randomBytes(32);
    const { hash, DOMAIN_TAG_COMMITMENT } = await import('@usafe/crypto');
    const commitmentBytes = await hash(DOMAIN_TAG_COMMITMENT, secret);
    const commitmentHex = Buffer.from(commitmentBytes).toString('hex');

    await ledger.enrollCommitment({
      universityId: 'uni-1',
      commitment: commitmentHex,
    });

    const leaves = await ledger.getLeaves({ universityId: 'uni-1' });
    const leafIndex = leaves.commitments.indexOf(commitmentHex);

    // File a complaint (university-owned).
    const proof = await proveMembershipMock(
      secret,
      leaves.commitments,
      leafIndex,
      `file|${yearMonth}|0`,
    );
    proof.universityId = 'uni-1';

    const result = await ledger.fileComplaint({
      universityId: 'uni-1',
      category: 'verbal',
      urgency: 'normal',
      staffInvolved: false,
      payloadHash: 'hash-' + randomBytes(16).toString('hex'),
      payloadLocator: null,
      proof,
    });
    const complaintId = result.id;

    // Valid: not_started -> pending_investigation
    const r1 = await ledger.updateStatus({
      complaintId,
      newStatus: 'pending_investigation',
      outcomeHash: null,
      ownerRole: 'university',
    });
    expect(r1.status).toBe('pending_investigation');

    // Skipping a state (pending -> finished is valid, but not_started -> finished was already passed)
    // Test: try to go back to not_started -> rejected
    await expect(
      ledger.updateStatus({
        complaintId,
        newStatus: 'not_started',
        outcomeHash: null,
        ownerRole: 'university',
      }),
    ).rejects.toThrow('status can only move forward');

    // Valid: pending -> finished with outcome
    const r2 = await ledger.updateStatus({
      complaintId,
      newStatus: 'finished',
      outcomeHash: 'outcome-hash-123',
      outcomeLocator: 'outcome-locator-xyz',
      ownerRole: 'university',
    });
    expect(r2.status).toBe('finished');

    // Verify history rows were appended (not_started + pending + finished = 3)
    const history = db
      .prepare(
        `SELECT status, actor_role FROM ml_history WHERE complaint_id = ? ORDER BY at ASC`,
      )
      .all(complaintId) as Array<{ status: string; actor_role: string }>;
    expect(history).toHaveLength(3);
    expect(history[0]!.status).toBe('not_started');
    expect(history[1]!.status).toBe('pending_investigation');
    expect(history[2]!.status).toBe('finished');
    expect(history[2]!.actor_role).toBe('university');

    // Verify outcome_hash stored
    const row = db
      .prepare(`SELECT outcome_hash, outcome_locator FROM ml_complaints WHERE id = ?`)
      .get(complaintId) as {
      outcome_hash: string | null;
      outcome_locator: string | null;
    };
    expect(row.outcome_hash).toBe('outcome-hash-123');
    expect(row.outcome_locator).toBe('outcome-locator-xyz');

    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('updateStatus rejects skipping states and finishing without outcome', async () => {
    const yearMonth = new Date().toISOString().slice(0, 7);
    const { db, dir } = newDb();
    db.prepare(
      `INSERT INTO universities (id, name, domain, enrollment_ceiling) VALUES (?, ?, ?, ?)`,
    ).run('uni-1', 'Test University', 'test.ac.lk', 10);
    const ledger = new MockLedger(db);

    const secret = randomBytes(32);
    const { hash, DOMAIN_TAG_COMMITMENT } = await import('@usafe/crypto');
    const commitmentBytes = await hash(DOMAIN_TAG_COMMITMENT, secret);
    const commitmentHex = Buffer.from(commitmentBytes).toString('hex');

    await ledger.enrollCommitment({
      universityId: 'uni-1',
      commitment: commitmentHex,
    });

    const leaves = await ledger.getLeaves({ universityId: 'uni-1' });
    const leafIndex = leaves.commitments.indexOf(commitmentHex);

    const proof = await proveMembershipMock(
      secret,
      leaves.commitments,
      leafIndex,
      `file|${yearMonth}|0`,
    );
    proof.universityId = 'uni-1';

    const result = await ledger.fileComplaint({
      universityId: 'uni-1',
      category: 'verbal',
      urgency: 'normal',
      staffInvolved: false,
      payloadHash: 'hash-' + randomBytes(16).toString('hex'),
      payloadLocator: null,
      proof,
    });
    const complaintId = result.id;

    // Skipping: not_started -> finished directly -> rejected
    await expect(
      ledger.updateStatus({
        complaintId,
        newStatus: 'finished',
        outcomeHash: 'some-outcome',
        ownerRole: 'university',
      }),
    ).rejects.toThrow('status can only move forward');

    // Moving to pending first
    await ledger.updateStatus({
      complaintId,
      newStatus: 'pending_investigation',
      outcomeHash: null,
      ownerRole: 'university',
    });

    // Finishing without outcome -> rejected
    await expect(
      ledger.updateStatus({
        complaintId,
        newStatus: 'finished',
        outcomeHash: null,
        ownerRole: 'university',
      }),
    ).rejects.toThrow('finished requires a non-empty outcomeHash');

    // Finishing with empty string outcome -> rejected
    await expect(
      ledger.updateStatus({
        complaintId,
        newStatus: 'finished',
        outcomeHash: '',
        ownerRole: 'university',
      }),
    ).rejects.toThrow('finished requires a non-empty outcomeHash');

    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('updateStatus rejects wrong owner role (university cannot touch UGC-owned)', async () => {
    const yearMonth = new Date().toISOString().slice(0, 7);
    const { db, dir } = newDb();
    db.prepare(
      `INSERT INTO universities (id, name, domain, enrollment_ceiling) VALUES (?, ?, ?, ?)`,
    ).run('uni-1', 'Test University', 'test.ac.lk', 10);
    const ledger = new MockLedger(db);

    const secret = randomBytes(32);
    const { hash, DOMAIN_TAG_COMMITMENT } = await import('@usafe/crypto');
    const commitmentBytes = await hash(DOMAIN_TAG_COMMITMENT, secret);
    const commitmentHex = Buffer.from(commitmentBytes).toString('hex');

    await ledger.enrollCommitment({
      universityId: 'uni-1',
      commitment: commitmentHex,
    });

    const leaves = await ledger.getLeaves({ universityId: 'uni-1' });
    const leafIndex = leaves.commitments.indexOf(commitmentHex);

    // File a staff-involved complaint (ownerRole = 'ugc').
    const proof = await proveMembershipMock(
      secret,
      leaves.commitments,
      leafIndex,
      `file|${yearMonth}|0`,
    );
    proof.universityId = 'uni-1';

    const result = await ledger.fileComplaint({
      universityId: 'uni-1',
      category: 'verbal',
      urgency: 'normal',
      staffInvolved: true,
      payloadHash: 'hash-' + randomBytes(16).toString('hex'),
      payloadLocator: null,
      proof,
    });
    const complaintId = result.id;

    // University staff trying to update a UGC-owned complaint -> rejected.
    await expect(
      ledger.updateStatus({
        complaintId,
        newStatus: 'pending_investigation',
        outcomeHash: null,
        ownerRole: 'university',
      }),
    ).rejects.toThrow('insufficient role to update this complaint');

    // UGC staff can update it.
    const r = await ledger.updateStatus({
      complaintId,
      newStatus: 'pending_investigation',
      outcomeHash: null,
      ownerRole: 'ugc',
    });
    expect(r.status).toBe('pending_investigation');

    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('updateStatus rejects non-existent complaint', async () => {
    const { db, dir } = newDb();
    db.prepare(
      `INSERT INTO universities (id, name, domain, enrollment_ceiling) VALUES (?, ?, ?, ?)`,
    ).run('uni-1', 'Test University', 'test.ac.lk', 10);
    const ledger = new MockLedger(db);

    await expect(
      ledger.updateStatus({
        complaintId: 'no-such-complaint',
        newStatus: 'pending_investigation',
        outcomeHash: null,
        ownerRole: 'university',
      }),
    ).rejects.toThrow('complaint not found');

    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('markEscalated escalates overdue complaints, is idempotent, and respects deadlines', async () => {
    const yearMonth = new Date().toISOString().slice(0, 7);
    const { db, dir } = newDb();
    db.prepare(
      `INSERT INTO universities (id, name, domain, enrollment_ceiling) VALUES (?, ?, ?, ?)`,
    ).run('uni-1', 'Test University', 'test.ac.lk', 10);
    const ledger = new MockLedger(db, {
      publish: (event) => {
        publishedEvents.push(event);
      },
    });
    const publishedEvents: Array<{ type: string; id: string }> = [];

    // Enroll a student.
    const secret = randomBytes(32);
    const { hash, DOMAIN_TAG_COMMITMENT } = await import('@usafe/crypto');
    const commitmentBytes = await hash(DOMAIN_TAG_COMMITMENT, secret);
    const commitmentHex = Buffer.from(commitmentBytes).toString('hex');

    await ledger.enrollCommitment({
      universityId: 'uni-1',
      commitment: commitmentHex,
    });

    const leaves = await ledger.getLeaves({ universityId: 'uni-1' });
    const leafIndex = leaves.commitments.indexOf(commitmentHex);

    // File a complaint.
    const proof = await proveMembershipMock(
      secret,
      leaves.commitments,
      leafIndex,
      `file|${yearMonth}|0`,
    );
    proof.universityId = 'uni-1';

    const result = await ledger.fileComplaint({
      universityId: 'uni-1',
      category: 'verbal',
      urgency: 'normal',
      staffInvolved: false,
      payloadHash: 'hash-' + randomBytes(16).toString('hex'),
      payloadLocator: null,
      proof,
    });
    const complaintId = result.id;

    // Before deadline: markEscalated returns false, no change.
    const before = await ledger.markEscalated({ complaintId });
    expect(before.escalated).toBe(false);

    const rowBefore = db
      .prepare(`SELECT escalated FROM ml_complaints WHERE id = ?`)
      .get(complaintId) as { escalated: number };
    expect(rowBefore.escalated).toBe(0);

    // Move the deadline into the past.
    const pastDate = new Date(Date.now() - 1000 * 60 * 60).toISOString();
    db.prepare(`UPDATE ml_complaints SET deadline_at = ? WHERE id = ?`).run(
      pastDate,
      complaintId,
    );

    // After deadline: markEscalated returns true, escalates.
    publishedEvents.length = 0;
    const after = await ledger.markEscalated({ complaintId });
    expect(after.escalated).toBe(true);

    const rowAfter = db
      .prepare(`SELECT escalated FROM ml_complaints WHERE id = ?`)
      .get(complaintId) as { escalated: number };
    expect(rowAfter.escalated).toBe(1);

    // History row appended with actor 'system'.
    const history = db
      .prepare(
        `SELECT actor_role FROM ml_history WHERE complaint_id = ? AND actor_role = 'system'`,
      )
      .all(complaintId) as Array<{ actor_role: string }>;
    expect(history).toHaveLength(1);

    // Event published.
    expect(publishedEvents).toHaveLength(1);
    expect(publishedEvents[0]!.type).toBe('complaint.escalated');
    expect(publishedEvents[0]!.id).toBe(complaintId);

    // Idempotent: calling again returns true, no duplicate history.
    publishedEvents.length = 0;
    const again = await ledger.markEscalated({ complaintId });
    expect(again.escalated).toBe(true);
    const historyAfter = db
      .prepare(
        `SELECT actor_role FROM ml_history WHERE complaint_id = ? AND actor_role = 'system'`,
      )
      .all(complaintId) as Array<{ actor_role: string }>;
    expect(historyAfter).toHaveLength(1);
    expect(publishedEvents).toHaveLength(0);

    // Non-existent complaint throws.
    await expect(
      ledger.markEscalated({ complaintId: 'no-such-complaint' }),
    ).rejects.toThrow('complaint not found');

    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
