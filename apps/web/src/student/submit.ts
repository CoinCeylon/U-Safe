// Submission pipeline (M060).
//
// Files a complaint from the browser through a visible, resumable pipeline:
//   1. prepare  - evidence images were already stripped at attach time (M058).
//   2. encrypt  - every file is AES-256-GCM encrypted with its own key and
//                 framed into one blob (serializeEncryptedChunks).
//   3. upload   - blobs go to POST /api/blobs under their SHA-256.
//   4. keys     - per-file keys are wrapped for the university and UGC
//                 public keys (UGC only for staff-involved complaints).
//   5. seal     - description, accused details and the evidence manifest are
//                 sealed with the community key, or with a fresh UGC-only key
//                 (wrapped for the UGC) when staff are involved.
//   6. payload  - the sealed envelope is uploaded as one blob; its hash is
//                 the payload locator.
//   7. submit   - the filing nullifier is derived per slot (0 then 1), a mock
//                 membership proof is built locally, and the request waits
//                 through submitQueue for a random delay before posting.
//   8. receipt  - a local encrypted receipt is stored (filings.ts) and the
//                 description feeds the duplicate-suggestion cache (M059).
//
// Privacy notes:
// - The student secret never leaves the browser; only the proof does.
// - The leaf index is never sent as a separate field.
// - Every blob is ciphertext; the server never sees plaintext.
// - The community key is fetched with an enrollment proof and kept in memory
//   only, never persisted.
// - A failure at any step throws StepError with the step id, and a retry
//   reuses the cached encrypted blobs and the uploaded hashes so no blob is
//   uploaded twice.

import {
  SubmitQueue,
  commitment,
  encryptFile,
  generateCommunityKey,
  importPublicKeyJwk,
  mockNullifier,
  serializeEncryptedChunks,
  wrapAesKeyBytes,
  type MockProofData,
} from '@usafe/crypto';
import type { MembershipProof } from '@usafe/shared';
import {
  base64ToBytes,
  bytesToBase64,
  bytesToHex,
  buildSealedEnvelope,
  type SealedPayloadBlob,
} from '../lib/sealedEnvelope';
import type { CachedCredential } from './credential';
import { rememberComplaintText } from './complaint-text';
import { saveFilingReceipt, type FilingReceipt } from './filings';

export const SUBMIT_DELAY_MIN_MS = 2_000;
export const SUBMIT_DELAY_MAX_MS = 12_000;

export type SubmitStepId =
  | 'prepare'
  | 'encrypt'
  | 'upload'
  | 'keys'
  | 'seal'
  | 'payload'
  | 'submit'
  | 'receipt';

export interface SubmitStepInfo {
  id: SubmitStepId;
  label: string;
}

export const SUBMIT_STEPS: SubmitStepInfo[] = [
  { id: 'prepare', label: 'Strip image metadata' },
  { id: 'encrypt', label: 'Encrypt evidence files' },
  { id: 'upload', label: 'Upload encrypted evidence' },
  { id: 'keys', label: 'Wrap file keys for the university and UGC' },
  { id: 'seal', label: 'Seal the complaint payload' },
  { id: 'payload', label: 'Upload the sealed payload' },
  { id: 'submit', label: 'Submit the complaint anonymously' },
  { id: 'receipt', label: 'Store your receipt' },
];

export type StepPhase = 'pending' | 'active' | 'done' | 'failed';

export interface StepProgress {
  id: SubmitStepId;
  phase: StepPhase;
  detail: string;
}

/** Thrown when the step that failed is known; `cause` keeps the reason. */
export class StepError extends Error {
  constructor(
    readonly step: SubmitStepId,
    readonly stepCause: unknown,
  ) {
    super(
      stepCause instanceof Error
        ? stepCause.message
        : `step ${step} failed: ${String(stepCause)}`,
    );
    this.name = 'StepError';
    this.cause = stepCause;
  }
}

/** Both monthly filing slots are used up. */
export class FilingLimitError extends Error {
  constructor() {
    super(
      'You have already filed the maximum number of complaints this month. Try again next month.',
    );
    this.name = 'FilingLimitError';
  }
}

