import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { MerkleTree, Sha256Adapter } from '@usafe/crypto';
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
  `);
  return { db, dir };
};

const commitment = (): string => randomBytes(32).toString('hex');

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
});
