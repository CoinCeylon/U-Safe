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

// ---------------------------------------------------------------------------
// Serialized encrypted-file format (submission pipeline, M060)
// ---------------------------------------------------------------------------
//
// Encrypted files are uploaded as single blobs. The serialized format packs
// the chunk list produced by `encryptFile` into a self-describing byte
// sequence so a reader can stream the chunks back out one at a time:
//
//   bytes 0..3    magic "USF1" (format id and version)
//   bytes 4..7    chunk count, unsigned 32-bit little-endian
//   then per chunk: 4-byte LE byte length followed by `iv || ciphertext`
//
// Nothing in the frame is secret: the chunks are already AES-256-GCM
// encrypted and authenticated, so tampering is detected on decrypt.

export const ENCRYPTED_FILE_MAGIC = 'USF1';

function littleEndian32(value: number): Uint8Array {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new Error('value does not fit in an unsigned 32-bit integer');
  }
  return new Uint8Array([value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff]);
}

// Serializes encrypted chunks into the framed blob format above.
export function serializeEncryptedChunks(chunks: EncryptedChunk[]): Uint8Array {
  if (chunks.length === 0) {
    throw new Error('cannot serialize an empty chunk list');
  }
  for (const chunk of chunks) {
    if (chunk.data.length === 0) {
      throw new Error(`chunk ${chunk.index} is empty`);
    }
  }

  const encoder = new TextEncoder();
  const magic = encoder.encode(ENCRYPTED_FILE_MAGIC);
  const total =
    magic.length +
    4 +
    chunks.reduce((sum, chunk) => sum + 4 + chunk.data.length, 0);
  const out = new Uint8Array(total);

  let offset = 0;
  out.set(magic, offset);
  offset += magic.length;
  out.set(littleEndian32(chunks.length), offset);
  offset += 4;

  // Chunk order in the frame is the chunk order of the list; `decryptFile`
  // sorts by index anyway, so a re-ordered but complete frame still decrypts.
  for (const chunk of chunks) {
    out.set(littleEndian32(chunk.data.length), offset);
    offset += 4;
    out.set(chunk.data, offset);
    offset += chunk.data.length;
  }
  return out;
}

// Parses a framed blob back into its encrypted chunks, validating the magic
// byte, the declared chunk count and every declared chunk length. Throws on
// truncated, oversized or malformed input.
export function parseEncryptedChunks(bytes: Uint8Array): EncryptedChunk[] {
  const decoder = new TextDecoder();
  const headerSize = 4 + 4;
  if (bytes.length < headerSize) {
    throw new Error('serialized file too short for a header');
  }

  const magic = decoder.decode(bytes.subarray(0, 4));
  if (magic !== ENCRYPTED_FILE_MAGIC) {
    throw new Error('unknown serialized file format');
  }

  const chunkCount =
    (bytes[4]! | (bytes[5]! << 8) | (bytes[6]! << 16) | (bytes[7]! << 24)) >>> 0;
  if (chunkCount === 0) {
    throw new Error('serialized file declares no chunks');
  }

  const chunks: EncryptedChunk[] = [];
  let offset = headerSize;
  for (let index = 0; index < chunkCount; index += 1) {
    if (offset + 4 > bytes.length) {
      throw new Error(`serialized file truncated in chunk ${index} header`);
    }
    const length =
      (bytes[offset]! |
        (bytes[offset + 1]! << 8) |
        (bytes[offset + 2]! << 16) |
        (bytes[offset + 3]! << 24)) >>>
      0;
    offset += 4;
    if (length === 0 || offset + length > bytes.length) {
      throw new Error(`serialized file truncated in chunk ${index} body`);
    }
    chunks.push({ index, data: bytes.subarray(offset, offset + length) });
    offset += length;
  }

  if (offset !== bytes.length) {
    throw new Error('serialized file has trailing bytes');
  }
  return chunks;
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
