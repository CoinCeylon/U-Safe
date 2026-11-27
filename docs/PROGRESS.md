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
M042 | done | Implemented MockLedger.markEscalated: escalates complaints that are not_started, not already escalated, and past their deadline; appends a history row with actor 'system' and publishes complaint.escalated event; idempotent; server-side escalation job (server/src/services/escalation.ts) runs once at startup and every 10 seconds, wired into server startup/shutdown; unit tests cover before-deadline (no-op), after-deadline (escalated), idempotency, event publishing, and non-existent complaint
M043 | done | Staff-involved complaints are marked and owned by the UGC, university lists redact them to id/date/category/support count/status, and the staff status route returns 403 when university staff attempt to update a UGC-owned complaint
M044 | done | Development-only demo key seeding creates university and UGC RSA key pairs, passphrase-protected `.dev-keys` backups, per-university community keys, UGC-wrapped and delivery-wrapped community key storage, with idempotent reruns and import tests
M045 | done | Role-aware MockLedger queries implemented for listComplaints, getComplaint, getHistory and getStats; students and universities are scoped to a university, UGC sees all, and staff-involved records are redacted for university detail/list responses
M046 | done | Small-group protection applied to stats totals and category/urgency/status breakdowns, with sub-five groups merged into other, protected counts returned as null, and UGC receiving exact per-university totals
M047 | done | Mock-ledger HTTP routes wired for enrollment proofs, complaint filing/support/status/reopen, role-aware lists/details/stats and university leaves/roots; npm run demo:cli completes the five-student flow with supportCount 4 and status finished even on an existing database, while try:forge and try:duplicate complete Human Test 4's forged-proof and duplicate-support checks
M048 | done | Landing page with plain-language explanation, three portal buttons (Student, University, UGC) and a mock-mode banner that appears only when the server reports mock mode.
M049 | done | Student onboarding wizard with four steps (university/email, OTP code, connect wallet, finish), forward/back navigation, privacy explanation on step 1, and sessionStorage resumption after refresh.
M050 | done | Wallet connection module with Mesh SDK BrowserWallet for Lace (CIP-30 signData) plus a dev FakeWallet (deterministic HMAC-SHA256 from a passphrase, ?fakewallet=1); unit tests verify deterministic signatures.
M051 | done | Secret derivation step: unlockStudent signs `U-Safe student secret v1|<universityId>` via the wallet, derives the 32-byte secret with HKDF-SHA256, holds it in memory only, and can compute the public commitment; re-unlocking is deterministic.
M052 | done | Enrollment completion: step 4 unlocks the secret, computes the commitment, calls POST /api/enroll with the ticket, persists the receipt in SecureStore (IndexedDB), and shows a success screen with friendly ceiling/ticket-error messages.

M053 | done | Credential refresh (MerkleTree credential computation)

M054 | done | Community feed page with SSE live updates, complaint cards, filters, and sorting

M055 | done | Complaint detail page with full description, status timeline, and outcome message

M056 | done | Anonymous support flow: unlock on demand, locally built mock proof, 2–12 s queued submission, optimistic count, quiet duplicate handling, and encrypted local support state

M057 | done | File complaint form with 40–4000 character validation, category, urgency, staff-involved toggle, optional accused details, privacy guidance and filing slots

