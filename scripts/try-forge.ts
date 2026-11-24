import { createHash, randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MembershipProof } from '@usafe/shared';

export interface TryForgeResult {
  statusCode: number;
  error: string;
}

const apiUrl = (baseUrl: string, path: string): string =>
  new URL(path, baseUrl).toString();

export const tryForgedProof = async (
  baseUrl: string,
  universityId: string,
): Promise<TryForgeResult> => {
  const yearMonth = new Date().toISOString().slice(0, 7);
  const proof: MembershipProof = {
    universityId,
    root: '0'.repeat(64),
    nullifier: randomBytes(32).toString('hex'),
    kind: 'mock',
    data: JSON.stringify({
      commitment: 'f'.repeat(64),
      path: [],
      leafIndex: 0,
      context: `file|${yearMonth}|0`,
    }),
  };

  const response = await fetch(apiUrl(baseUrl, '/api/complaints'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      universityId,
      category: 'verbal',
      urgency: 'normal',
      staffInvolved: false,
      payloadHash: createHash('sha256').update('forged proof').digest('hex'),
      payloadLocator: null,
      proof,
    }),
  });

  const body = (await response.json().catch(() => ({}))) as {
    error?: unknown;
  };
  if (response.status !== 401) {
    throw new Error(
      `forged proof was not rejected: HTTP ${response.status} ${JSON.stringify(body)}`,
    );
  }
  if (body.error !== 'invalid enrollment proof') {
    throw new Error(`unexpected rejection body: ${JSON.stringify(body)}`);
  }

  return { statusCode: response.status, error: String(body.error) };
};

const main = async (): Promise<void> => {
  const baseUrl = process.env.BASE_URL ?? 'http://127.0.0.1:3000';
  const universityId = process.env.DEMO_UNIVERSITY_ID ?? 'moratuwa';
  const result = await tryForgedProof(baseUrl, universityId);
  console.log(`Forged proof rejected: HTTP ${result.statusCode}`);
  console.log(JSON.stringify({ error: result.error }, null, 2));
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
