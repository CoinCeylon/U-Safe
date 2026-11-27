import { describe, expect, it } from 'vitest';
import { encryptFile, serializeEncryptedChunks } from '@usafe/crypto';
import { base64ToBytes, bytesToHex } from '../lib/sealedEnvelope';
import type { FilingEvidenceInfo } from './filings';
import {
  EvidenceIntegrityError,
  downloadEvidenceFile,
  fetchEvidenceBlob,
} from './evidenceDownload';

const contents = 'evidence file contents for the round trip';
const file = new File([contents], 'note.txt', { type: 'text/plain' });

const makeEvidence = async (): Promise<{
  evidence: FilingEvidenceInfo;
  blob: Uint8Array;
}> => {
  const { chunks, key, totalBytes } = await encryptFile(file);
  const blob = serializeEncryptedChunks(chunks);
  return {
    evidence: {
      hash: bytesToHex(
        new Uint8Array(await crypto.subtle.digest('SHA-256', blob as unknown as BufferSource)),
      ),
      name: file.name,
      type: file.type,
      size: totalBytes,
      fileKey: Buffer.from(key).toString('base64'),
    },
    blob,
  };
};

const makeFetch = (blob: Uint8Array, status = 200): typeof fetch => {
  const body = status === 200 ? new Blob([blob as unknown as BlobPart]) : null;
  return () => Promise.resolve(new Response(body, { status }));
};

describe('evidence re-download (M061)', () => {
  it('fetches, verifies and decrypts the stored evidence file', async () => {
    const { evidence, blob } = await makeEvidence();
    const bytes = await downloadEvidenceFile(evidence, makeFetch(blob));
    expect(new TextDecoder().decode(bytes)).toBe(contents);
  });

  it('rejects a blob whose hash does not match the receipt', async () => {
    const { blob } = await makeEvidence();
    const evidence: FilingEvidenceInfo = {
      hash: '00'.repeat(32),
      name: file.name,
      type: file.type,
      size: contents.length,
      fileKey: Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString(
        'base64',
      ),
    };
    await expect(downloadEvidenceFile(evidence, makeFetch(blob))).rejects.toBeInstanceOf(
      EvidenceIntegrityError,
    );
  });

  it('reports a missing blob with a friendly message', async () => {
    const { evidence, blob } = await makeEvidence();
    await expect(
      downloadEvidenceFile(evidence, makeFetch(blob, 404)),
    ).rejects.toThrow('no longer available');
  });

  it('fails decryption with a wrong per-file key', async () => {
    const { evidence, blob } = await makeEvidence();
    const wrongKey = {
      ...evidence,
      fileKey: Buffer.from(
        crypto.getRandomValues(new Uint8Array(32)),
      ).toString('base64'),
    };
    await expect(
      downloadEvidenceFile(wrongKey, makeFetch(blob)),
    ).rejects.toThrow();
  });

  it('fetchEvidenceBlob surfaces HTTP errors', async () => {
    await expect(fetchEvidenceBlob(makeFetch(new Uint8Array(0), 500), 'aa')).rejects.toThrow(
      'HTTP 500',
    );
  });

  it('base64ToBytes recovers the exact key bytes', async () => {
    const { evidence } = await makeEvidence();
    expect(base64ToBytes(evidence.fileKey)).toHaveLength(32);
  });
});