export interface SubmissionInput {
  universityId: string;
  description: string;
  category: 'verbal' | 'physical' | 'sexual' | 'cyber' | 'financial' | 'other';
  urgency: 'normal' | 'urgent';
  staffInvolved: boolean;
  accusedPersonDetails?: string;
  evidenceFiles: File[];
}

interface EncryptedEvidence {
  name: string;
  type: string;
  size: number;
  hash: string;
  blob: Uint8Array;
  key: Uint8Array;
}

export interface EvidenceManifestEntry {
  hash: string;
  name: string;
  type: string;
  size: number;
  wrappedKeys: { university?: string; ugc: string };
}

export interface PipelineOptions {
  fetchImpl?: typeof fetch;
  queueDelayMinMs?: number;
  queueDelayMaxMs?: number;
  now?: () => Date;
  saveReceipt?: (receipt: FilingReceipt) => Promise<void>;
}

export interface SubmissionResult {
  complaintId: string;
  receipt: FilingReceipt;
}

/** "YYYY-MM" for the filing nullifier's year-month binding. */
export function formatYearMonth(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * Builds a `file|<yearMonth>|<slot>` membership proof from the locally cached
 * credential, mirroring the support proof of M056. The nullifier is derived
 * from the secret and the slot, so each month allows exactly two filings.
 */
export async function buildFileProof(
  secret: Uint8Array,
  universityId: string,
  yearMonth: string,
  slot: 0 | 1,
  credential: CachedCredential,
): Promise<MembershipProof> {
  const commitmentBytes = await commitment(secret);
  const context = `file|${yearMonth}|${slot}`;
  // Nullifier bound to the public commitment + context (M038); the server can
  // recompute it and the student secret never leaves the browser.
  const nullifier = await mockNullifier(commitmentBytes, context);
  const data: MockProofData = {
    commitment: bytesToHex(commitmentBytes),
    path: credential.proof,
    context,
  };
  return {
    universityId,
    root: credential.root,
    nullifier: bytesToHex(nullifier),
    kind: 'mock',
    data: JSON.stringify(data),
  };
}

/**
 * Membership proof used only to fetch the community key. The server verifies
 * the path and discards the proof; the context tag keeps the mock proof
 * format valid without burning a filing or support nullifier.
 */
export async function buildDeliveryProof(
  secret: Uint8Array,
  universityId: string,
  credential: CachedCredential,
): Promise<MembershipProof> {
  const commitmentBytes = await commitment(secret);
  const context = 'support|community-key-delivery';
  // Bound to a fixed pseudo id so the nullifier is stable but never collides
  // with a real complaint id's support nullifier.
  const nullifier = await mockNullifier(commitmentBytes, context);
  const data: MockProofData = {
    commitment: bytesToHex(commitmentBytes),
    path: credential.proof,
    context,
  };
  return {
    universityId,
    root: credential.root,
    nullifier: bytesToHex(nullifier),
    kind: 'mock',
    data: JSON.stringify(data),
  };
}

// The community key is fetched once per session and kept in memory only.
let cachedCommunityKey: { universityId: string; key: Uint8Array } | null = null;

export function clearCachedCommunityKey(): void {
  cachedCommunityKey = null;
}

export async function getCommunityKey(
  fetchImpl: typeof fetch,
  secret: Uint8Array,
  universityId: string,
  credential: CachedCredential,
): Promise<Uint8Array> {
  if (cachedCommunityKey?.universityId === universityId) {
    return cachedCommunityKey.key;
  }
  const proof = await buildDeliveryProof(secret, universityId, credential);
  const response = await fetchImpl(
    `/api/universities/${encodeURIComponent(universityId)}/community-key`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ proof }),
    },
  );
  if (!response.ok) {
    const body = (await response
      .json()
      .catch(() => null)) as { error?: unknown } | null;
    const detail =
      body !== null && typeof body.error === 'string'
        ? body.error
        : `HTTP ${response.status}`;
    throw new Error(`Could not get the community key: ${detail}`);
  }
  const payload = (await response.json()) as { communityKey?: unknown };
  if (typeof payload.communityKey !== 'string') {
    throw new Error('Server did not return a community key');
  }
  const key = base64ToBytes(payload.communityKey);
  if (key.length !== 32) {
    throw new Error('Community key has the wrong size');
  }
  cachedCommunityKey = { universityId, key };
  return key;
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    bytes as unknown as BufferSource,
  );
  return bytesToHex(new Uint8Array(digest));
}

