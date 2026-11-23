M007 | done | Hash router and portal frame added for all portals
M008 | done | Fastify server skeleton with health endpoint and graceful shutdown
M009 | done | SQLite database with migration runner and 001_init
M010 | done | Root dev orchestration, Vite /api proxy, and project docs
M011 | done | Hash adapter: domain-separated Sha256Adapter with length-prefixed parts, setHashAdapter swap, and unit tests
M012 | done | Student secret derivation via HKDF-SHA256 over a wallet signature (fixed message `U-Safe student secret v1|<universityId>`) with unit tests
M013 | done | Commitments and nullifiers: commitment, supportNullifier, filingNullifier (slots 0/1), inboxKey, each with distinct domain tags; cross-value separation tests
M014 | done | Merkle tree: depth-20 incremental tree with insert, root, proof, static verify; zero-node precomputation; domain-separated inner hashing; tests for 1, 2, 1000 leaves and tampered/wrong proofs
M015 | done | File encryption: AES-256-GCM encryptBytes/decryptBytes (random 96-bit IV prepended), deriveFileKey, encryptFile/decryptFile with 1 MB chunking each with own IV+auth tag; tests include multi-chunk round-trip, tampered byte rejection, wrong-key rejection, out-of-order chunks
M016 | done | Role keypairs and key wrapping: RSA-OAEP 2048 (SHA-256) key pair generation, JWK export/import, wrapKey(aesKey, publicKey), unwrapKey(wrapped, privateKey); wrong private key and tampered wrapped key both rejected
M017 | done | Community key and payload encryption: generateCommunityKey() (AES-256), sealPayload(payload, key) and openPayload(sealed, key) using AES-256-GCM with plain SHA-256 integrity hash; tampering fails and hash matches stored bytes
M018 | done | Image metadata stripping: stripImage(file) re-encodes JPEG/PNG/WebP on canvas (OffscreenCanvas/createImageBitmap), returns stripped File or {file, stripped:false} for non-images/Node; pure JPEG EXIF helpers: hasExifSegment, hasGpsExif, stripExifFromJpegBytes (little-endian TIFF parsing)
M019 | done | Streaming file hash: hashFile(file) reads in 1 MB chunks and returns plain SHA-256 matching sha256sum; used as evidence identifier
M020 | done | Secure local storage: SecureStore class with put/get/delete, values AES-256-GCM encrypted with key derived from student secret; MemoryStorage and IndexedDbStorage backends; exportBackup/importBackup with PBKDF2 + AES-GCM passphrase protection; wrong passphrase and tampering rejected
M021 | done | Anonymity helpers: randomDelayMs(min, max) using crypto.getRandomValues; SubmitQueue class (FIFO, random delay per item, serialize submissions); bucketCount(count, minGroup) returns null below minGroup for small-group protection
M022 | done | Crypto playground page (apps/web/src/dev/crypto.html + crypto.ts): choose file → strip metadata → encrypt (AES-256-GCM, 1 MB chunks) → show SHA-256 hash → wrap AES key with RSA-OAEP 2048 → unwrap & decrypt → download decrypted file; bonus: community key seal/unseal, bucketCount edge cases
M023 | done | Core database schema added via migration 002_core.sql with universities, roster, otp, tickets, blobs, staff, sessions and events tables (emails stored only as salted hashes)
M024 | done | University registry service with create/list/get, GET /api/universities and GET /api/universities/:id routes, plus seed script creating three demo universities
M025 | done | Roster import endpoint POST /api/university/:id/roster parsing CSV, validating emails and domains, rejecting duplicates, storing salted email hashes with per-row error reporting
M026 | done | Mailer interface with ConsoleMailer (writes to git-ignored server/.dev-mailbox, prints only code/path) and SmtpMailer (nodemailer), selected by MAIL_MODE, with tests and .env.example
M027 | done | OTP request/verify routes with hash-only code storage, constant-time comparison, attempt locking, expiry, generic responses and in-memory email/IP rate limits, with tests
M028 | done | Successful verify issues a single-use 15-minute enrollment ticket returned as {ticket, universityId}; atomic consume rejects reuse and expiry, with tests
M029 | done | POST /api/enroll burns the ticket transactionally, checks ceiling, enrolls via a stub ledger and returns leaf index/path/root plus wrapped key without storing the commitment beside the roster row, with tests
M030 | done | Evidence blob store added with POST /api/blobs and GET /api/blobs/:hash, SHA-256 verification, content-type enforcement, 25 MB limit, and disk storage under server/data/blobs
M031 | done | Added requireEnrollmentProof Fastify guard that requires a proof object in the request body and delegates verification to the ledger adapter (stub), returning 401 when missing
M032 | done | Staff auth added with challenge, signature-based login, hashed sessions, requireStaff hook, and DEV_LOGIN dev-login route
