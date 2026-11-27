import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  commitment,
  decryptFile,
  exportPrivateKeyJwk,
  exportPublicKeyJwk,
  generateRoleKeyPair,
  importPrivateKeyJwk,
  mockNullifier,
  parseEncryptedChunks,
  unwrapAesKeyBytes,
  type EncryptedChunk,
} from '@usafe/crypto';
import {
  base64ToBytes,
  bytesToHex,
  openSealedEnvelope,
  parseSealedEnvelope,
} from '../lib/sealedEnvelope';
import type { CachedCredential } from './credential';
import type { FilingReceipt } from './filings';
import {
  FilingLimitError,
  StepError,
  SubmissionPipeline,
  buildDeliveryProof,
  buildFileProof,
  clearCachedCommunityKey,
  formatYearMonth,
  type SubmissionInput,
} from './submit';

const UNIVERSITY_ID = 'u1';
const FIXED_NOW = new Date(2026, 10, 25, 12, 0, 0); // November 2026
const YEAR_MONTH = formatYearMonth(FIXED_NOW);

const secret = crypto.getRandomValues(new Uint8Array(32));
const communityKey = crypto.getRandomValues(new Uint8Array(32));
const encodedCommunityKey = Buffer.from(communityKey).toString('base64');

const credential: CachedCredential = {
  universityId: UNIVERSITY_ID,
  leafIndex: 3,
  proof: ['ab'.repeat(32)],
  root: 'cd'.repeat(32),
};

interface RoleKeys {
  publicKeyJwk: JsonWebKey;
  privateKey: CryptoKey;
}

let universityKeys: RoleKeys;
let ugcKeys: RoleKeys;

beforeEach(async () => {
  clearCachedCommunityKey();
  const universityPair = await generateRoleKeyPair();
  universityKeys = {
    publicKeyJwk: await exportPublicKeyJwk(universityPair.publicKey),
    privateKey: universityPair.privateKey,
  };
  const ugcPair = await generateRoleKeyPair();
  ugcKeys = {
    publicKeyJwk: await exportPublicKeyJwk(ugcPair.publicKey),
    privateKey: ugcPair.privateKey,
  };
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

interface BlobCall {
  hash: string;
  bytes: Uint8Array;
}

interface ComplaintCall {
  payloadHash: string;
  payloadLocator: string;
  proofContext: string;
  proofNullifier: string;
  staffInvolved: boolean;
}

interface FakeServer {
  fetchImpl: typeof fetch;
  blobCalls: BlobCall[];
  complaintCalls: ComplaintCall[];
  communityKeyCalls: number;
  complaintResponses: Array<{ status: number; error: string }>;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    bytes as unknown as BufferSource,
  );
  return bytesToHex(new Uint8Array(digest));
}

const makeFakeServer = (): FakeServer => {
  const server: FakeServer = {
    fetchImpl: undefined as unknown as typeof fetch,
    blobCalls: [],
    complaintCalls: [],
    communityKeyCalls: 0,
    complaintResponses: [{ status: 200, error: '' }],
  };

  // The pipeline always calls fetch with a string URL; JSON bodies are
  // always strings. The guards below keep the fake honest about that.
  const urlOf = (input: string | URL | Request): string =>
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
  const bodyText = (body: BodyInit | null | undefined): string =>
    typeof body === 'string' ? body : '';

  server.fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = urlOf(input);

    if (url === `/api/universities/${UNIVERSITY_ID}` && init === undefined) {
      return new Response(
        JSON.stringify({
          id: UNIVERSITY_ID,
          public_key_jwk: JSON.stringify(universityKeys.publicKeyJwk),
        }),
        { status: 200 },
      );
    }

    if (url === '/api/ugc/public-key' && init === undefined) {
      return new Response(
        JSON.stringify({ publicKeyJwk: ugcKeys.publicKeyJwk }),
        { status: 200 },
      );
    }

    if (url === `/api/universities/${UNIVERSITY_ID}/community-key`) {
      server.communityKeyCalls += 1;
      const proof = (JSON.parse(bodyText(init?.body)) as { proof?: unknown })
        .proof;
      if (typeof proof !== 'object' || proof === null) {
        return new Response(JSON.stringify({ error: 'missing proof' }), {
          status: 401,
        });
      }
      return new Response(
        JSON.stringify({ communityKey: encodedCommunityKey }),
        { status: 200 },
      );
    }

    if (url.startsWith('/api/blobs')) {
      const hash = new URL(url, 'https://usafe.local').searchParams.get('hash');
      const bytes = new Uint8Array(
        await new Response(init?.body).arrayBuffer(),
      );
      if (hash === null || (await sha256Hex(bytes)) !== hash) {
        return new Response(JSON.stringify({ error: 'hash mismatch' }), {
          status: 400,
        });
      }
      server.blobCalls.push({ hash, bytes });
      return new Response(
        JSON.stringify({ hash, size: bytes.length }),
        { status: 200 },
      );
    }

    if (url === '/api/complaints') {
      const body = JSON.parse(bodyText(init?.body)) as {
        payloadHash: string;
        payloadLocator: string;
        staffInvolved: boolean;
        proof: { data: string; nullifier: string };
      };
      const data = JSON.parse(body.proof.data) as { context: string };
      server.complaintCalls.push({
        payloadHash: body.payloadHash,
        payloadLocator: body.payloadLocator,
        proofContext: data.context,
        proofNullifier: body.proof.nullifier,
        staffInvolved: body.staffInvolved,
      });
      const next =
        server.complaintResponses[server.complaintCalls.length - 1] ??
        { status: 200, error: '' };
      if (next.status !== 200) {
        return new Response(JSON.stringify({ error: next.error }), {
          status: next.status,
        });
      }
      return new Response(
        JSON.stringify({ id: `c-${server.complaintCalls.length}` }),
        { status: 200 },
      );
    }

    return new Response(JSON.stringify({ error: 'not found' }), { status: 404 });
  });

  return server;
};

