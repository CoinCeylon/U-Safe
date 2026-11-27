import { describe, it, expect } from 'vitest';
import { SecureStore, MemoryStorage } from './secureStore';

const encoder = new TextEncoder();

interface StoredEntry {
  value: string;
}

interface BackupData {
  version: number;
  salt: string;
  iv: string;
  ciphertext: string;
}

describe('SecureStore put/get/delete', () => {
  it('round-trips a value', async () => {
    const store = new SecureStore(
      encoder.encode('student-secret-a'),
      new MemoryStorage(),
    );
    await store.put('complaint-1', 'my secret value');
    const got = await store.get('complaint-1');
    expect(got).toBe('my secret value');
  });

  it('values survive a reload on the same storage backend', async () => {
    // A reload discards the SecureStore instance but keeps IndexedDB. Two
    // instances over one backend model that: the new instance must decrypt
    // what the old one wrote.
    const backend = new MemoryStorage();
    const secret = encoder.encode('student-secret-a');
    const beforeReload = new SecureStore(secret, backend);
    await beforeReload.put('enrolment', JSON.stringify({ leafIndex: 3 }));

    const afterReload = new SecureStore(secret, backend);
    expect(await afterReload.get('enrolment')).toBe(
      JSON.stringify({ leafIndex: 3 }),
    );
  });

  it('a different student secret cannot read stored values', async () => {
    const backend = new MemoryStorage();
    const writer = new SecureStore(encoder.encode('secret-a'), backend);
    await writer.put('k', 'v');
    const reader = new SecureStore(encoder.encode('secret-b'), backend);
    await expect(reader.get('k')).rejects.toThrow();
  });

  it('returns null for a missing key', async () => {
    const store = new SecureStore(
      encoder.encode('student-secret-a'),
      new MemoryStorage(),
    );
    expect(await store.get('nonexistent')).toBe(null);
  });

  it('deletes a key', async () => {
    const store = new SecureStore(
      encoder.encode('student-secret-a'),
      new MemoryStorage(),
    );
    await store.put('key-1', 'value-1');
    await store.delete('key-1');
    expect(await store.get('key-1')).toBe(null);
  });

  it('overwrites an existing key', async () => {
    const store = new SecureStore(
      encoder.encode('student-secret-a'),
      new MemoryStorage(),
    );
    await store.put('key-1', 'first');
    await store.put('key-1', 'second');
    expect(await store.get('key-1')).toBe('second');
  });

  it('stores values encrypted (not plaintext) in the backend', async () => {
    const backend = new MemoryStorage();
    const store = new SecureStore(
      encoder.encode('student-secret-a'),
      backend,
    );
    await store.put('key-1', 'sensitive');
    const raw = await backend.getItem('key-1');
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!) as StoredEntry;
    expect(parsed.value).not.toBe('sensitive');
    // The stored value should not contain the plaintext.
    expect(raw).not.toContain('sensitive');
  });

  it('a different student secret cannot read the value', async () => {
    const backend = new MemoryStorage();
    const storeA = new SecureStore(encoder.encode('secret-a'), backend);
    await storeA.put('key-1', 'only-a-can-read');
    const storeB = new SecureStore(encoder.encode('secret-b'), backend);
    // Should fail to decrypt (different key).
    await expect(storeB.get('key-1')).rejects.toThrow();
  });
});

describe('SecureStore exportBackup / importBackup', () => {
  const keys = {
    'role-key-1': '-----BEGIN PRIVATE KEY-----...',
    'role-key-2': 'another-secret-key',
  };

  it('round-trips export and import', async () => {
    const encrypted = await SecureStore.exportBackup(
      keys,
      'correct-passphrase',
    );
    const imported = await SecureStore.importBackup(
      encrypted,
      'correct-passphrase',
    );
    expect(imported).toEqual(keys);
  });

  it('fails with a wrong passphrase', async () => {
    const encrypted = await SecureStore.exportBackup(
      keys,
      'correct-passphrase',
    );
    await expect(
      SecureStore.importBackup(encrypted, 'wrong-passphrase'),
    ).rejects.toThrow();
  });

  it('fails on tampered ciphertext', async () => {
    const encrypted = await SecureStore.exportBackup(
      keys,
      'correct-passphrase',
    );
    const backup = JSON.parse(encrypted) as BackupData;
    // Flip a byte in the ciphertext.
    const ct = atob(backup.ciphertext).split('');
    const lastIndex = ct.length - 1;
    const lastChar = ct[lastIndex]!;
    ct[lastIndex] = String.fromCharCode(lastChar.charCodeAt(0) ^ 0xff);
    backup.ciphertext = btoa(ct.join(''));
    await expect(
      SecureStore.importBackup(JSON.stringify(backup), 'correct-passphrase'),
    ).rejects.toThrow();
  });

  it('produces different ciphertext for the same keys and passphrase (random salt/IV)', async () => {
    const a = await SecureStore.exportBackup(keys, 'passphrase');
    const b = await SecureStore.exportBackup(keys, 'passphrase');
    expect(a).not.toEqual(b);
    // But both decrypt to the same keys.
    expect(await SecureStore.importBackup(a, 'passphrase')).toEqual(keys);
    expect(await SecureStore.importBackup(b, 'passphrase')).toEqual(keys);
  });

  it('exports valid JSON', async () => {
    const encrypted = await SecureStore.exportBackup(keys, 'passphrase');
    const parsed = JSON.parse(encrypted) as BackupData;
    expect(parsed.version).toBe(1);
    expect(parsed.salt).toBeDefined();
    expect(parsed.iv).toBeDefined();
    expect(parsed.ciphertext).toBeDefined();
  });
});
