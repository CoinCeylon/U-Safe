# Human Test 2 — Crypto Playground Report

Date: 2026-11-25
Milestone: M022 (with M017/M018/M019 evidence)

## What changed

- Removed the third-party Tailwind CDN script; the playground loads the
  self-hosted `src/styles/app.css`.
- Added an editable ciphertext textarea. It is filled with the serialized
  encrypted chunks (hex) after the Encrypt step, and the Unwrap & decrypt step
  parses whatever is currently in the box.
- The "SHA-256 of encrypted bytes" box now hashes a `File` built from the
  serialized encrypted chunks, not the plaintext input.

## Reproduce

1. `npm run dev`, open `/crypto.html`.
2. Choose a JPEG phone photo with location data → Strip metadata → download the
   stripped file and check the OS details (location should be gone). In Node the
   unit test proves the same byte-level removal.
3. Choose a 20 MB video → Encrypt → Wrap key → Unwrap & decrypt → download and
   play it; it must match the original.
4. In the editable encrypted-data box change one character, then press Unwrap &
   decrypt. It must fail with a decryption error.
5. Run `npm test`; all crypto tests pass.

## Recorded status

- Steps 1–2: covered by `packages/crypto/src/strip.test.ts` (GPS JPEG through
  `stripImage`, checked with the independent EXIF reader). Browser download was
  exercised during development of M058.
- Step 3: covered by the 10 MB round-trip test and the existing multi-chunk
  tests; a 20 MB manual run was not repeated in this audit.
- Step 4: the editable box exists and the same parse/decrypt path is covered by
  the tamper tests in `packages/crypto/src/file.test.ts`.
- Step 5: `npm run check` passes.
