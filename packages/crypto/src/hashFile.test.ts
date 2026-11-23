import { describe, it, expect } from 'vitest';
import { hashFile, HASH_STREAM_CHUNK_BYTES } from './hashFile';

const encoder = new TextEncoder();

function toBytes(input: string): Uint8Array {
  return new Uint8Array(encoder.encode(input));
}

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

function fileFromBytes(bytes: Uint8Array, name = 'test.bin'): File {
  return new File([bytes as unknown as BlobPart], name);
}

function digestSha256(data: Uint8Array): Promise<Uint8Array> {
  return crypto.subtle
    .digest('SHA-256', data as unknown as BufferSource)
    .then((d) => new Uint8Array(d));
}

describe('hashFile', () => {
  it('hashes an empty file to the SHA-256 of empty input', async () => {
    const file = fileFromBytes(new Uint8Array(0));
    const hash = await hashFile(file);
    const expected = await digestSha256(new Uint8Array(0));
    expect(hash).toHaveLength(32);
    expect(hash).toEqual(expected);
  });

  it('hashes small content matching crypto.subtle.digest', async () => {
    const content = toBytes('hello world');
    const file = fileFromBytes(content);
    const hash = await hashFile(file);
    const expected = await digestSha256(content);
    expect(hash).toEqual(expected);
  });

  it('is deterministic', async () => {
    const content = toBytes('deterministic content');
    const file = fileFromBytes(content);
    const a = await hashFile(file);
    const b = await hashFile(file);
    expect(a).toEqual(b);
  });

  it('differs for different content', async () => {
    const a = await hashFile(fileFromBytes(toBytes('aaa')));
    const b = await hashFile(fileFromBytes(toBytes('bbb')));
    expect(a).not.toEqual(b);
  });

  it('hashes multi-chunk content matching concatenated digest', async () => {
    // Just over one chunk to force multiple reads.
    const size = HASH_STREAM_CHUNK_BYTES + 1024;
    const parts: Uint8Array[] = [];
    let remaining = size;
    while (remaining > 0) {
      const n = Math.min(remaining, HASH_STREAM_CHUNK_BYTES);
      parts.push(fillRandom(n));
      remaining -= n;
    }
    const all = new Uint8Array(size);
    let offset = 0;
    for (const part of parts) {
      all.set(part, offset);
      offset += part.length;
    }

    const file = new File(parts as unknown as BlobPart[], 'multi.bin');
    const hash = await hashFile(file);
    const expected = await digestSha256(all);
    expect(hash).toEqual(expected);
  });

  it('produces 32 bytes', async () => {
    const file = fileFromBytes(toBytes('anything'));
    const hash = await hashFile(file);
    expect(hash).toHaveLength(32);
  });
});