const baseInput = (): SubmissionInput => ({
  universityId: UNIVERSITY_ID,
  description:
    'A group of senior students keeps shouting insults at first years near the hostel every evening.',
  category: 'verbal',
  urgency: 'normal',
  staffInvolved: false,
  evidenceFiles: [],
});

const makePipeline = (
  server: FakeServer,
  input: SubmissionInput,
  receipts: FilingReceipt[],
): SubmissionPipeline =>
  new SubmissionPipeline(input, secret, () => Promise.resolve(credential), {
    fetchImpl: server.fetchImpl,
    queueDelayMinMs: 0,
    queueDelayMaxMs: 0,
    now: () => FIXED_NOW,
    saveReceipt: (receipt) => {
      receipts.push(receipt);
      return Promise.resolve();
    },
  });

const makeFile = (contents: string, name: string, type: string): File =>
  new File([contents], name, { type });

describe('filing proof helpers', () => {
  it('formats the year-month with a zero-padded month', () => {
    expect(formatYearMonth(new Date(Date.UTC(2026, 0, 5)))).toBe('2026-01');
    expect(formatYearMonth(new Date(Date.UTC(2026, 10, 25)))).toBe('2026-11');
  });

  it('binds the filing proof nullifier to the slot', async () => {
    const proof = await buildFileProof(
      secret,
      UNIVERSITY_ID,
      YEAR_MONTH,
      0,
      credential,
    );
    const ownCommitment = await commitment(secret);
    const expected = await mockNullifier(
      ownCommitment,
      `file|${YEAR_MONTH}|0`,
    );
    expect(proof.nullifier).toBe(bytesToHex(expected));
    expect(proof.universityId).toBe(UNIVERSITY_ID);
    const data = JSON.parse(proof.data) as {
      context: string;
      leafIndex?: number;
    };
    expect(data.context).toBe(`file|${YEAR_MONTH}|0`);
    expect(data.leafIndex).toBeUndefined();
  });

  it('derives the delivery proof nullifier without touching filing slots', async () => {
    const proof = await buildDeliveryProof(secret, UNIVERSITY_ID, credential);
    const ownCommitment = await commitment(secret);
    const expected = await mockNullifier(
      ownCommitment,
      'support|community-key-delivery',
    );
    expect(proof.nullifier).toBe(bytesToHex(expected));
  });
});

