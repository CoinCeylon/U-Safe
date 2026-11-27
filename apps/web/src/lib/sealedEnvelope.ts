// Sealed complaint payload envelope (submission pipeline, M060).
//
// A complaint's sealed payload is stored as one blob. The blob is a small
// JSON envelope so every future reader (university portal M067, UGC portal
// M078) can tell how to open it without trying every key it holds:
//
//   {
//     "v": 1,
//     "kind": "community" | "ugc-only",
//     "iv": "<hex>",                // AES-GCM IV of the sealed payload
//     "ciphertext": "<base64>",     // sealed payload bytes
//     "payloadHash": "<hex>",       // SHA-256 of the plaintext JSON
//     "sealedKeyWrapped": "<base64>" // only for "ugc-only": the UGC-only
//                                    }  key wrapped for the UGC public key
//
// - kind "community": open with the university community key.
// - kind "ugc-only": staff-involved complaints. The payload is sealed with a
//   fresh random "UGC-only key"; the wrapped copy lets the UGC (and only the
//   UGC) recover it. The university cannot read these complaints.
//
// Privacy: the envelope carries only ciphertext, hashes and wrapped keys.
// No plaintext, name, email or wallet address ever enters it.

import { sealPayload, openPayload, type SealedPayload } from '@usafe/crypto';

export type EnvelopeKind = 'community' | 'ugc-only';

export interface SealedEnvelope {
  v: 1;
  kind: EnvelopeKind;
  iv: string;
  ciphertext: string;
  payloadHash: string;
  sealedKeyWrapped?: string;
}

export interface SealedPayloadBlob {
  envelope: SealedEnvelope;
  bytes: Uint8Array;
  blobHash: string;
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK));
  }
  return btoa(binary);
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) {
    throw new Error('invalid hex: odd length');
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    bytes as unknown as BufferSource,
  );
  return new Uint8Array(digest);
}

/**
 * Seals a payload with the given symmetric key and wraps it in the JSON
 * envelope. `sealedKeyWrapped` must be provided for `ugc-only` envelopes so
 * the UGC can recover the key; it is ignored for `community` envelopes.
 *
 * Returns the envelope, its serialized bytes and the SHA-256 of those bytes
 * (the blob hash used as the payload locator and the ledger payload hash).
 */
export async function buildSealedEnvelope(
  payload: unknown,
  key: Uint8Array,
  options: { kind: EnvelopeKind; sealedKeyWrapped?: Uint8Array },
): Promise<SealedPayloadBlob> {
  if (options.kind === 'ugc-only' && options.sealedKeyWrapped === undefined) {
    throw new Error('ugc-only envelopes require the key wrapped for the UGC');
  }

  const sealed: SealedPayload = await sealPayload(payload, key);
  const envelope: SealedEnvelope = {
    v: 1,
    kind: options.kind,
    iv: bytesToHex(sealed.iv),
    ciphertext: bytesToBase64(sealed.ciphertext),
    payloadHash: bytesToHex(sealed.payloadHash),
  };
  if (options.kind === 'ugc-only') {
    envelope.sealedKeyWrapped = bytesToBase64(options.sealedKeyWrapped!);
  }

  const bytes = new TextEncoder().encode(JSON.stringify(envelope));
  return { envelope, bytes, blobHash: bytesToHex(await sha256(bytes)) };
}

/** Parses envelope bytes without opening them. Validates the shape. */
export function parseSealedEnvelope(bytes: Uint8Array): SealedEnvelope {
  const envelope = JSON.parse(new TextDecoder().decode(bytes)) as Partial<
    SealedEnvelope & { sealedKeyWrapped: unknown }
  >;
  if (
    envelope.v !== 1 ||
    (envelope.kind !== 'community' && envelope.kind !== 'ugc-only') ||
    typeof envelope.iv !== 'string' ||
    typeof envelope.ciphertext !== 'string' ||
    typeof envelope.payloadHash !== 'string'
  ) {
    throw new Error('not a sealed U-Safe envelope');
  }
  if (envelope.kind === 'ugc-only' && typeof envelope.sealedKeyWrapped !== 'string') {
    throw new Error('ugc-only envelope is missing its wrapped key');
  }
  return envelope as SealedEnvelope;
}

/**
 * Opens a sealed envelope with the matching symmetric key and returns the
 * parsed payload. `openSealedEnvelope` verifies the inner plaintext hash,
 * so tampering with the ciphertext fails here as well as on decrypt.
 */
export async function openSealedEnvelope(
  envelope: SealedEnvelope,
  key: Uint8Array,
): Promise<unknown> {
  return openPayload(
    {
      iv: hexToBytes(envelope.iv),
      ciphertext: base64ToBytes(envelope.ciphertext),
      payloadHash: hexToBytes(envelope.payloadHash),
    },
    key,
  );
}

/** Unwraps the wrapped key bytes of a `ugc-only` envelope. */
export function envelopeWrappedKey(envelope: SealedEnvelope): Uint8Array {
  if (envelope.kind !== 'ugc-only' || envelope.sealedKeyWrapped === undefined) {
    throw new Error('envelope does not carry a wrapped key');
  }
  return base64ToBytes(envelope.sealedKeyWrapped);
}