async function uploadBlob(
  fetchImpl: typeof fetch,
  hash: string,
  bytes: Uint8Array,
): Promise<void> {
  const response = await fetchImpl(
    `/api/blobs?hash=${encodeURIComponent(hash)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      // A Blob body satisfies the DOM BodyInit type for Uint8Array bytes.
      body: new Blob([bytes as unknown as BlobPart]),
    },
  );
  if (!response.ok) {
    throw new Error(`Blob upload failed (HTTP ${response.status})`);
  }
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: unknown };
    return typeof payload.error === 'string' ? payload.error : '';
  } catch {
    return '';
  }
}

interface PostComplaintArgs {
  universityId: string;
  category: SubmissionInput['category'];
  urgency: SubmissionInput['urgency'];
  staffInvolved: boolean;
  payloadHash: string;
  payloadLocator: string;
  proof: MembershipProof;
}

async function postFileComplaint(
  fetchImpl: typeof fetch,
  args: PostComplaintArgs,
): Promise<string> {
  const response = await fetchImpl('/api/complaints', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  if (!response.ok) {
    const message = await readErrorMessage(response);
    throw new Error(message || `Filing failed (HTTP ${response.status})`);
  }
  const payload = (await response.json()) as { id?: unknown };
  if (typeof payload.id !== 'string') {
    throw new Error('Server did not return a complaint id');
  }
  return payload.id;
}

/**
 * The submission pipeline. Construct once per complaint; `run` executes every
 * step and can be called again after a failure (retry) without re-uploading
 * blobs or re-encrypting files.
 */
export class SubmissionPipeline {
  private readonly fetchImpl: typeof fetch;
  private readonly queueDelayMinMs: number;
  private readonly queueDelayMaxMs: number;
  private readonly now: () => Date;
  private readonly saveReceiptImpl: (
    receipt: FilingReceipt,
  ) => Promise<void>;

  private readonly encrypted = new Map<number, EncryptedEvidence>();
  private readonly uploaded = new Set<string>();
  private manifest: EvidenceManifestEntry[] | null = null;
  private payloadBlob: SealedPayloadBlob | null = null;

  constructor(
    private readonly input: SubmissionInput,
    private readonly secret: Uint8Array,
    private readonly getCredential: () => Promise<CachedCredential>,
    options: PipelineOptions = {},
  ) {
    // Bind the fetch function. A native `window.fetch` called as
    // `this.fetchImpl(...)` has the pipeline object as `this` and throws
    // "Illegal invocation" in browsers (Node's fetch is more forgiving).
    this.fetchImpl = (options.fetchImpl ?? fetch).bind(globalThis);
    this.queueDelayMinMs = options.queueDelayMinMs ?? SUBMIT_DELAY_MIN_MS;
    this.queueDelayMaxMs = options.queueDelayMaxMs ?? SUBMIT_DELAY_MAX_MS;
    this.now = options.now ?? (() => new Date());
    this.saveReceiptImpl =
      options.saveReceipt ?? ((receipt) => saveFilingReceipt(receipt));
  }

  async run(
    onProgress: (progress: StepProgress) => void,
  ): Promise<SubmissionResult> {
    const credential = await this.getCredential();

    const step = async <T>(
      id: SubmitStepId,
      action: (report: (detail: string) => void) => Promise<T>,
    ): Promise<T> => {
      onProgress({ id, phase: 'active', detail: '' });
      try {
        const result = await action((detail) =>
          onProgress({ id, phase: 'active', detail }),
        );
        return result;
      } catch (error) {
        // The monthly limit is a friendly outcome, not a failed step.
        if (error instanceof FilingLimitError) {
          throw error;
        }
        throw new StepError(id, error);
      }
    };

    // 1. Images were stripped when they were attached to the form (M058).
    await step('prepare', (report) => {
      report(
        this.input.evidenceFiles.length === 0
          ? 'No evidence attached'
          : `${this.input.evidenceFiles.length} file(s) ready`,
      );
      return Promise.resolve();
    });

    // 2. Encrypt each file once; retries reuse the cached ciphertext.
    await step('encrypt', async (report) => {
      for (const [index, file] of this.input.evidenceFiles.entries()) {
        if (this.encrypted.has(index)) {
          continue;
        }
        const { chunks, key, totalBytes } = await encryptFile(file);
        const blob = serializeEncryptedChunks(chunks);
        const hash = await sha256Hex(blob);
        this.encrypted.set(index, {
          name: file.name,
          type: file.type === '' ? 'application/octet-stream' : file.type,
          size: totalBytes,
          hash,
          blob,
          key,
        });
        report(`${index + 1} of ${this.input.evidenceFiles.length} encrypted`);
      }
    });

    // 3. Upload each blob once; the uploaded set survives retries.
    await step('upload', async (report) => {
      for (const evidence of this.encrypted.values()) {
        if (this.uploaded.has(evidence.hash)) {
          continue;
        }
        await uploadBlob(this.fetchImpl, evidence.hash, evidence.blob);
        this.uploaded.add(evidence.hash);
        report(`${evidence.name} uploaded`);
      }
    });

    // 4. Wrap the per-file keys. Staff-involved evidence is wrapped for the
    //    UGC only, because the university must not be able to read it.
    if (this.manifest === null) {
      await step('keys', async () => {
        const university = await this.fetchUniversity();
        const ugcJwk = await this.fetchUgcJwk();
        const ugcPublicKey = await importPublicKeyJwk(ugcJwk);
        const universityPublicKey =
          this.input.staffInvolved || university.publicKeyJwk === null
            ? null
            : await importPublicKeyJwk(university.publicKeyJwk);

        this.manifest = [];
        for (const evidence of this.encrypted.values()) {
          const wrappedKeys: EvidenceManifestEntry['wrappedKeys'] = {
            ugc: bytesToBase64(await wrapAesKeyBytes(evidence.key, ugcPublicKey)),
          };
          if (universityPublicKey !== null) {
            wrappedKeys.university = bytesToBase64(
              await wrapAesKeyBytes(evidence.key, universityPublicKey),
            );
          }
          this.manifest.push({
            hash: evidence.hash,
            name: evidence.name,
            type: evidence.type,
            size: evidence.size,
            wrappedKeys,
          });
        }
      });
    }

    // 5. Seal the payload once; retries reuse the sealed envelope.
    if (this.payloadBlob === null) {
      await step('seal', async () => {
        const payload: {
          description: string;
          accusedPersonDetails?: string;
          evidence: EvidenceManifestEntry[];
        } = {
          description: this.input.description,
          evidence: this.manifest ?? [],
        };
        if (this.input.accusedPersonDetails !== undefined) {
          payload.accusedPersonDetails = this.input.accusedPersonDetails;
        }

        if (this.input.staffInvolved) {
          // Fresh per-complaint key, wrapped for the UGC public key.
          const ugcOnlyKey = generateCommunityKey();
          const ugcJwk = await this.fetchUgcJwk();
          const ugcPublicKey = await importPublicKeyJwk(ugcJwk);
          const wrapped = await wrapAesKeyBytes(ugcOnlyKey, ugcPublicKey);
          this.payloadBlob = await buildSealedEnvelope(payload, ugcOnlyKey, {
            kind: 'ugc-only',
            sealedKeyWrapped: wrapped,
          });
        } else {
          const communityKey = await getCommunityKey(
            this.fetchImpl,
            this.secret,
            this.input.universityId,
            credential,
          );
          this.payloadBlob = await buildSealedEnvelope(payload, communityKey, {
            kind: 'community',
          });
        }
      });
    }

    // 6. Upload the sealed payload once.
    const payloadBlob = this.payloadBlob;
    if (payloadBlob === null) {
      throw new StepError('seal', new Error('sealed payload is missing'));
    }
    await step('payload', async () => {
      if (!this.uploaded.has(payloadBlob.blobHash)) {
        await uploadBlob(this.fetchImpl, payloadBlob.blobHash, payloadBlob.bytes);
        this.uploaded.add(payloadBlob.blobHash);
      }
    });

    // 7. Derive the filing nullifier (slot 0, then slot 1) and submit through
    //    the anonymity queue.
    const complaintId = await step('submit', async () => {
      const yearMonth = formatYearMonth(this.now());
      const slots: Array<0 | 1> = [0, 1];
      for (const slot of slots) {
        const proof = await buildFileProof(
          this.secret,
          this.input.universityId,
          yearMonth,
          slot,
          credential,
        );
        const args: PostComplaintArgs = {
          universityId: this.input.universityId,
          category: this.input.category,
          urgency: this.input.urgency,
          staffInvolved: this.input.staffInvolved,
          payloadHash: payloadBlob.blobHash,
          payloadLocator: payloadBlob.blobHash,
          proof,
        };
        const queue = new SubmitQueue(
          this.queueDelayMinMs,
          this.queueDelayMaxMs,
          async () => await postFileComplaint(this.fetchImpl, args),
        );
        try {
          return (await queue.submit()) as string;
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          if (!message.includes('filing nullifier already used')) {
            throw error;
          }
          // This monthly slot is already used; try the other one.
        }
      }
      throw new FilingLimitError();
    });

    // 8. Store the encrypted receipt locally and feed the duplicate cache.
    //    The receipt carries each per-file key (the student's own copy);
    //    SecureStore encrypts the whole receipt with the student secret.
    const receipt: FilingReceipt = {
      complaintId,
      universityId: this.input.universityId,
      category: this.input.category,
      urgency: this.input.urgency,
      staffInvolved: this.input.staffInvolved,
      payloadHash: payloadBlob.blobHash,
      payloadLocator: payloadBlob.blobHash,
      filedAt: this.now().toISOString(),
      description: this.input.description,
      evidence: [...this.encrypted.values()].map((entry) => ({
        hash: entry.hash,
        name: entry.name,
        type: entry.type,
        size: entry.size,
        fileKey: bytesToBase64(entry.key),
      })),
    };
    await step('receipt', async () => {
      await this.saveReceiptImpl(receipt);
      if (!this.input.staffInvolved) {
        // Staff-involved text is restricted to the UGC and must never be
        // cached for duplicate suggestions (complaint-text.ts rules).
        rememberComplaintText(
          this.input.universityId,
          complaintId,
          this.input.description,
        );
      }
    });

    return { complaintId, receipt };
  }

  private async fetchUniversity(): Promise<{
    publicKeyJwk: JsonWebKey | null;
  }> {
    const response = await this.fetchImpl(
      `/api/universities/${encodeURIComponent(this.input.universityId)}`,
    );
    if (!response.ok) {
      throw new Error('Could not load the university record');
    }
    const payload = (await response.json()) as {
      public_key_jwk?: string | null;
    };
    return {
      publicKeyJwk:
        typeof payload.public_key_jwk === 'string'
          ? (JSON.parse(payload.public_key_jwk) as JsonWebKey)
          : null,
    };
  }

  private async fetchUgcJwk(): Promise<JsonWebKey> {
    const response = await this.fetchImpl('/api/ugc/public-key');
    if (!response.ok) {
      throw new Error('Could not load the UGC public key');
    }
    const payload = (await response.json()) as { publicKeyJwk?: unknown };
    if (
      typeof payload.publicKeyJwk !== 'object' ||
      payload.publicKeyJwk === null
    ) {
      throw new Error('Server did not return a UGC public key');
    }
    return payload.publicKeyJwk;
  }
}
