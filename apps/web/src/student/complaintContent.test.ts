import { describe, expect, it } from 'vitest';
import { generateCommunityKey } from '@usafe/crypto';
import { buildSealedEnvelope } from '../lib/sealedEnvelope';
import {
  loadComplaintDescription,
  loadOutcomeMessage,
} from './complaintContent';

const fetchReturning = (bytes: Uint8Array | null): typeof fetch => {
  let body: Uint8Array<ArrayBuffer> | null = null;
  if (bytes !== null) {
    const copy = new Uint8Array(bytes.length);
    copy.set(bytes);
    body = copy;
  }
  return () =>
    Promise.resolve(
      new Response(body, { status: bytes === null ? 404 : 200 }),
    );
};

describe('complaint content decryption (M054/M055)', () => {
  it('decrypts a community payload into the description text', async () => {
    const key = generateCommunityKey();
    const sealed = await buildSealedEnvelope(
      { description: 'A student was harassed in the dorm hallway.' },
      key,
      { kind: 'community' },
    );

    const result = await loadComplaintDescription({
      payloadHash: sealed.blobHash,
      ownerRole: 'university',
      communityKey: key,
      fetchImpl: fetchReturning(sealed.bytes),
    });
    expect(result).toEqual({
      kind: 'text',
      text: 'A student was harassed in the dorm hallway.',
    });
  });

  it('keeps staff-involved (ugc-only) payloads restricted', async () => {
    const key = generateCommunityKey();
    const sealed = await buildSealedEnvelope(
      { description: 'should never be visible to students' },
      key,
      { kind: 'ugc-only', sealedKeyWrapped: new Uint8Array([1, 2, 3]) },
    );

    const result = await loadComplaintDescription({
      payloadHash: sealed.blobHash,
      ownerRole: 'ugc',
      communityKey: key,
      fetchImpl: fetchReturning(sealed.bytes),
    });
    expect(result).toEqual({ kind: 'restricted' });
  });

  it('reports unavailable when the community key is missing', async () => {
    const key = generateCommunityKey();
    const sealed = await buildSealedEnvelope({ description: 'text' }, key, {
      kind: 'community',
    });

    const result = await loadComplaintDescription({
      payloadHash: sealed.blobHash,
      ownerRole: 'university',
      communityKey: null,
      fetchImpl: fetchReturning(sealed.bytes),
    });
    expect(result).toEqual({ kind: 'unavailable' });
  });

  it('reports unavailable for a missing blob or a tampered payload', async () => {
    const key = generateCommunityKey();
    const missing = await loadComplaintDescription({
      payloadHash: 'ab'.repeat(32),
      ownerRole: 'university',
      communityKey: key,
      fetchImpl: fetchReturning(null),
    });
    expect(missing).toEqual({ kind: 'unavailable' });

    const sealed = await buildSealedEnvelope({ description: 'tamper me' }, key, {
      kind: 'community',
    });
    const tampered = new Uint8Array(
      await new Response(sealed.bytes as unknown as BodyInit).arrayBuffer(),
    );
    tampered[tampered.length - 3]! ^= 0xff;
    const bad = await loadComplaintDescription({
      payloadHash: sealed.blobHash,
      ownerRole: 'university',
      communityKey: key,
      fetchImpl: fetchReturning(tampered),
    });
    expect(bad).toEqual({ kind: 'unavailable' });
  });

  it('decrypts a finished complaint outcome message', async () => {
    const key = generateCommunityKey();
    const sealed = await buildSealedEnvelope(
      { message: 'The case was investigated and action was taken.' },
      key,
      { kind: 'community' },
    );

    const result = await loadOutcomeMessage(
      sealed.blobHash,
      key,
      fetchReturning(sealed.bytes),
    );
    expect(result).toEqual({
      kind: 'text',
      text: 'The case was investigated and action was taken.',
    });
  });
});
