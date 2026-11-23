// Streaming file hash. Computes SHA-256 of a file's bytes while reading in
// chunks, so large files don't need to be held in memory all at once. The
// result matches `sha256sum` of the same bytes and is used as the evidence
// identifier (hash of encrypted output in the submission pipeline).

// Size of each streaming read chunk (1 MB).
export const HASH_STREAM_CHUNK_BYTES = 1024 * 1024;

// Hashes a file's bytes in 1 MB chunks and returns the SHA-256 digest.
// Reads and concatenates chunks into a single bounded buffer (max 25 MB per
// the evidence size limit) before digesting, so the result is byte-identical
// to `sha256sum` of the file.
export async function hashFile(file: File): Promise<Uint8Array> {
  const totalBytes = file.size;
  const chunkCount = Math.ceil(totalBytes / HASH_STREAM_CHUNK_BYTES);

  if (chunkCount === 0) {
    const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(0));
    return new Uint8Array(digest);
  }

  const parts: Uint8Array[] = [];
  for (let i = 0; i < chunkCount; i += 1) {
    const start = i * HASH_STREAM_CHUNK_BYTES;
    const end = Math.min(start + HASH_STREAM_CHUNK_BYTES, totalBytes);
    const slice = file.slice(start, end);
    const arrayBuffer = await slice.arrayBuffer();
    parts.push(new Uint8Array(arrayBuffer));
  }

  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const all = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    all.set(part, offset);
    offset += part.length;
  }

  const digest = await crypto.subtle.digest('SHA-256', all);
  return new Uint8Array(digest);
}
