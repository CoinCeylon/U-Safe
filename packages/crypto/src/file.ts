// Domain tag for deriving per-file keys from a master key. Keeps file keys
// distinct from any other key the system derives.
export const DOMAIN_TAG_FILE_KEY = 'file-key';

// Size of each file chunk in bytes (1 MB). Large files are encrypted chunk by
// chunk so a single file never exhausts memory.
export const FILE_CHUNK_BYTES = 1024 * 1024;

// IV size for AES-256-GCM (96 bits = 12 bytes).
export const GCM_IV_SIZE = 12;

// AES-256-GCM key size (32 bytes).
export const AES_KEY_SIZE = 32;

// Auth tag length appended by the Web Crypto GCM implementation.
export const GCM_TAG_SIZE = 16;

import { hash } from './hash';

// Derives a per-file AES-256 key from a master key using the hash adapter,
// so every file gets its own key and keys never collide across files.
export async function deriveFileKey(
  masterKey: Uint8Array,
  fileKeyMaterial: Uint8Array,
): Promise<Uint8Array> {
  return hash(DOMAIN_TAG_FILE_KEY, masterKey, fileKeyMaterial);
}

// Encrypts a plaintext byte buffer with AES-256-GCM using the provided key.
//
// Returns `iv || ciphertext` where `iv` is a random 96-bit IV prepended so
// decryption can recover it. The GCM auth tag is appended internally by the
// Web Crypto API and is verified on decrypt.
export async function encryptBytes(
  plain: Uint8Array,
  key: Uint8Array,
): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(GCM_IV_SIZE)) as unknown as Uint8Array;
  const cryptoKey = await importAesKey(key);
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as unknown as BufferSource },
    cryptoKey,
    plain as unknown as BufferSource,
  );
  const cipherBytes = new Uint8Array(cipher) as unknown as Uint8Array;
  const result = new Uint8Array(GCM_IV_SIZE + cipherBytes.length);
  result.set(iv);
  result.set(cipherBytes, GCM_IV_SIZE);
  return result;
}

// Decrypts `iv || ciphertext` produced by `encryptBytes`. Verifies the GCM
// auth tag; throws if the ciphertext was tampered with or the key is wrong.
export async function decryptBytes(
  cipherWithIv: Uint8Array,
  key: Uint8Array,
): Promise<Uint8Array> {
  if (cipherWithIv.length < GCM_IV_SIZE) {
    throw new Error('ciphertext too short to contain an IV');
  }

  const iv = cipherWithIv.subarray(0, GCM_IV_SIZE) as unknown as BufferSource;
  const cipher = cipherWithIv.subarray(GCM_IV_SIZE) as unknown as BufferSource;
  const cryptoKey = await importAesKey(key);
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    cryptoKey,
    cipher,
  );
  return new Uint8Array(plain);
}

// Imports raw AES key bytes as a CryptoKey for AES-GCM encrypt/decrypt.
async function importAesKey(key: Uint8Array): Promise<CryptoKey> {
  if (key.length !== AES_KEY_SIZE) {
    throw new Error(`AES key must be ${AES_KEY_SIZE} bytes`);
  }
  return crypto.subtle.importKey(
    'raw',
    key as unknown as BufferSource,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt'],
  );
}

// Represents one encrypted chunk: the chunk index plus `iv || ciphertext`.
export interface EncryptedChunk {
  index: number;
  data: Uint8Array; // iv || ciphertext
}

// Minimal file-like interface accepted by encryptFile. The browser `File`
// satisfies this structurally, and tests can use a lightweight fake.
export interface FileLike {
  size: number;
  slice(start: number, end: number): { arrayBuffer(): Promise<ArrayBuffer> };
}

// Encrypts a file in 1 MB chunks. Each chunk gets its own random IV and GCM
// auth tag, so large files stream through memory one chunk at a time.
//
// Returns the list of encrypted chunks plus the per-file key and the total
// original byte size.
export async function encryptFile(file: FileLike): Promise<{
  chunks: EncryptedChunk[];
  key: Uint8Array;
  totalBytes: number;
}> {
  const key = crypto.getRandomValues(new Uint8Array(AES_KEY_SIZE));
  const chunks: EncryptedChunk[] = [];
  const totalBytes = file.size;
  const chunkCount = Math.ceil(totalBytes / FILE_CHUNK_BYTES);

  for (let index = 0; index < chunkCount; index += 1) {
    const start = index * FILE_CHUNK_BYTES;
    const end = Math.min(start + FILE_CHUNK_BYTES, totalBytes);
    const slice = file.slice(start, end);
    const arrayBuffer = await slice.arrayBuffer();
    const plain = new Uint8Array(arrayBuffer) as unknown as Uint8Array;
    const encrypted = await encryptBytes(plain, key);
    chunks.push({ index, data: encrypted });
  }

  return { chunks, key, totalBytes };
}

// Decrypts chunks produced by `encryptFile` back into the original file
// bytes, in order. Verifies each chunk's GCM auth tag; throws if any chunk
// was tampered with.
export async function decryptFile(
  chunks: EncryptedChunk[],
  key: Uint8Array,
  totalBytes: number,
): Promise<Uint8Array> {
  const sorted = [...chunks].sort((a, b) => a.index - b.index);
  const parts: Uint8Array[] = [];
  let written = 0;

  for (const chunk of sorted) {
    const plain = await decryptBytes(chunk.data, key);
    parts.push(plain);
    written += plain.length;
  }

  if (written !== totalBytes) {
    throw new Error(
      `decrypted size ${written} does not match expected ${totalBytes}`,
    );
  }

  const result = new Uint8Array(totalBytes);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}
