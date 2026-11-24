M001 | done | Monorepo created with npm workspaces, workspace folders, .gitignore and .nvmrc
M002 | done | TypeScript baseline with strict tsconfig.base.json and root typecheck script
M003 | done | ESLint, Prettier, Vitest, root lint/format/test/check scripts and shared smoke test
M004 | done | Shared constants, types and zod schemas implemented
M005 | done | Vite multi-page web app shell with Tailwind configured
M006 | done | Design system primitives and showcase page added
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
M033 | done | Added GET /api/events SSE hub with publish(event) broadcaster for id/type-only events
M034 | done | Added privacy.test.ts scanning server source for forbidden logging patterns and verifying logger redaction
M035 | done | Defined the LedgerAdapter interface and MembershipProof type in packages/chain with input/result types and zod schemas in packages/shared
M036 | done | Added migration 003_mock_ledger.sql with ml_leaves, ml_roots, ml_complaints, ml_nullifiers, ml_history and ml_notes; verified it applies cleanly on a fresh database
M037 | done | Implemented MockLedger (enrollCommitment with Merkle tree, ceiling enforcement and duplicate rejection; getLeaves; getRoots with 14-day grace window) in packages/chain, plus unit tests verifying 50 consistent enrollments and the 51st failing at ceiling 50
M038 | done | Implemented proveMembershipMock (client, packages/crypto) returning a kind:'mock' MembershipProof with Merkle path and context-derived nullifier, and verifyMembershipMock (server) checking grace-window root, Merkle path validity and nullifier uniqueness; MockLedger.verifyMembershipMock wraps it with DB state; unit tests cover valid proofs, forged proofs, unknown roots, reused nullifiers and tampered paths
M039 | done | Implemented MockLedger.fileComplaint: verifies membership proof, rejects reused filing nullifier (2 slots per month enforced by nullifier uniqueness), assigns sequential id, sets deadlineAt from urgency (DEMO_SLA_SECONDS override), stores record with status not_started, writes first history row, returns id; ownerRole set to ugc when staffInvolved; unit tests cover valid filing, duplicate nullifier rejection, two-slot monthly limit, invalid proof, and staff-involved owner role
M040 | done | Implemented MockLedger.supportComplaint: verifies membership proof, checks proof university matches complaint university, rejects reused support nullifier, increments supportCount atomically, publishes complaint.supported event; optional publish callback in constructor; unit tests cover valid support, duplicate nullifier rejection, and other-university rejection
M041 | done | Implemented MockLedger.updateStatus: enforces owner-role ownership (university cannot touch UGC-owned complaints), forward-only transitions (not_started -> pending_investigation -> finished), finished requires non-empty outcomeHash, appends history row, stores outcomeHash, publishes complaint.status event; unit tests cover valid transitions, skipping states, backwards movement, missing outcome, wrong owner role, and non-existent complaint
