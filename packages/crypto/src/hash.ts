// Text encoder for converting string domain tags into bytes.
const encoder = new TextEncoder();

// Converts a string or Uint8Array into a canonical Uint8Array byte buffer.
// Strings are UTF-8 encoded; byte arrays are passed through unchanged.
function toBytes(input: string | Uint8Array): Uint8Array {
  if (input instanceof Uint8Array) {
    return input;
  }
  return encoder.encode(input);
}

// Prepends an 8-byte big-endian length prefix to a byte array.
// Domain separation is achieved by length-prefixing every part (including the
// domain tag) so that ambiguous concatenations cannot collide.
function lengthPrefix(bytes: Uint8Array): Uint8Array {
  const lenBuf = new DataView(new ArrayBuffer(8));
  lenBuf.setBigUint64(0, BigInt(bytes.length), false);
  const lenBytes = new Uint8Array(lenBuf.buffer);
  const result = new Uint8Array(8 + bytes.length);
  result.set(lenBytes);
  result.set(bytes, 8);
  return result;
}

// Concatenates an array of Uint8Array chunks into a single buffer.
function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

// Interface for computing domain-separated hashes. Every part (including the
// domain tag) is length-prefixed before hashing to prevent concatenation
// ambiguity attacks.
export interface HashAdapter {
  hash(domainTag: string, ...parts: Uint8Array[]): Promise<Uint8Array>;
}

// Domain-separated SHA-256 adapter using the Web Crypto API.
//
// Usage: hash(domainTag, ...parts) produces SHA-256(lengthPrefix(domainTag) ||
// lengthPrefix(part1) || ...). Different domain tags produce unrelated outputs
// for identical parts, so the same primitive can safely derive commitments,
// nullifiers, inbox keys, and other values from one shared secret.
//
// This adapter can be replaced by a Midnight-compatible adapter via
// setHashAdapter when CHAIN_MODE=testnet (Group 9).
export class Sha256Adapter implements HashAdapter {
  async hash(domainTag: string, ...parts: Uint8Array[]): Promise<Uint8Array> {
    const chunks: Uint8Array[] = [lengthPrefix(toBytes(domainTag))];
    for (const part of parts) {
      chunks.push(lengthPrefix(part));
    }
    const data = concat(chunks);
    const digest = await crypto.subtle.digest(
      'SHA-256',
      data as unknown as BufferSource,
    );
    return new Uint8Array(digest);
  }
}

// The active hash adapter used by the convenience hash() function below.
// Defaults to Sha256Adapter; swapped out in Group 9 for Midnight compatibility.
let currentAdapter: HashAdapter = new Sha256Adapter();

// Replaces the active hash adapter. Called by Group 9 to install the
// Midnight-compatible hash so commitments match on-chain values exactly.
export function setHashAdapter(adapter: HashAdapter): void {
  currentAdapter = adapter;
}

// Returns the currently active hash adapter.
export function getHashAdapter(): HashAdapter {
  return currentAdapter;
}

// Computes a domain-separated hash using the active adapter. Defaults to
// Sha256Adapter unless setHashAdapter has been called with a replacement.
export async function hash(
  domainTag: string,
  ...parts: Uint8Array[]
): Promise<Uint8Array> {
  return currentAdapter.hash(domainTag, ...parts);
}
