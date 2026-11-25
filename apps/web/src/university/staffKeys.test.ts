import { beforeEach, describe, expect, it } from 'vitest';
import {
  MemoryStorage,
  SecureStore,
  exportPrivateKeyJwk,
  exportPublicKeyJwk,
  generateAesKey,
  generateRoleKeyPair,
  importPublicKeyJwk,
  unwrapAesKeyBytes,
  wrapKey,
} from '@usafe/crypto';
import {
  clearLoadedRoleKey,
  generateAndStoreRoleKey,
  getLoadedRoleKey,
  hasStoredBackup,
  parseBackupFile,
  publicKeyFingerprint,
  setLoadedRoleKey,
  unlockBackupBlob,
  unlockStoredBackup,
  type LoadedRoleKey,
} from './staffKeys';

const storage = () => new MemoryStorage();

beforeEach(() => {
  clearLoadedRoleKey();
});

describe('M064 role key setup', () => {
  it('generates, stores and loads a university key pair', async () => {
    const backend = storage();
    const result = await generateAndStoreRoleKey(
      backend,
      'uni-1',
      'correct horse battery staple',
    );

    expect(await hasStoredBackup(backend, 'uni-1')).toBe(true);
    const loaded = getLoadedRoleKey();
    expect(loaded).not.toBeNull();
    expect(loaded?.universityId).toBe('uni-1');
    expect(loaded?.privateKey.usages).toContain('unwrapKey');
    expect(loaded?.publicKeyJwk).toEqual(JSON.parse(result.publicKeyJwk));

    // The loaded pair must actually work: wrap with the public key,
    // unwrap with the loaded private key.
    const publicKey = await importPublicKeyJwk(
      JSON.parse(result.publicKeyJwk) as JsonWebKey,
    );
    const aesKey = await generateAesKey();
    const wrapped = await wrapKey(aesKey, publicKey);
    const raw = await unwrapAesKeyBytes(
      wrapped,
      loaded?.privateKey as CryptoKey,
    );
    expect(raw).toHaveLength(32);
  });

  it('asks for the passphrase after a refresh and rejects wrong ones', async () => {
    const backend = storage();
    await generateAndStoreRoleKey(backend, 'uni-1', 'the real passphrase');
    // A page refresh clears the in-memory key.
    clearLoadedRoleKey();
    expect(getLoadedRoleKey()).toBeNull();

    await expect(
      unlockStoredBackup(backend, 'uni-1', 'wrong passphrase'),
    ).rejects.toThrow(/Wrong passphrase/);

    expect(getLoadedRoleKey()).toBeNull();

    const loaded = await unlockStoredBackup(
      backend,
      'uni-1',
      'the real passphrase',
    );
    expect(loaded.universityId).toBe('uni-1');
    expect(getLoadedRoleKey()?.publicKeyJwk.kty).toBe('RSA');
  });

  it('imports a backup file in the seed:keys format', async () => {
    // Same shape as the `.dev-keys/university-<id>.json` demo backups.
    const pair = await generateRoleKeyPair();
    const backupJson = await SecureStore.exportBackup(
      {
        role: 'university',
        universityId: 'uni-1',
        publicKeyJwk: JSON.stringify(await exportPublicKeyJwk(pair.publicKey)),
        privateKeyJwk: JSON.stringify(
          await exportPrivateKeyJwk(pair.privateKey),
        ),
      },
      'demo',
    );

    const backend = storage();
    const loaded = await unlockBackupBlob(backend, 'uni-1', backupJson, 'demo');
    expect(loaded.publicKeyJwk.kty).toBe('RSA');
    expect(await hasStoredBackup(backend, 'uni-1')).toBe(true);

    // The stored blob unlocks again with the same passphrase.
    clearLoadedRoleKey();
    const again = await unlockStoredBackup(backend, 'uni-1', 'demo');
    expect(again.publicKeyJwk).toEqual(loaded.publicKeyJwk);
  });

  it('rejects a backup without role keys', async () => {
    const backupJson = await SecureStore.exportBackup(
      { somethingElse: 'value' },
      'demo',
    );
    await expect(parseBackupFile(backupJson, 'demo')).rejects.toThrow(
      /does not contain a role key pair/,
    );
  });

  it('rejects a non-RSA backup', async () => {
    const backupJson = await SecureStore.exportBackup(
      {
        publicKeyJwk: JSON.stringify({ kty: 'oct', k: 'aa' }),
        privateKeyJwk: JSON.stringify({ kty: 'oct', k: 'aa' }),
      },
      'demo',
    );
    await expect(
      unlockBackupBlob(storage(), 'uni-1', backupJson, 'demo'),
    ).rejects.toThrow(/RSA/);
  });

  it('fingerprints distinguish different public keys', async () => {
    const a = await generateRoleKeyPair();
    const b = await generateRoleKeyPair();
    const fingerprintA = await publicKeyFingerprint(
      await exportPublicKeyJwk(a.publicKey),
    );
    const fingerprintB = await publicKeyFingerprint(
      await exportPublicKeyJwk(b.publicKey),
    );
    expect(fingerprintA).not.toEqual(fingerprintB);
    expect(fingerprintA).toHaveLength(16);
  });

  it('keeps the loaded key until it is cleared', () => {
    const key: LoadedRoleKey = {
      universityId: 'uni-1',
      publicKeyJwk: { kty: 'RSA', n: 'aa', e: 'AQAB' },
      privateKey: {} as CryptoKey,
    };
    setLoadedRoleKey(key);
    expect(getLoadedRoleKey()).toBe(key);
    clearLoadedRoleKey();
    expect(getLoadedRoleKey()).toBeNull();
  });
});
