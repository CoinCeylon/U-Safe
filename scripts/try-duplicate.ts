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
import '../server/src/env.js';
import { openDatabase } from '../server/src/db/index.js';

export interface TryDuplicateResult {
  complaintId: string;
  firstSupportCount: number;
  duplicateStatusCode: number;
  duplicateError: string;
  finalSupportCount: number;
}

const apiUrl = (baseUrl: string, path: string): string =>
  new URL(path, baseUrl).toString();

export const tryDuplicateSupport = async (
  db: Database.Database,
  baseUrl: string,
  universityId: string,
): Promise<TryDuplicateResult> => {
  const ledger = new MockLedger(db);
  const secret = randomBytes(32);
  const commitmentBytes = await hash(DOMAIN_TAG_COMMITMENT, secret);
  const commitment = Buffer.from(commitmentBytes).toString('hex');
  await ledger.enrollCommitment({ universityId, commitment });

  const leaves = await ledger.getLeaves({ universityId });
  const leafIndex = leaves.commitments.indexOf(commitment);
  if (leafIndex < 0) {
    throw new Error('failed to locate the newly enrolled commitment');
  }

  const yearMonth = new Date().toISOString().slice(0, 7);
  const filingProof = await proveMembershipMock(
    secret,
    leaves.commitments,
    leafIndex,
    `file|${yearMonth}|0`,
  );
  filingProof.universityId = universityId;

  const filedResponse = await fetch(apiUrl(baseUrl, '/api/complaints'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      universityId,
      category: 'verbal',
      urgency: 'normal',
      staffInvolved: false,
      payloadHash: createHash('sha256')
        .update('duplicate support test')
        .digest('hex'),
      payloadLocator: null,
      proof: filingProof,
    }),
  });
  const filedBody = (await filedResponse.json().catch(() => ({}))) as {
    id?: unknown;
    error?: unknown;
  };
  if (!filedResponse.ok || typeof filedBody.id !== 'string') {
    throw new Error(
      `failed to file test complaint: HTTP ${filedResponse.status} ${JSON.stringify(filedBody)}`,
    );
  }
  const complaintId = filedBody.id;

  const supportProof = await proveMembershipMock(
    secret,
    leaves.commitments,
    leafIndex,
    `support|${complaintId}`,
  );
  supportProof.universityId = universityId;
  const supportPayload = JSON.stringify({
    complaintId,
    proof: supportProof,
  });

  const firstResponse = await fetch(
    apiUrl(
      baseUrl,
      `/api/complaints/${encodeURIComponent(complaintId)}/support`,
    ),
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: supportPayload,
    },
  );
  const firstBody = (await firstResponse.json().catch(() => ({}))) as {
    supportCount?: unknown;
    error?: unknown;
  };
  if (!firstResponse.ok || typeof firstBody.supportCount !== 'number') {
    throw new Error(
      `first support failed: HTTP ${firstResponse.status} ${JSON.stringify(firstBody)}`,
    );
  }

  const duplicateResponse = await fetch(
    apiUrl(
      baseUrl,
      `/api/complaints/${encodeURIComponent(complaintId)}/support`,
    ),
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: supportPayload,
    },
  );
  const duplicateBody = (await duplicateResponse.json().catch(() => ({}))) as {
    error?: unknown;
  };
  if (duplicateResponse.status !== 400) {
    throw new Error(
      `duplicate support was not rejected: HTTP ${duplicateResponse.status} ${JSON.stringify(duplicateBody)}`,
    );
  }
  if (duplicateBody.error !== 'support nullifier already used') {
    throw new Error(
      `unexpected duplicate rejection body: ${JSON.stringify(duplicateBody)}`,
    );
  }

  const detailResponse = await fetch(
    apiUrl(
      baseUrl,
      `/api/complaints/${encodeURIComponent(complaintId)}?university=${encodeURIComponent(universityId)}`,
    ),
  );
  const detailBody = (await detailResponse.json().catch(() => ({}))) as {
    complaint?: { supportCount?: unknown };
  };
  if (
    !detailResponse.ok ||
    typeof detailBody.complaint?.supportCount !== 'number'
  ) {
    throw new Error(
      `failed to read final complaint: HTTP ${detailResponse.status} ${JSON.stringify(detailBody)}`,
    );
  }

  return {
    complaintId,
    firstSupportCount: firstBody.supportCount,
    duplicateStatusCode: duplicateResponse.status,
    duplicateError: String(duplicateBody.error),
    finalSupportCount: detailBody.complaint.supportCount,
  };
};

const main = async (): Promise<void> => {
  const baseUrl = process.env.BASE_URL ?? 'http://127.0.0.1:3000';
  const universityId = process.env.DEMO_UNIVERSITY_ID ?? 'moratuwa';
  const baseDir = process.env.INIT_CWD ?? process.cwd();
  const configuredDatabasePath =
    process.env.DATABASE_PATH ?? process.env.DB_PATH;
  const databasePath =
    configuredDatabasePath === undefined
      ? resolve(baseDir, 'server/data/usafe.db')
      : resolve(baseDir, configuredDatabasePath);
  const migrationsDir = fileURLToPath(
    new URL('../server/migrations', import.meta.url),
  );

  const db = openDatabase(databasePath, migrationsDir);
  try {
    const result = await tryDuplicateSupport(db, baseUrl, universityId);
    console.log(
      `First support accepted: supportCount ${result.firstSupportCount}`,
    );
    console.log(
      `Duplicate support rejected: HTTP ${result.duplicateStatusCode}`,
    );
    console.log(`Final supportCount: ${result.finalSupportCount}`);
    console.log(
      JSON.stringify(
        {
          complaintId: result.complaintId,
          duplicateError: result.duplicateError,
        },
        null,
        2,
      ),
    );
  } finally {
    db.close();
  }
};

if (
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
