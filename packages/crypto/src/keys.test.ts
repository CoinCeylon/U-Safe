import { describe, it, expect } from 'vitest';
import {
  generateRoleKeyPair,
  exportJwk,
  exportPublicKeyJwk,
  exportPrivateKeyJwk,
  importPublicKeyJwk,
  importPrivateKeyJwk,
  wrapKey,
  unwrapKey,
  generateAesKey,
} from './keys';

const encoder = new TextEncoder();

describe('generateRoleKeyPair', () => {
  it('generates a usable RSA-OAEP 2048 key pair', async () => {
    const { publicKey, privateKey } = await generateRoleKeyPair();
    expect(publicKey.algorithm.name).toBe('RSA-OAEP');
    expect(privateKey.algorithm.name).toBe('RSA-OAEP');
    expect(publicKey.extractable).toBe(true);
    expect(privateKey.extractable).toBe(true);
    expect(publicKey.usages).toContain('wrapKey');
    expect(privateKey.usages).toContain('unwrapKey');
  });

  it('generates distinct key pairs on each call', async () => {
    const jwkA = await exportJwk((await generateRoleKeyPair()).publicKey);
    const jwkB = await exportJwk((await generateRoleKeyPair()).publicKey);
    expect(jwkA).not.toEqual(jwkB);
  });
});

describe('JWK export/import round-trip', () => {
  it('public key JWK round-trips', async () => {
    const { publicKey } = await generateRoleKeyPair();
    const jwk = await exportPublicKeyJwk(publicKey);
    expect(jwk.kty).toBe('RSA');
    expect(jwk.alg).toBe('RSA-OAEP-256');
    const imported = await importPublicKeyJwk(jwk);
    const jwkAgain = await exportJwk(imported);
    expect(jwkAgain.n).toBe(jwk.n);
    expect(jwkAgain.e).toBe(jwk.e);
  });

  it('private key JWK round-trips', async () => {
    const { privateKey } = await generateRoleKeyPair();
    const jwk = await exportPrivateKeyJwk(privateKey);
    expect(jwk.kty).toBe('RSA');
    expect(jwk.d).toBeDefined();
    const imported = await importPrivateKeyJwk(jwk);
    const jwkAgain = await exportJwk(imported);
    expect(jwkAgain.d).toBe(jwk.d);
  });
});

describe('wrapKey / unwrapKey', () => {
  it('round-trips an AES key through wrap and unwrap', async () => {
    const { publicKey, privateKey } = await generateRoleKeyPair();
    const aesKey = await generateAesKey();

    const wrapped = await wrapKey(aesKey, publicKey);
    expect(wrapped).toBeInstanceOf(Uint8Array);
    expect(wrapped.length).toBeGreaterThan(0);

    const unwrapped = await unwrapKey(wrapped, privateKey);

    // The unwrapped key must be able to encrypt and decrypt.
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plain = encoder.encode('wrap-me');
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      unwrapped,
      plain,
    );
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      unwrapped,
      encrypted,
    );
    expect(new Uint8Array(decrypted)).toEqual(plain);
  });

  it('unwrapped key can encrypt and decrypt', async () => {
    const { publicKey, privateKey } = await generateRoleKeyPair();
    const aesKey = await generateAesKey();

    const wrapped = await wrapKey(aesKey, publicKey);
    const unwrapped = await unwrapKey(wrapped, privateKey);

    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plain = encoder.encode('wrap-me');
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      unwrapped,
      plain,
    );
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      unwrapped,
      encrypted,
    );
    expect(new Uint8Array(decrypted)).toEqual(plain);
  });

  it('wrong private key fails to unwrap', async () => {
    const { publicKey: publicKeyA } = await generateRoleKeyPair();
    const { privateKey: privateKeyB } = await generateRoleKeyPair();
    const aesKey = await generateAesKey();

    const wrapped = await wrapKey(aesKey, publicKeyA);
    await expect(unwrapKey(wrapped, privateKeyB)).rejects.toThrow();
  });

  it('tampered wrapped key fails to unwrap', async () => {
    const { publicKey, privateKey } = await generateRoleKeyPair();
    const aesKey = await generateAesKey();

    const wrapped = await wrapKey(aesKey, publicKey);
    const tampered = new Uint8Array(wrapped);
    tampered[tampered.length - 1]! ^= 0xff;
    await expect(unwrapKey(tampered, privateKey)).rejects.toThrow();
  });
});

describe('generateAesKey', () => {
  it('generates a 256-bit AES key', async () => {
    const key = await generateAesKey();
    expect(key.algorithm.name).toBe('AES-GCM');
    expect(key.extractable).toBe(true);
    expect(key.usages).toContain('encrypt');
    expect(key.usages).toContain('decrypt');
  });
});
