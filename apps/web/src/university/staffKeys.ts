// University role key handling for the staff portal (M064).
//
// The university RSA-OAEP private key never leaves the browser in plaintext.
// It is stored as a passphrase-encrypted backup blob (PBKDF2 + AES-256-GCM,
// produced by SecureStore.exportBackup) in the IndexedDB secure-store
// backend, and imported into memory only after the staff member enters the
// passphrase. A page refresh clears the in-memory key, so the portal asks
// for the passphrase again; a wrong passphrase fails the GCM authentication
// and is rejected.

import {
  IndexedDbStorage,
  SecureStore,
  exportPrivateKeyJwk,
  exportPublicKeyJwk,
  generateRoleKeyPair,
  importPrivateKeyJwk,
  type StorageBackend,
} from '@usafe/crypto';

export interface LoadedRoleKey {
  universityId: string;
  /** Public JWK, kept for display and for (re-)registration with the server. */
  publicKeyJwk: JsonWebKey;
  /** Imported RSA private key (usage: unwrapKey). Memory only. */
  privateKey: CryptoKey;
}

let loadedRoleKey: LoadedRoleKey | null = null;

export const getLoadedRoleKey = (): LoadedRoleKey | null => loadedRoleKey;

export const setLoadedRoleKey = (key: LoadedRoleKey): void => {
  loadedRoleKey = key;
};

export const clearLoadedRoleKey = (): void => {
  loadedRoleKey = null;
};

const backupKey = (universityId: string): string =>
  `roleKeyBackup:${universityId}`;

/** Secure-store backend holding the passphrase-protected backup blob. */
export const staffKeyStorage = (): StorageBackend =>
  new IndexedDbStorage('usafe-university', 'staff-keys');

export const hasStoredBackup = async (
  storage: StorageBackend,
  universityId: string,
): Promise<boolean> =>
  (await storage.getItem(backupKey(universityId))) !== null;

/**
 * Parses a backup file (the same format as `.dev-keys/*.json` from
 * `npm run seed:keys`), decrypting it with `passphrase`. Throws a friendly
 * error on a wrong passphrase or a damaged file.
 */
export const parseBackupFile = async (
  backupJson: string,
  passphrase: string,
): Promise<{ publicKeyJwk: string; privateKeyJwk: string }> => {
  let keys: Record<string, string>;
  try {
    keys = await SecureStore.importBackup(backupJson, passphrase);
  } catch {
    throw new Error('Wrong passphrase or damaged backup file.');
  }
  if (
    typeof keys.publicKeyJwk !== 'string' ||
    typeof keys.privateKeyJwk !== 'string'
  ) {
    throw new Error('The backup file does not contain a role key pair.');
  }
  return {
    publicKeyJwk: keys.publicKeyJwk,
    privateKeyJwk: keys.privateKeyJwk,
  };
};

/**
 * Imports a backup blob into memory and persists it in the secure store.
 * Called for both the unlock-on-refresh flow (blob already stored) and the
 * import-from-file flow (blob comes from the chosen file).
 */
export const unlockBackupBlob = async (
  storage: StorageBackend,
  universityId: string,
  backupJson: string,
  passphrase: string,
): Promise<LoadedRoleKey> => {
  const material = await parseBackupFile(backupJson, passphrase);
  let publicKeyJwk: JsonWebKey;
  let privateKeyJwk: JsonWebKey;
  try {
    publicKeyJwk = JSON.parse(material.publicKeyJwk) as JsonWebKey;
    privateKeyJwk = JSON.parse(material.privateKeyJwk) as JsonWebKey;
  } catch {
    throw new Error('The backup file does not contain valid JWK keys.');
  }
  if (publicKeyJwk.kty !== 'RSA' || privateKeyJwk.kty !== 'RSA') {
    throw new Error('The backup does not contain an RSA role key pair.');
  }

  let privateKey: CryptoKey;
  try {
    privateKey = await importPrivateKeyJwk(privateKeyJwk);
  } catch {
    throw new Error('The private key in the backup could not be imported.');
  }

  const key: LoadedRoleKey = { universityId, publicKeyJwk, privateKey };
  loadedRoleKey = key;
  await storage.setItem(backupKey(universityId), backupJson);
  return key;
};

/**
 * Unlock flow after a page refresh: reads the stored backup and asks for its
 * passphrase. A wrong passphrase throws.
 */
export const unlockStoredBackup = async (
  storage: StorageBackend,
  universityId: string,
  passphrase: string,
): Promise<LoadedRoleKey> => {
  const backupJson = await storage.getItem(backupKey(universityId));
  if (backupJson === null) {
    throw new Error('No stored key backup was found for this university.');
  }
  return unlockBackupBlob(storage, universityId, backupJson, passphrase);
};

/**
 * Generates a fresh RSA-OAEP 2048 university key pair, protects it with the
 * chosen passphrase, stores the backup blob in the secure store and loads
 * the private key into memory. Returns the backup JSON for the mandatory
 * download and the public JWK for server registration.
 */
export const generateAndStoreRoleKey = async (
  storage: StorageBackend,
  universityId: string,
  passphrase: string,
): Promise<{ backupJson: string; publicKeyJwk: string }> => {
  const pair = await generateRoleKeyPair();
  const publicKeyJwk = JSON.stringify(await exportPublicKeyJwk(pair.publicKey));
  const privateKeyJwk = JSON.stringify(
    await exportPrivateKeyJwk(pair.privateKey),
  );
  const backupJson = await SecureStore.exportBackup(
    { role: 'university', universityId, publicKeyJwk, privateKeyJwk },
    passphrase,
  );

  const key: LoadedRoleKey = {
    universityId,
    publicKeyJwk: JSON.parse(publicKeyJwk) as JsonWebKey,
    privateKey: pair.privateKey,
  };
  loadedRoleKey = key;
  await storage.setItem(backupKey(universityId), backupJson);
  return { backupJson, publicKeyJwk };
};

/**
 * Registers the public key with the server (M064):
 * PUT /api/university/:id/public-key with the staff session token.
 */
export const registerPublicKey = async (
  token: string,
  universityId: string,
  publicKeyJwkJson: string,
): Promise<void> => {
  const response = await fetch(`/api/university/${universityId}/public-key`, {
    method: 'PUT',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ publicKeyJwk: publicKeyJwkJson }),
  });
  if (!response.ok) {
    throw new Error(
      `The server rejected the public key (status ${response.status}).`,
    );
  }
};

/** Short SHA-256 fingerprint of the public JWK for display. */
export const publicKeyFingerprint = async (
  jwk: JsonWebKey,
): Promise<string> => {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(jwk)),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16);
};