describe('SubmissionPipeline (M060)', () => {
  beforeEach(() => {
    // The receipt step feeds the duplicate-suggestion cache (M059), which
    // uses localStorage; Node does not provide it, so a stub stands in.
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
      removeItem: (key: string) => void values.delete(key),
    });
  });

  it('does not call fetch with the pipeline object as this', async () => {
    const server = makeFakeServer();
    const receipts: FilingReceipt[] = [];
    // Browsers throw "Illegal invocation" when window.fetch is called with an
    // arbitrary object as `this`; Node's fetch is forgiving, so this guard
    // reproduces the browser behaviour.
    const strictFetch = function (
      this: unknown,
      input: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> {
      if (this !== undefined && this !== globalThis) {
        return Promise.reject(
          new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation"),
        );
      }
      return server.fetchImpl(input, init);
    } as typeof fetch;

    const pipeline = new SubmissionPipeline(
      baseInput(),
      secret,
      () => Promise.resolve(credential),
      {
        fetchImpl: strictFetch,
        queueDelayMinMs: 0,
        queueDelayMaxMs: 0,
        now: () => FIXED_NOW,
        saveReceipt: (receipt) => {
          receipts.push(receipt);
          return Promise.resolve();
        },
      },
    );

    const result = await pipeline.run(() => {});
    expect(result.complaintId).toBe('c-1');
    expect(server.complaintCalls).toHaveLength(1);
  });

  it('files a complaint with two images and one video end to end', async () => {
    const server = makeFakeServer();
    const receipts: FilingReceipt[] = [];
    const imageBytes = 'not-really-a-jpeg-but-fine-for-the-pipeline';
    const secondImageBytes = 'second-photo-bytes-abcdef';
    const videoBytes = 'fake-mp4-bytes-0123456789';
    const input = baseInput();
    input.evidenceFiles = [
      makeFile(imageBytes, 'photo.png', 'image/png'),
      makeFile(secondImageBytes, 'photo-2.png', 'image/png'),
      makeFile(videoBytes, 'clip.mp4', 'video/mp4'),
    ];

    const pipeline = makePipeline(server, input, receipts);
    const progress: string[] = [];
    const result = await pipeline.run((update) => {
      progress.push(update.id);
    });

    expect(result.complaintId).toBe('c-1');
    expect(receipts).toHaveLength(1);
    expect(receipts[0]?.complaintId).toBe('c-1');
    expect(receipts[0]?.evidence).toHaveLength(3);
    expect(server.communityKeyCalls).toBe(1);

    // Three evidence blobs plus one sealed payload blob, nothing more.
    expect(server.blobCalls).toHaveLength(4);
    const payloadBlob = server.blobCalls[3]!;
    expect(server.complaintCalls).toHaveLength(1);
    const call = server.complaintCalls[0]!;

    // The ledger hash is the SHA-256 of the sealed payload blob, and the
    // locator is that blob's hash.
    expect(call.payloadHash).toBe(await sha256Hex(payloadBlob.bytes));
    expect(call.payloadLocator).toBe(call.payloadHash);
    expect(call.proofContext).toBe(`file|${YEAR_MONTH}|0`);
    const expectedNullifier = await mockNullifier(
      await commitment(secret),
      `file|${YEAR_MONTH}|0`,
    );
    expect(call.proofNullifier).toBe(bytesToHex(expectedNullifier));

    // The envelope opens with the community key and carries the manifest.
    const envelope = parseSealedEnvelope(payloadBlob.bytes);
    expect(envelope.kind).toBe('community');
    expect(envelope.sealedKeyWrapped).toBeUndefined();
    const payload = (await openSealedEnvelope(envelope, communityKey)) as {
      description: string;
      evidence: Array<{
        hash: string;
        name: string;
        type: string;
        size: number;
        wrappedKeys: { university?: string; ugc: string };
      }>;
    };
    expect(payload.description).toBe(input.description);
    expect(payload.evidence).toHaveLength(3);
    expect(payload.evidence.map((entry) => entry.name)).toEqual([
      'photo.png',
      'photo-2.png',
      'clip.mp4',
    ]);

    // The university can unwrap the per-file key and recover the file.
    const photo = payload.evidence[0]!;
    expect(photo.wrappedKeys.university).toBeDefined();
    expect(photo.wrappedKeys.ugc).toBeDefined();
    const fileKey = await unwrapAesKeyBytes(
      base64ToBytes(photo.wrappedKeys.university!),
      universityKeys.privateKey,
    );
    const blobBytes =
      server.blobCalls.find((call) => call.hash === photo.hash)?.bytes;
    expect(blobBytes).toBeDefined();
    const chunks: EncryptedChunk[] = parseEncryptedChunks(blobBytes!);
    const decrypted = await decryptFile(chunks, fileKey, imageBytes.length);
    expect(new TextDecoder().decode(decrypted)).toBe(imageBytes);

    // M061: the receipt carries the per-file key (the student's own copy) so
    // the student can re-download and decrypt their evidence without any
    // role private key.
    const receiptEvidence = receipts[0]?.evidence[0];
    if (receiptEvidence === undefined) {
      throw new Error('receipt evidence missing');
    }
    expect(receiptEvidence.hash).toBe(photo.hash);
    expect(base64ToBytes(receiptEvidence.fileKey)).toHaveLength(32);
    const studentChunks: EncryptedChunk[] = parseEncryptedChunks(blobBytes!);
    const studentBytes = await decryptFile(
      studentChunks,
      base64ToBytes(receiptEvidence.fileKey),
      imageBytes.length,
    );
    expect(new TextDecoder().decode(studentBytes)).toBe(imageBytes);

    // The student's own text feeds the duplicate-suggestion cache.
    expect(localStorage.getItem(`usafe-complaint-text-${UNIVERSITY_ID}`)).toContain(
      input.description,
    );
  });

  it('fails clearly when evidence needs a university key that is not registered', async () => {
    const server = makeFakeServer();
    const fetchImpl = (async (
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      if (url === `/api/universities/${UNIVERSITY_ID}`) {
        return new Response(
          JSON.stringify({ id: UNIVERSITY_ID, public_key_jwk: null }),
          { status: 200 },
        );
      }
      return server.fetchImpl(input, init);
    }) as typeof fetch;

    const input = baseInput();
    input.evidenceFiles = [
      makeFile('photo-bytes-with-metadata', 'photo.png', 'image/png'),
    ];
    const pipeline = new SubmissionPipeline(
      input,
      secret,
      () => Promise.resolve(credential),
      {
        fetchImpl,
        queueDelayMinMs: 0,
        queueDelayMaxMs: 0,
        now: () => FIXED_NOW,
        saveReceipt: () => Promise.resolve(),
      },
    );

    await expect(pipeline.run(() => {})).rejects.toThrow(
      /university has not registered its encryption key/i,
    );
    // The upload may already have happened, but no complaint is filed.
    expect(server.complaintCalls).toHaveLength(0);
  });

  it('falls back to slot 1 when slot 0 was already used this month', async () => {
    const server = makeFakeServer();
    server.complaintResponses = [
      { status: 400, error: 'filing nullifier already used' },
      { status: 200, error: '' },
    ];
    const receipts: FilingReceipt[] = [];
    const pipeline = makePipeline(server, baseInput(), receipts);
    const result = await pipeline.run(() => {});

    expect(result.complaintId).toBe('c-2');
    expect(server.complaintCalls).toHaveLength(2);
    expect(server.complaintCalls[0]?.proofContext).toBe(
      `file|${YEAR_MONTH}|0`,
    );
    expect(server.complaintCalls[1]?.proofContext).toBe(
      `file|${YEAR_MONTH}|1`,
    );
    // No blobs were re-uploaded for the second attempt.
    expect(server.blobCalls).toHaveLength(1);
  });

  it('reports the monthly limit when both slots are used', async () => {
    const server = makeFakeServer();
    server.complaintResponses = [
      { status: 400, error: 'filing nullifier already used' },
      { status: 400, error: 'filing nullifier already used' },
    ];
    const pipeline = makePipeline(server, baseInput(), []);
    await expect(pipeline.run(() => {})).rejects.toBeInstanceOf(FilingLimitError);
  });

  it('retries from the failed step without duplicating blobs', async () => {
    const server = makeFakeServer();
    const receipts: FilingReceipt[] = [];
    const input = baseInput();
    input.evidenceFiles = [
      makeFile('first-file-bytes', 'a.txt', 'text/plain'),
      makeFile('second-file-bytes', 'b.txt', 'text/plain'),
    ];

    const realFetch = server.fetchImpl;
    let uploads = 0;
    server.fetchImpl = (async (inputArg: RequestInfo | URL, init?: RequestInit) => {
      // The pipeline only ever passes string URLs.
      const url = typeof inputArg === 'string' ? inputArg : '';
      if (url.startsWith('/api/blobs')) {
        uploads += 1;
        if (uploads === 2) {
          return new Response(JSON.stringify({ error: 'boom' }), { status: 500 });
        }
      }
      return realFetch(inputArg, init);
    });

    const pipeline = makePipeline(server, input, receipts);
    // First run: the second evidence upload fails.
    let failed: unknown;
    try {
      await pipeline.run(() => {});
    } catch (error) {
      failed = error;
    }
    expect(failed).toBeInstanceOf(StepError);
    expect((failed as StepError).step).toBe('upload');
    expect(server.blobCalls).toHaveLength(1); // first evidence only

    // Retry with the working server: the remaining evidence and the payload
    // are uploaded, the first blob is never sent again.
    server.fetchImpl = realFetch;
    const result = await pipeline.run(() => {});

    expect(result.complaintId).toBe('c-1');
    expect(server.blobCalls).toHaveLength(3);
    expect(receipts).toHaveLength(1);
  });

  it('seals staff-involved complaints for the UGC only', async () => {
    const server = makeFakeServer();
    const receipts: FilingReceipt[] = [];
    const input = baseInput();
    input.staffInvolved = true;
    input.accusedPersonDetails = 'A senior lecturer in the chemistry department';
    input.evidenceFiles = [makeFile('evidence-bytes', 'doc.pdf', 'application/pdf')];

    const pipeline = makePipeline(server, input, receipts);
    const result = await pipeline.run(() => {});

    expect(result.complaintId).toBe('c-1');
    // The community key is never requested for staff-involved complaints.
    expect(server.communityKeyCalls).toBe(0);
    const call = server.complaintCalls[0]!;
    expect(call.staffInvolved).toBe(true);

    // The envelope is UGC-only: the UGC private key recovers the payload key.
    const payloadBlob = server.blobCalls[1]!;
    const envelope = parseSealedEnvelope(payloadBlob.bytes);
    expect(envelope.kind).toBe('ugc-only');
    expect(envelope.sealedKeyWrapped).toBeDefined();

    const wrapped = base64ToBytes(envelope.sealedKeyWrapped!);
    const ugcPrivateKey = await importPrivateKeyJwk(
      await exportPrivateKeyJwk(ugcKeys.privateKey),
    );
    const payloadKey = await unwrapAesKeyBytes(wrapped, ugcPrivateKey);
    const payload = (await openSealedEnvelope(envelope, payloadKey)) as {
      description: string;
      accusedPersonDetails: string;
      evidence: Array<{ wrappedKeys: { university?: string; ugc: string } }>;
    };
    expect(payload.accusedPersonDetails).toBe(input.accusedPersonDetails);

    // Evidence keys are wrapped for the UGC only, so the university cannot
    // read staff-involved evidence.
    expect(payload.evidence[0]?.wrappedKeys.university).toBeUndefined();
    expect(payload.evidence[0]?.wrappedKeys.ugc).toBeDefined();

    // Staff-involved text never enters the duplicate-suggestion cache.
    const stored = localStorage.getItem(
      `usafe-complaint-text-${UNIVERSITY_ID}`,
    );
    expect(stored === null || !stored.includes(input.description)).toBe(true);
  });
});
