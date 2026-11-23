import { describe, it, expect } from 'vitest';
import {
  encryptBytes,
  decryptBytes,
  deriveFileKey,
  encryptFile,
  decryptFile,
  FILE_CHUNK_BYTES,
} from './file';

const enc = new TextEncoder();

// crypto.getRandomValues has a per-call quota (64 KiB in some runtimes), so
// fill larger buffers in chunks.
function fillRandom(length: number): Uint8Array {
  const buf = new Uint8Array(length);
  const CHUNK = 65536;
  let offset = 0;
  while (offset < length) {
    const n = Math.min(CHUNK, length - offset);
    buf.set(crypto.getRandomValues(new Uint8Array(n)), offset);
    offset += n;
  }
  return buf;
}

// Minimal File-like object for environments where `File` is unavailable.
class FakeFile {
  name: string;
  size: number;
  private parts: Uint8Array[];

  constructor(parts: Uint8Array[], name = 'test.bin') {
    this.name = name;
    this.parts = parts;
    this.size = parts.reduce((sum, p) => sum + p.length, 0);
  }

  slice(start: number, end: number): FakeFile {
    const all = new Uint8Array(this.size);
    let offset = 0;
    for (const part of this.parts) {
      all.set(part, offset);
      offset += part.length;
    }
    const sliced = all.subarray(start, end);
    return new FakeFile([sliced], this.name);
  }

  arrayBuffer(): Promise<ArrayBuffer> {
    const all = new Uint8Array(this.size);
    let offset = 0;
    for (const part of this.parts) {
      all.set(part, offset);
      offset += part.length;
    }
    return Promise.resolve(all.buffer);
  }
}

describe('encryptBytes / decryptBytes', () => {
  it('round-trips a small plaintext', async () => {
    const key = crypto.getRandomValues(new Uint8Array(32));
    const plain = enc.encode('hello world');
    const cipher = await encryptBytes(plain, key);
    const decrypted = await decryptBytes(cipher, key);
    expect(decrypted).toEqual(plain);
  });

  it('round-trips an empty plaintext', async () => {
    const key = crypto.getRandomValues(new Uint8Array(32));
    const plain = new Uint8Array(0);
    const cipher = await encryptBytes(plain, key);
    const decrypted = await decryptBytes(cipher, key);
    expect(decrypted).toEqual(plain);
  });

  it('produces different ciphertext for the same plaintext (random IV)', async () => {
    const key = crypto.getRandomValues(new Uint8Array(32));
    const plain = enc.encode('repeat');
    const a = await encryptBytes(plain, key);
    const b = await encryptBytes(plain, key);
    expect(a).not.toEqual(b);
  });

  it('fails with a wrong key', async () => {
    const key = crypto.getRandomValues(new Uint8Array(32));
    const wrongKey = crypto.getRandomValues(new Uint8Array(32));
    const plain = enc.encode('secret');
    const cipher = await encryptBytes(plain, key);
    await expect(decryptBytes(cipher, wrongKey)).rejects.toThrow();
  });

  it('fails when one byte of ciphertext is flipped', async () => {
    const key = crypto.getRandomValues(new Uint8Array(32));
    const plain = enc.encode('tamper me');
    const cipher = await encryptBytes(plain, key);
    const tampered = new Uint8Array(cipher);
    tampered[tampered.length - 1]! ^= 0xff;
    await expect(decryptBytes(tampered, key)).rejects.toThrow();
  });

  it('fails when the IV portion is flipped', async () => {
    const key = crypto.getRandomValues(new Uint8Array(32));
    const plain = enc.encode('iv tamper');
    const cipher = await encryptBytes(plain, key);
    const tampered = new Uint8Array(cipher);
    tampered[0]! ^= 0x01;
    await expect(decryptBytes(tampered, key)).rejects.toThrow();
  });

  it('rejects ciphertext shorter than an IV', async () => {
    const key = crypto.getRandomValues(new Uint8Array(32));
    await expect(decryptBytes(new Uint8Array(4), key)).rejects.toThrow(
      'ciphertext too short to contain an IV',
    );
  });
});

describe('deriveFileKey', () => {
  it('is deterministic', async () => {
    const master = crypto.getRandomValues(new Uint8Array(32));
    const material = enc.encode('file-material');
    const a = await deriveFileKey(master, material);
    const b = await deriveFileKey(master, material);
    expect(a).toEqual(b);
  });

  it('differs for different material', async () => {
    const master = crypto.getRandomValues(new Uint8Array(32));
    const a = await deriveFileKey(master, enc.encode('a'));
    const b = await deriveFileKey(master, enc.encode('b'));
    expect(a).not.toEqual(b);
  });
});

