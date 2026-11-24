// Secure local storage. Stores values in IndexedDB (or an injectable
// key-value backend for environments without IndexedDB), encrypted with an
// AES-256-GCM key derived from the student secret. Values never leave the
// browser in plaintext.
//
// Backup/export uses PBKDF2 + AES-GCM with a user-chosen passphrase, so a
// downloaded JSON backup can only be opened by someone who knows the
// passphrase.

import { hash } from './hash';

export interface StorageBackend {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

// In-memory key-value store used when IndexedDB is unavailable (e.g. Node
// test environment). Implements StorageBackend.
export class MemoryStorage implements StorageBackend {
  private readonly map = new Map<string, string>();

  async getItem(key: string): Promise<string | null> {
    await Promise.resolve();
    return this.map.get(key) ?? null;
  }

  async setItem(key: string, value: string): Promise<void> {
    await Promise.resolve();
    this.map.set(key, value);
  }

  async removeItem(key: string): Promise<void> {
    await Promise.resolve();
    this.map.delete(key);
  }
}

// IndexedDB-backed storage. Prefixes all keys with the store name so one
// database can hold multiple stores.
export class IndexedDbStorage implements StorageBackend {
  private readonly dbName: string;
  private readonly storeName: string;
  private dbPromise: Promise<IDBDatabase> | null = null;

  constructor(dbName: string, storeName: string) {
    this.dbName = dbName;
    this.storeName = storeName;
  }

  private async getDb(): Promise<IDBDatabase> {
    if (this.dbPromise) {
      return this.dbPromise;
    }
    // Open at the database's current version. Requesting version 1 fails with
    // VersionError once another SecureStore upgraded the same database.
    this.dbPromise = this.openDb();
    return this.dbPromise;
  }

  private async openDb(version?: number): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const req =
        version === undefined
          ? indexedDB.open(this.dbName)
          : indexedDB.open(this.dbName, version);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName);
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        // The database may already exist at this version with a different
        // store (enrolment and supported ids share one database). Upgrade once
        // so this store is created too.
        if (!db.objectStoreNames.contains(this.storeName)) {
          const nextVersion = db.version + 1;
          db.close();
          this.openDb(nextVersion).then(resolve, reject);
          return;
        }
        resolve(db);
      };
      req.onerror = () => reject(new Error(String(req.error)));
    });
  }

  private async getStore(mode: IDBTransactionMode): Promise<IDBObjectStore> {
    const db = await this.getDb();
    // Return the object store while the transaction is still active. Resolving
    // on `tx.oncomplete` made the store unusable: IndexedDB had already
    // committed the transaction by the time the caller scheduled a request.
    // Request handlers below report failures, and the transaction commits once
    // the scheduled request finishes.
    return db.transaction(this.storeName, mode).objectStore(this.storeName);
  }

  async getItem(key: string): Promise<string | null> {
    const store = await this.getStore('readonly');
    return new Promise((resolve, reject) => {
      const req = store.get(key);
      req.onsuccess = () =>
        resolve((req.result as string | null) ?? null);
      req.onerror = () => reject(new Error(String(req.error)));
    });
  }

  async setItem(key: string, value: string): Promise<void> {
    const store = await this.getStore('readwrite');
    return new Promise((resolve, reject) => {
      const req = store.put(value, key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(new Error(String(req.error)));
    });
  }

  async removeItem(key: string): Promise<void> {
    const store = await this.getStore('readwrite');
    return new Promise((resolve, reject) => {
      const req = store.delete(key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(new Error(String(req.error)));
    });
  }
}

// Derives a 32-byte AES-256 key from the student secret using a domain
// separation tag, then imports it as an AES-GCM CryptoKey.
async function deriveStorageKey(studentSecret: Uint8Array): Promise<CryptoKey> {
  const keyBytes = await hash('secure-store-enc-key', studentSecret);
  return crypto.subtle.importKey(
    'raw',
    keyBytes as unknown as BufferSource,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt'],
  );
}

// Encrypts a string value with AES-256-GCM. Returns `iv || ciphertext`
// base64-encoded.
async function encryptValue(plaintext: string, key: CryptoKey): Promise<string> {
  const encoder = new TextEncoder();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoder.encode(plaintext),
  );
  const combined = new Uint8Array(12 + cipher.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(cipher), 12);
  return btoa(String.fromCharCode(...combined));
}

