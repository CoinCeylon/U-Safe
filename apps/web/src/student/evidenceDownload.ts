// Evidence re-download for the student's own complaints (M061).
//
// The filing receipt stores each per-file AES key (the student's own copy,
// encrypted at rest by SecureStore). Re-downloading fetches the encrypted
// blob by its public hash, verifies the SHA-256 against the receipt, and
// decrypts in the browser. The server only ever sees a read of a blob it
// already stores; no complaint linkage or student identity is attached.
//
// Privacy notes:
// - Blob hashes are already public (they are the evidence identifiers).
// - Decryption happens locally with the receipt's per-file key.

import { decryptFile, parseEncryptedChunks, type EncryptedChunk } from '@usafe/crypto';
import { base64ToBytes, bytesToHex } from '../lib/sealedEnvelope';
import type { FilingEvidenceInfo } from './filings';

export type EvidenceFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

/** Integrity failure: the stored blob does not match the receipt's hash. */
export class EvidenceIntegrityError extends Error {
  constructor() {
    super(
      'The stored evidence does not match the recorded hash. It may have been tampered with.',
    );
    this.name = 'EvidenceIntegrityError';
  }
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    bytes as unknown as BufferSource,
  );
  return bytesToHex(new Uint8Array(digest));
}

/** Fetches the encrypted blob bytes stored under `hash`. */
export async function fetchEvidenceBlob(
  fetchImpl: EvidenceFetch,
  hash: string,
): Promise<Uint8Array> {
  const response = await fetchImpl(
    `/api/blobs/${encodeURIComponent(hash)}`,
  );
  if (!response.ok) {
    throw new Error(
      response.status === 404
        ? 'This evidence file is no longer available on the server.'
        : `Could not load the evidence file (HTTP ${response.status}).`,
    );
  }
  return new Uint8Array(await response.arrayBuffer());
}

/**
 * Downloads, verifies and decrypts one evidence file of the student's own
 * complaint. Verifies the SHA-256 of the encrypted bytes against the receipt
 * before decrypting, and checks the decrypted size.
 */
export async function downloadEvidenceFile(
  evidence: FilingEvidenceInfo,
  fetchImpl: EvidenceFetch,
): Promise<Uint8Array> {
  const encrypted = await fetchEvidenceBlob(fetchImpl, evidence.hash);
  if ((await sha256Hex(encrypted)) !== evidence.hash) {
    throw new EvidenceIntegrityError();
  }
  const chunks: EncryptedChunk[] = parseEncryptedChunks(encrypted);
  const key = base64ToBytes(evidence.fileKey);
  return decryptFile(chunks, key, evidence.size);
}
