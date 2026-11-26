import { describe, it, expect } from 'vitest';
import {
  generateCommunityKey,
  sealPayload,
  openPayload,
  sealedPayloadBytes,
  type SealedPayload,
} from './payload';

describe('generateCommunityKey', () => {
  it('generates a 32-byte AES-256 key', () => {
    const key = generateCommunityKey();
    expect(key).toHaveLength(32);
  });

  it('generates distinct keys on each call', () => {
    const a = generateCommunityKey();
    const b = generateCommunityKey();
    expect(a).not.toEqual(b);
  });
});

describe('sealPayload / openPayload', () => {
  const payload = {
    description: 'A student was harassed in the dorm hallway.',
    accusedDetails: 'Third-year male student, physics department.',
    evidenceManifest: [
      { blobHash: 'abc123', name: 'photo.jpg', type: 'image/jpeg', size: 2048 },
    ],
  };

  it('seals and opens a payload correctly', async () => {
    const key = generateCommunityKey();
    const sealed = await sealPayload(payload, key);
    expect(sealed).toHaveProperty('iv');
    expect(sealed).toHaveProperty('ciphertext');
    expect(sealed).toHaveProperty('payloadHash');
    expect(sealed.payloadHash).toHaveLength(32);

    const opened = await openPayload(sealed, key);
    expect(opened).toEqual(payload);
  });

  it('fails with a wrong community key', async () => {
    const key = generateCommunityKey();
    const wrongKey = generateCommunityKey();
    const sealed = await sealPayload(payload, key);
    await expect(openPayload(sealed, wrongKey)).rejects.toThrow();
  });

  it('fails when the ciphertext is tampered', async () => {
    const key = generateCommunityKey();
    const sealed = await sealPayload(payload, key);
    const tampered: SealedPayload = {
      iv: new Uint8Array(sealed.iv),
      ciphertext: new Uint8Array(sealed.ciphertext),
      payloadHash: new Uint8Array(sealed.payloadHash),
    };
    tampered.ciphertext[tampered.ciphertext.length - 1]! ^= 0xff;
    await expect(openPayload(tampered, key)).rejects.toThrow();
  });

  it('fails when the payload hash is tampered', async () => {
    const key = generateCommunityKey();
    const sealed = await sealPayload(payload, key);
    const tampered: SealedPayload = {
      iv: new Uint8Array(sealed.iv),
      ciphertext: new Uint8Array(sealed.ciphertext),
      payloadHash: new Uint8Array(sealed.payloadHash),
    };
    tampered.payloadHash[0]! ^= 0xff;
    await expect(openPayload(tampered, key)).rejects.toThrow(
      'payload hash mismatch',
    );
  });

  it('fails when the IV is tampered', async () => {
    const key = generateCommunityKey();
    const sealed = await sealPayload(payload, key);
    const tampered: SealedPayload = {
      iv: new Uint8Array(sealed.iv),
      ciphertext: new Uint8Array(sealed.ciphertext),
      payloadHash: new Uint8Array(sealed.payloadHash),
    };
    tampered.iv[0]! ^= 0x01;
    await expect(openPayload(tampered, key)).rejects.toThrow();
  });

  it('hash matches the exact stored sealed bytes', async () => {
    const key = generateCommunityKey();
    const sealed = await sealPayload(payload, key);
    const storedBytes = sealedPayloadBytes(sealed);
    const hashResult = await crypto.subtle.digest(
      'SHA-256',
      storedBytes as unknown as BufferSource,
    );
    const expectedHash = new Uint8Array(hashResult);
    expect(sealed.payloadHash).toEqual(expectedHash);
    // And it is deliberately not the plaintext hash any more.
    const plaintextHash = new Uint8Array(
      await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(JSON.stringify(payload)),
      ),
    );
    expect(sealed.payloadHash).not.toEqual(plaintextHash);
  });

  it('seals different payloads to different outputs', async () => {
    const key = generateCommunityKey();
    const a = await sealPayload({ description: 'one' }, key);
    const b = await sealPayload({ description: 'two' }, key);
    expect(a.ciphertext).not.toEqual(b.ciphertext);
    expect(a.payloadHash).not.toEqual(b.payloadHash);
  });
});