// Decrypts base64(`iv || ciphertext`) back to a string.
async function decryptValue(encoded: string, key: CryptoKey): Promise<string> {
  const combined = new Uint8Array(
    atob(encoded).split('').map((c) => c.charCodeAt(0)),
  );
  const iv = combined.subarray(0, 12);
  const cipher = combined.subarray(12);
  const decoder = new TextDecoder();
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    cipher,
  );
  return decoder.decode(plain);
}

// Stored entry shape.
interface StoredEntry {
  value: string; // base64(iv || ciphertext)
}

// Parses a JSON string into a known shape.
function parseJson<T>(raw: string): T {
  return JSON.parse(raw) as T;
}

// Backup shape produced by exportBackup.
interface BackupData {
  version: number;
  salt: string;
  iv: string;
  ciphertext: string;
}

// SecureStore wraps a StorageBackend and encrypts every value before writing.
//
// The encryption key is derived from the student secret, so only someone who
// knows the secret can read stored values.
export class SecureStore {
  private readonly keyPromise: Promise<CryptoKey>;
  private readonly storage: StorageBackend;

  constructor(studentSecret: Uint8Array, storage?: StorageBackend) {
    this.keyPromise = deriveStorageKey(studentSecret);
    this.storage = storage ?? new MemoryStorage();
  }

  private async getKey(): Promise<CryptoKey> {
    return this.keyPromise;
  }

  // Stores `value` under `key`, encrypted with AES-256-GCM.
  async put(key: string, value: string): Promise<void> {
    const cryptoKey = await this.getKey();
    const encoded = await encryptValue(value, cryptoKey);
    await this.storage.setItem(key, JSON.stringify({ value: encoded }));
  }

  // Retrieves and decrypts the value under `key`. Returns null if missing.
  async get(key: string): Promise<string | null> {
    const cryptoKey = await this.getKey();
    const raw = await this.storage.getItem(key);
    if (raw === null) {
      return null;
    }
    const entry = parseJson<StoredEntry>(raw);
    return decryptValue(entry.value, cryptoKey);
  }

  // Removes the entry under `key`.
  async delete(key: string): Promise<void> {
    await this.storage.removeItem(key);
  }

  // Exports role keys as a JSON string, encrypted with a key derived from
  // `passphrase` via PBKDF2 + AES-GCM. Returns the JSON string (the caller can
  // trigger a download).
  static async exportBackup(
    keys: Record<string, string>,
    passphrase: string,
  ): Promise<string> {
    const encoder = new TextEncoder();
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));

    const passKey = await crypto.subtle.importKey(
      'raw',
      encoder.encode(passphrase),
      { name: 'PBKDF2' },
      false,
      ['deriveBits'],
    );
    const keyBits = await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt,
        iterations: 100_000,
        hash: 'SHA-256',
      },
      passKey,
      256,
    );
    const wrapKey = await crypto.subtle.importKey(
      'raw',
      keyBits,
      { name: 'AES-GCM' },
      false,
      ['encrypt'],
    );

    const plaintext = encoder.encode(JSON.stringify(keys));
    const cipher = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      wrapKey,
      plaintext,
    );

    const backup: BackupData = {
      version: 1,
      salt: btoa(String.fromCharCode(...salt)),
      iv: btoa(String.fromCharCode(...iv)),
      ciphertext: btoa(String.fromCharCode(...new Uint8Array(cipher))),
    };
    return JSON.stringify(backup);
  }

  // Imports role keys from a backup JSON string, decrypting with `passphrase`.
  // Throws if the passphrase is wrong or the backup is tampered.
  static async importBackup(
    encryptedJson: string,
    passphrase: string,
  ): Promise<Record<string, string>> {
    const encoder = new TextEncoder();
    const backup = parseJson<BackupData>(encryptedJson);
    const salt = new Uint8Array(
      atob(backup.salt).split('').map((c) => c.charCodeAt(0)),
    );
    const iv = new Uint8Array(
      atob(backup.iv).split('').map((c) => c.charCodeAt(0)),
    );
    const ciphertext = new Uint8Array(
      atob(backup.ciphertext).split('').map((c) => c.charCodeAt(0)),
    );

    const passKey = await crypto.subtle.importKey(
      'raw',
      encoder.encode(passphrase),
      { name: 'PBKDF2' },
      false,
      ['deriveBits'],
    );
    const keyBits = await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt,
        iterations: 100_000,
        hash: 'SHA-256',
      },
      passKey,
      256,
    );
    const wrapKey = await crypto.subtle.importKey(
      'raw',
      keyBits,
      { name: 'AES-GCM' },
      false,
      ['decrypt'],
    );

    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      wrapKey,
      ciphertext,
    );
    return JSON.parse(new TextDecoder().decode(plain)) as Record<string, string>;
  }
}