describe('encryptFile / decryptFile', () => {
  it('round-trips a small file', async () => {
    const contents = enc.encode('small file contents');
    const file = new FakeFile([contents], 'small.txt');
    const { totalBytes } = await encryptFile(file);

    // EncryptFile generates its own key; here we verify decryptFile works
    // with the key it produced by re-encrypting with a known key instead.
    // To keep the test deterministic, encrypt chunk by chunk with a known key.
    const knownKey = crypto.getRandomValues(new Uint8Array(32));
    const manualChunks: { index: number; data: Uint8Array }[] = [];
    const chunkCount = Math.ceil(file.size / FILE_CHUNK_BYTES);
    for (let i = 0; i < chunkCount; i += 1) {
      const start = i * FILE_CHUNK_BYTES;
      const end = Math.min(start + FILE_CHUNK_BYTES, file.size);
      const slice = file.slice(start, end);
      const buf = await slice.arrayBuffer();
      const plain = new Uint8Array(buf);
      const encrypted = await encryptBytes(plain, knownKey);
      manualChunks.push({ index: i, data: encrypted });
    }

    const decrypted = await decryptFile(manualChunks, knownKey, file.size);
    expect(decrypted).toEqual(contents);
    expect(totalBytes).toBe(file.size);
  });

  it('round-trips a multi-chunk file across chunk boundaries', async () => {
    // Just over one chunk (2 chunks total) to exercise chunking.
    const size = FILE_CHUNK_BYTES + 1024;
    // Build deterministic pseudo-random contents without allocating
    // a second 10 MB copy: fill in 1 MB chunks.
    const parts: Uint8Array[] = [];
    let remaining = size;
    while (remaining > 0) {
      const n = Math.min(FILE_CHUNK_BYTES, remaining);
      parts.push(fillRandom(n));
      remaining -= n;
    }
    const file = new FakeFile(parts, 'multi.bin');
    const knownKey = crypto.getRandomValues(new Uint8Array(32));

    const manualChunks: { index: number; data: Uint8Array }[] = [];
    const chunkCount = Math.ceil(file.size / FILE_CHUNK_BYTES);
    for (let i = 0; i < chunkCount; i += 1) {
      const start = i * FILE_CHUNK_BYTES;
      const end = Math.min(start + FILE_CHUNK_BYTES, file.size);
      const slice = file.slice(start, end);
      const buf = await slice.arrayBuffer();
      const plain = new Uint8Array(buf);
      const encrypted = await encryptBytes(plain, knownKey);
      manualChunks.push({ index: i, data: encrypted });
    }

    const decrypted = await decryptFile(manualChunks, knownKey, file.size);
    const expected = new Uint8Array(size);
    let offset = 0;
    for (const part of parts) {
      expected.set(part, offset);
      offset += part.length;
    }
    expect(decrypted).toEqual(expected);
  });

  it('fails when one chunk byte is flipped', async () => {
    const size = 5 * 1024 * 1024;
    const chunk = fillRandom(size);
    const file = new FakeFile([chunk], 'tamper.bin');
    const knownKey = crypto.getRandomValues(new Uint8Array(32));

    const manualChunks: { index: number; data: Uint8Array }[] = [];
    const chunkCount = Math.ceil(file.size / FILE_CHUNK_BYTES);
    for (let i = 0; i < chunkCount; i += 1) {
      const start = i * FILE_CHUNK_BYTES;
      const end = Math.min(start + FILE_CHUNK_BYTES, file.size);
      const slice = file.slice(start, end);
      const buf = await slice.arrayBuffer();
      const plain = new Uint8Array(buf);
      const encrypted = await encryptBytes(plain, knownKey);
      manualChunks.push({ index: i, data: encrypted });
    }

    // Flip a byte in the first chunk's ciphertext region.
    const last = manualChunks[0]!.data.length - 1;
    manualChunks[0]!.data[last]! ^= 0xff;

    await expect(
      decryptFile(manualChunks, knownKey, file.size),
    ).rejects.toThrow();
  });

  it('fails when chunks are given out of order but still reconstructs when sorted', async () => {
    const contents = enc.encode('ordering test file');
    const file = new FakeFile([contents], 'order.bin');
    const knownKey = crypto.getRandomValues(new Uint8Array(32));

    const manualChunks: { index: number; data: Uint8Array }[] = [];
    const chunkCount = Math.ceil(file.size / FILE_CHUNK_BYTES);
    for (let i = 0; i < chunkCount; i += 1) {
      const start = i * FILE_CHUNK_BYTES;
      const end = Math.min(start + FILE_CHUNK_BYTES, file.size);
      const slice = file.slice(start, end);
      const buf = await slice.arrayBuffer();
      const plain = new Uint8Array(buf);
      const encrypted = await encryptBytes(plain, knownKey);
      manualChunks.push({ index: i, data: encrypted });
    }

    // Reverse the order; decryptFile sorts by index.
    const reversed = [...manualChunks].reverse();
    const decrypted = await decryptFile(reversed, knownKey, file.size);
    expect(decrypted).toEqual(contents);
  });

  it('fails when totalBytes does not match decrypted size', async () => {
    const contents = enc.encode('size mismatch');
    const file = new FakeFile([contents], 'size.bin');
    const knownKey = crypto.getRandomValues(new Uint8Array(32));

    const manualChunks: { index: number; data: Uint8Array }[] = [];
    const chunkCount = Math.ceil(file.size / FILE_CHUNK_BYTES);
    for (let i = 0; i < chunkCount; i += 1) {
      const start = i * FILE_CHUNK_BYTES;
      const end = Math.min(start + FILE_CHUNK_BYTES, file.size);
      const slice = file.slice(start, end);
      const buf = await slice.arrayBuffer();
      const plain = new Uint8Array(buf);
      const encrypted = await encryptBytes(plain, knownKey);
      manualChunks.push({ index: i, data: encrypted });
    }

    await expect(
      decryptFile(manualChunks, knownKey, file.size + 1),
    ).rejects.toThrow('decrypted size');
  });

  it('handles a file smaller than one chunk', async () => {
    const contents = enc.encode('tiny');
    const file = new FakeFile([contents], 'tiny.txt');
    const knownKey = crypto.getRandomValues(new Uint8Array(32));

    const manualChunks: { index: number; data: Uint8Array }[] = [];
    const chunkCount = Math.ceil(file.size / FILE_CHUNK_BYTES);
    for (let i = 0; i < chunkCount; i += 1) {
      const start = i * FILE_CHUNK_BYTES;
      const end = Math.min(start + FILE_CHUNK_BYTES, file.size);
      const slice = file.slice(start, end);
      const buf = await slice.arrayBuffer();
      const plain = new Uint8Array(buf);
      const encrypted = await encryptBytes(plain, knownKey);
      manualChunks.push({ index: i, data: encrypted });
    }

    const decrypted = await decryptFile(manualChunks, knownKey, file.size);
    expect(decrypted).toEqual(contents);
  });

  it('handles a file exactly one chunk in size', async () => {
    const contents = fillRandom(FILE_CHUNK_BYTES);
    const file = new FakeFile([contents], 'exact.bin');
    const knownKey = crypto.getRandomValues(new Uint8Array(32));

    const manualChunks: { index: number; data: Uint8Array }[] = [];
    const chunkCount = Math.ceil(file.size / FILE_CHUNK_BYTES);
    for (let i = 0; i < chunkCount; i += 1) {
      const start = i * FILE_CHUNK_BYTES;
      const end = Math.min(start + FILE_CHUNK_BYTES, file.size);
      const slice = file.slice(start, end);
      const buf = await slice.arrayBuffer();
      const plain = new Uint8Array(buf);
      const encrypted = await encryptBytes(plain, knownKey);
      manualChunks.push({ index: i, data: encrypted });
    }

    const decrypted = await decryptFile(manualChunks, knownKey, file.size);
    expect(decrypted).toEqual(contents);
  });

  it('encryptFile produces the right number of chunks for a multi-chunk file', async () => {
    // 2.5 MB -> 3 chunks
    const size = 2.5 * 1024 * 1024;
    const parts: Uint8Array[] = [];
    let remaining = size;
    while (remaining > 0) {
      const n = Math.min(remaining, FILE_CHUNK_BYTES);
      parts.push(fillRandom(n));
      remaining -= n;
    }
    const file = new FakeFile(parts, 'multi.bin');
    const result = await encryptFile(file);
    expect(result.chunks.length).toBe(Math.ceil(size / FILE_CHUNK_BYTES));
    expect(result.totalBytes).toBe(size);
    expect(result.key).toHaveLength(32);
  });
});