M058 | done | Evidence attachment picker with up to 5 files, 25 MB each, previews, metadata stripping for images, metadata acknowledgement, and clear rejection messages
M059 | done | Duplicate suggestions: browser-side token-overlap comparison of the typed description with open same-university complaints (threshold 0.5, top 3) surfacing a "Support this one instead" link, with complaint text cached locally in complaint-text.ts until M060/M065 make sealed payload text readable
M060 | done | Submission pipeline with a visible eight-step progress list: encrypted evidence blobs, per-file keys wrapped for the university/UGC, payload sealed with the community key (or a per-complaint UGC-only key when staff are involved), filing-nullifier slot fallback, queued anonymous submission, retry without duplicate uploads, and encrypted local receipts, backed by new community-key delivery and UGC public-key routes
M061 | done | Receipts now carry each per-file key (the student's copy) and the last observed status; the My complaints page lists filed complaints from local receipts only, refreshes statuses live via SSE plus the public complaint endpoint, re-downloads evidence with hash verification, and documents that clearing site data removes the list permanently
M062 | done | Student polish: configurable HELPLINES constant, offline-aware friendly errors with retry (feed reload with SSE reconnect, support, submissions, downloads, wizard), a static Help page with anonymity explanation and emergency guidance, a skip-to-content link, global keyboard focus outlines, online/offline toasts, and friendlier empty/error states

## Audit corrections (2026-11-25)

M001 | fixed | `.aiken/` added to `.gitignore` and a repository test asserts all required ignore patterns
M006 | fixed | showcase test asserts every primitive is exported and rendered and that the page declares a phone viewport; see `docs/DESIGN_SYSTEM_REPORT.md`
M014 | fixed | dedicated zero-node domain tag, `root()` alias, depth-checked `verify` with a two-leaf and empty-path test
M015 | fixed | a real 10 MB encrypt/decrypt round-trip test
M017 | fixed | `sealPayload` hashes the exact sealed bytes and the test recomputes it from stored bytes
M018 | fixed | canvas-less JPEG fallback plus a GPS-EXIF `stripImage` test verified by the byte-level reader
M019 | fixed | playground hashes encrypted bytes and fixed-vector/encrypted-byte tests were added
M020 | partial | reload is tested over a shared backend; real IndexedDB persistence remains a browser human test
M022 | fixed | editable ciphertext box feeds decryption; report in `docs/HUMAN_TEST_2_REPORT.md`
M025 | fixed | roster route is staff-only and 100-row/per-line-error tests were added
M029 | fixed | prepare/commit keeps ticket burn, ceiling, roster and ledger writes in one transaction with a rollback test
M032 | fixed | POST challenge, single-use nonce, Mesh `checkSignature`, replay/expiry/rejection tests
M038 | fixed | commitment+context-bound nullifiers, fixed-depth path, server-side leaf lookup, forged empty-path test
M039 | fixed | sequential ids from a database sequence inside the insert transaction
M040 | fixed | university binding through the verified leaf list and context/complaint id match
M048 | fixed | mock banner lives in the shared frame and is driven by `/api/health`; landing banner bug removed
M050 | partial | fake-wallet passphrase field added; Lace determinism still needs a real-wallet human test
M053 | fixed | leaf index removed from proofs; `watchRoots` wired into the feed
M054 | fixed | feed decrypts sealed descriptions and `complaint.created` is published
M055 | fixed | detail decrypts descriptions and outcomes; all four state summaries are tested
M057 | fixed | slots come from `FILING_LIMIT_PER_MONTH` and local receipts, never a hardcoded 3
M059 | fixed | feed/detail decryption feeds the local duplicate corpus
M060 | partial | all three portals show a shared complaint overview and the pipeline test uses two images plus one video; full role portals remain M063+/M073+
M062 | partial | keyboard/accessibility evidence recorded in `docs/ACCESSIBILITY_REPORT.md`; no automated axe run
M063 | done | University staff login with CIP-8 wallet sign-in and dev dropdown, sessionStorage token, seeded registrar/investigator/admin accounts, role-guarded routes, logout and access-denied views
M064 | done | Role key setup: import a .dev-keys backup or generate an RSA-OAEP pair, passphrase-protected storage in IndexedDB, mandatory backup download, PUT /api/university/:id/public-key registration, complaint pages blocked until the key is unlocked
M065 | done | Admin-only Community key screen creates an AES-256 key in the browser, wraps it for the UGC public key, stores a passphrase-protected local backup, posts both copies to the server (delivery copy wrapped under COMMUNITY_DELIVERY_SECRET), and enrollment now delivers the raw community key to newly enrolled students
