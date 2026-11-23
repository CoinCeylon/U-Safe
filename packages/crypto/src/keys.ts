// RSA-OAEP 2048 (SHA-256) for wrapping per-file AES keys to role public keys.
// Every role key pair (university registrar/investigator/admin, UGC officer)
// is generated as an RSA-OAEP 2048 key pair, exported/imported as JWK, and
// used to wrap (encrypt) per-file AES keys so only the matching private key
// holder can unwrap them.

// RSA key size in bits.
export const RSA_KEY_SIZE = 2048;

// Generates an RSA-OAEP 2048 key pair. Returns CryptoKey objects usable for
// wrap (public) / unwrap (private) and exportable to JWK.
export async function generateRoleKeyPair(): Promise<{
  publicKey: CryptoKey;
  privateKey: CryptoKey;
}> {
  return crypto.subtle.generateKey(
    {
      name: 'RSA-OAEP',
      modulusLength: RSA_KEY_SIZE,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: { name: 'SHA-256' },
    },
    true, // extractable so we can back up / deliver the key
    ['wrapKey', 'unwrapKey'],
  );
}

// Exports a CryptoKey to JWK format.
// TypeScript's DOM lib types don't list 'jwk' for exportKey, but the Web
// Crypto API supports it at runtime.
export async function exportJwk(key: CryptoKey): Promise<JsonWebKey> {
  return (crypto.subtle as unknown as {
    exportKey(format: 'jwk', key: CryptoKey): Promise<JsonWebKey>;
  }).exportKey('jwk', key);
}

// Imports a CryptoKey from JWK format. Keys are extractable so they can be
// backed up and delivered.
// TypeScript's DOM lib types don't list 'jwk' for importKey, but the Web
// Crypto API supports it at runtime.
export async function importJwk(
  jwk: JsonWebKey,
  usages: KeyUsage[],
): Promise<CryptoKey> {
  return (crypto.subtle as unknown as {
    importKey(
      format: 'jwk',
      key: JsonWebKey,
      algorithm: AlgorithmIdentifier,
      extractable: boolean,
      keyUsages: KeyUsage[],
    ): Promise<CryptoKey>;
  }).importKey(
    'jwk',
    jwk,
    {
      name: 'RSA-OAEP',
      modulusLength: RSA_KEY_SIZE,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: { name: 'SHA-256' },
    } as unknown as AlgorithmIdentifier,
    true, // extractable so keys can be backed up and delivered
    usages,
  );
}

// Exports a public key to JWK with wrap usage.
export async function exportPublicKeyJwk(publicKey: CryptoKey): Promise<JsonWebKey> {
  return exportJwk(publicKey);
}

// Exports a private key to JWK with unwrap usage.
export async function exportPrivateKeyJwk(privateKey: CryptoKey): Promise<JsonWebKey> {
  return exportJwk(privateKey);
}

// Imports a public key from JWK for wrapping AES keys.
export async function importPublicKeyJwk(jwk: JsonWebKey): Promise<CryptoKey> {
  return importJwk(jwk, ['wrapKey']);
}

// Imports a private key from JWK for unwrapping AES keys.
export async function importPrivateKeyJwk(jwk: JsonWebKey): Promise<CryptoKey> {
  return importJwk(jwk, ['unwrapKey']);
}

// Wraps (encrypts) an AES key using the recipient's RSA-OAEP public key.
// Returns the wrapped key bytes. Only the matching private key can unwrap it.
export async function wrapKey(
  aesKey: CryptoKey,
  publicKey: CryptoKey,
): Promise<Uint8Array> {
  const wrapped = await (crypto.subtle as unknown as {
    wrapKey(
      format: 'jwk',
      key: CryptoKey,
      wrappingKey: CryptoKey,
      algorithm: Algorithm,
    ): Promise<ArrayBuffer>;
  }).wrapKey(
    'jwk',
    aesKey,
    publicKey,
    {
      name: 'RSA-OAEP',
      hash: { name: 'SHA-256' },
    } as unknown as Algorithm,
  );
  return new Uint8Array(wrapped);
}

// Unwraps (decrypts) wrapped AES key bytes using the recipient's RSA-OAEP
// private key. Throws if wrapped with a different public key or tampered.
export async function unwrapKey(
  wrapped: Uint8Array,
  privateKey: CryptoKey,
): Promise<CryptoKey> {
  return crypto.subtle.unwrapKey(
    'jwk',
    wrapped as unknown as BufferSource,
    privateKey,
    {
      name: 'RSA-OAEP',
      hash: { name: 'SHA-256' },
    } as unknown as Algorithm,
    { name: 'AES-GCM', length: 256 },
    false, // the unwrapped AES key is not extractable here
    ['encrypt', 'decrypt'],
  );
}

// Generates a random 256-bit AES key suitable for wrapping with wrapKey.
export async function generateAesKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt', 'wrapKey', 'unwrapKey'],
  );
}
