import { MockLedger } from '@usafe/chain';
import {
  DOMAIN_TAG_COMMITMENT,
  hash,
  proveMembershipMock,
} from '@usafe/crypto';
import type Database from 'better-sqlite3';
import { createHash, randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ComplaintRecord } from '@usafe/shared';
import { openDatabase } from '../server/src/db/index.js';
import {
  createUniversity,
  getUniversity,
} from '../server/src/services/universities.js';

const STUDENT_COUNT = 5;

export interface DemoFlowOptions {
  noStatus?: boolean;
}

export const runDemoFlow = async (
  db: Database.Database,
  universityId: string,
  options: DemoFlowOptions = {},
): Promise<ComplaintRecord> => {
  const ledger = new MockLedger(db);
  const secrets: Uint8Array[] = [];
  const leafIndexes: number[] = [];

  for (let index = 0; index < STUDENT_COUNT; index += 1) {
    const secret = randomBytes(32);
    const commitmentBytes = await hash(DOMAIN_TAG_COMMITMENT, secret);
    const commitment = Buffer.from(commitmentBytes).toString('hex');
    const receipt = await ledger.enrollCommitment({
      universityId,
      commitment,
    });
    secrets.push(secret);
    leafIndexes.push(receipt.leafIndex);
  }

  const leaves = await ledger.getLeaves({ universityId });
  const yearMonth = new Date().toISOString().slice(0, 7);
  const filingProof = await proveMembershipMock(
    secrets[0]!,
    leaves.commitments,
    leafIndexes[0]!,
    `file|${yearMonth}|0`,
  );
  filingProof.universityId = universityId;

  const payloadHash = createHash('sha256')
    .update('U-Safe demo complaint payload')
    .digest('hex');
  const filed = await ledger.fileComplaint({
    universityId,
    category: 'verbal',
    urgency: 'normal',
    staffInvolved: false,
    payloadHash,
    payloadLocator: null,
    proof: filingProof,
  });

  for (let index = 1; index < STUDENT_COUNT; index += 1) {
    const supportProof = await proveMembershipMock(
      secrets[index]!,
      leaves.commitments,
      leafIndexes[index]!,
      `support|${filed.id}`,
    );
    supportProof.universityId = universityId;
    await ledger.supportComplaint({
      complaintId: filed.id,
      proof: supportProof,
    });
  }

  if (options.noStatus !== true) {
    await ledger.updateStatus({
      complaintId: filed.id,
      newStatus: 'pending_investigation',
      outcomeHash: null,
      ownerRole: 'university',
    });
    const outcomeHash = createHash('sha256')
      .update('U-Safe demo outcome')
      .digest('hex');
    await ledger.updateStatus({
      complaintId: filed.id,
      newStatus: 'finished',
      outcomeHash,
      ownerRole: 'university',
    });
  }

  const final = await ledger.getComplaint({
    viewerRole: 'ugc',
    complaintId: filed.id,
  });
  return final.complaint as ComplaintRecord;
};

const main = async (): Promise<void> => {
  const noStatus = process.argv.includes('--no-status');
  const universityId = process.env.DEMO_UNIVERSITY_ID ?? 'moratuwa';
  const baseDir = process.env.INIT_CWD ?? process.cwd();
  const configuredDatabasePath = process.env.DATABASE_PATH;
  const databasePath =
    configuredDatabasePath === undefined
      ? `${baseDir}/server/data/usafe.db`
      : configuredDatabasePath;
  const migrationsDir = fileURLToPath(
    new URL('../server/migrations', import.meta.url),
  );

  const db = openDatabase(databasePath, migrationsDir);
  try {
    if (getUniversity(db, universityId) === null) {
      createUniversity(db, {
        id: universityId,
        name: 'Demo University',
        domain: 'demo.ac.lk',
        enrollment_ceiling: 1000,
        status: 'active',
      });
    }

    const record = await runDemoFlow(db, universityId, { noStatus });
    console.log(`Enrolled students: ${STUDENT_COUNT}`);
    console.log(`Complaint id: ${record.id}`);
    console.log(`supportCount: ${record.supportCount}`);
    console.log(`status: ${record.status}`);
    console.log('Final record:');
    console.log(JSON.stringify(record, null, 2));
  } finally {
    db.close();
  }
};

if (
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  void main().catch((error: unknown) => {
    console.error((error as Error).message);
    process.exit(1);
  });
}
