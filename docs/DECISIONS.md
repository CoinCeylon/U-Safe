# U-Safe Decisions

Record package names, versions and adaptations here.

- Node.js 20 LTS (`.nvmrc`).
- Fastify 5 for the server, `@fastify/cors` for CORS.
- better-sqlite3 for SQLite.
- tsx for running TypeScript server code in development.
- concurrently for running server + web in `npm run dev`.
- Vite proxies `/api` to `http://127.0.0.1:3000` in development.
- Mesh SDK `@meshsdk/core` ^1.9.1 for the Lace (CIP-30 / CIP-8) wallet integration:
  `BrowserWallet.getInstalledWallets()`, `BrowserWallet.enable('lace')`,
  `browserWallet.signData(payload, address?)` returning `DataSignature { signature, key }`,
  and `browserWallet.getUsedAddresses()`. Lace wallet name is `lace`; install URL
  is `https://lace.dev/`.
- Mail: `nodemailer` ^6.9.16 with `@types/nodemailer` ^8.0.2; `MAIL_MODE=dev|smtp`
  selects `ConsoleMailer` or `SmtpMailer`. Dev messages go to `server/.dev-mailbox/`,
  which is git-ignored; the console prints only the OTP code and file path, never the
  recipient address.
- OTP codes are generated with `crypto.randomInt`, stored only as `sha256(salt + code)`
  and compared with `timingSafeEqual`. A successful verify deletes the row. Request
  limits are 5 per email hash and 30 per IP per 10 minutes; verify limits are
  `OTP_MAX_ATTEMPTS` per email hash and 30 per IP. Rate-limit keys use a salted hash of
  the IP, stay in memory, and are never logged. Mail failures are swallowed so the
  response cannot reveal roster membership.
- Enrollment tickets use a 24-byte random hex id and expire after
  `ENROLLMENT_TICKET_EXPIRY_MINUTES` (15). `TicketService.issue` runs only after a
  successful verify and returns only `{ ticket, universityId }`. `consume` burns the
  ticket with a conditional `UPDATE ... WHERE used = 0 AND expires_at > now`, so
  double use and expiry are both rejected; it returns `{ universityId, rosterId }` for
  the later enrollment milestone.
- `POST /api/enroll` runs the ticket burn, enrollment check and roster update in one
  SQLite transaction; errors roll the ticket back so it remains usable. The ceiling is
  the count of enrolled roster rows for the university. The commitment is never written
  to `roster`. `StubLedger` is an in-memory stand-in behind `EnrollmentLedger` until
  M035/M037 define the real adapter; it uses the same length-prefixed domain-separated
  SHA-256 as `@usafe/crypto`, so its paths verify with `MerkleTree.verify`. `communityKeyWrapped`
  currently returns `community_key_wrapped_for_ugc` as the only stored wrapped copy;
  M065 will replace this with the student-delivery wrapping.
- M043 overlaps M045 and M047: it adds only the university list path needed to redact
  staff-involved complaints and the status route needed for its HTTP 403 acceptance
  test. Student and UGC queries, the remaining complaint routes, and the CLI remain in
  M045 and M047. Staff ownership is derived from `staff.university_id`: a null
  university identifies UGC staff, while a non-null university identifies university
  staff. UGC-only payload sealing remains deferred to the portal work in M060.
- M044 stores the UGC demo public key on a single `staff` row (`role='ugc'`,
  `address='ugc-demo-officer'`, null university) and university public keys in
  `universities.public_key_jwk`. The student-delivery copy of each community key is
  stored in the new `universities.community_key_wrapped_for_delivery` column as a
  `SecureStore` backup encrypted with `COMMUNITY_DELIVERY_SECRET`. Existing
  passphrase-protected `.dev-keys` backups are reused, so a second seed run neither
  duplicates rows nor rotates complete demo key sets.
- M045 makes the mock ledger trust the caller-supplied viewer role and university id;
  M047's HTTP hooks will derive those fields from a student query or a staff session.
  Student and university viewers must supply a university id, while UGC viewers omit it to
  see all universities (or supply one for a focused query). `getHistory` remains visible
  for university viewers on staff-involved cases because it contains only status,
  timestamps, actor roles and note hashes allowed by specification section 7.3; the
  detailed complaint record is what gets redacted.
- M046 uses `null` as the API representation of `bucketCount`'s protected result. Portals
  will render that null as the phrase "fewer than 5". Small groups in every category,
  urgency and status breakdown are merged into an `other` bucket; if that merged bucket is
  itself below `MIN_GROUP_SIZE`, it is also null. Student and university scalar totals,
  overdue and staff-involved counts are protected the same way, while UGC viewers receive
  exact global totals and an exact `byUniversity` map plus bucketed breakdowns.
- M047 treats an unauthenticated complaint/list/stats reader as a student, who must supply
  `?university=`. A staff bearer token upgrades that viewer to the staff's university, or to
  UGC when the staff row has no university. The same `MockLedger` instance now backs HTTP
  enrollment and complaint routes. The reopen route is present but returns 501 until the
  reopen behaviour is implemented in M079. `npm run demo:cli` drives `MockLedger` directly
  against `DATABASE_PATH`, prints only non-sensitive demo output, and supports `--no-status`
  so the escalation job can demonstrate a deadline breach. `try:forge` is HTTP-only and
  expects 401; `try:duplicate` keeps its student secret in memory, stores only the commitment,
  files through HTTP, reuses one support proof, expects the second request to fail, and
  confirms the final count stays at 1. The demo CLI uses the leaf indexes returned by
  `enrollCommitment`, so it also works when a university already has earlier enrollments.
- M049 persists non-sensitive onboarding progress (step, university, email) in
  `sessionStorage` so the wizard resumes after a refresh. `SecureStore` is not used yet
  because it requires the student secret, which is derived in M051. Once the secret is
  available, the persisted progress moves into `SecureStore` (encrypted with the secret).
  Sensitive values (OTP code, wallet signature, student secret) are never persisted.

- Student portal blank page fix: `wallet.ts` no longer imports `@meshsdk/core` at module
  level. Mesh is loaded with a dynamic `import('@meshsdk/core')` on first use
  (`connect`, `isLaceInstalled`), because its dependencies reference Node built-ins and
  broke the whole portal module graph at page load. `isLaceInstalled()` is now async.
- Mesh's Node built-in imports (for example `pbkdf2Sync` from `crypto`) are provided by
  `vite-plugin-node-polyfills` ^0.28.0 (devDependency of `@usafe/web`) in `apps/web/vite.config.ts`.
  Without it the production build fails with `"pbkdf2Sync" is not exported by "__vite-browser-external"`.
- `vite` ^6.4.6 is a root devDependency because `vitest` 5 declares it as a peer, and
  `npm install` runs with `--legacy-peer-deps` (the `@types/node` peer conflict otherwise
  stops the install).
- `student/main.ts` starts the university request once at module load without awaiting
  it, and the Home route waits on that shared promise. The router renders a first visit
  twice (it sets the hash), and two identical requests in flight left one stuck in the
  browser, so the wizard never appeared. A top-level `await` was also removed; the portal
  renders at once and shows "Loading universities…" until the list arrives.
- `ui/toast.ts` mounts each toast itself in a fixed `#usafe-toast-host` on `document.body`
  and removes it after 6 s (only while it is still mounted there). The student wizard
  ignored the element `toast()` returned, so no wizard message was ever visible.
- M056 builds the support proof directly from the locally cached Merkle path in
  `CachedCredential`. `proveMembershipMock` requires a full leaf list, but the portal
  already refreshed that list locally in M053, so re-downloading it for every support
  would add traffic without adding privacy. The leaf index is never a separate field in
  the request body; it only appears inside the mock proof, which the server verifies
  and discards.
- Supported complaint ids are stored through `SecureStore` (IndexedDB, encrypted with
  the student secret), not `localStorage`. The university id is remembered in
  `sessionStorage` because it is non-sensitive and lets a reloaded portal ask the wallet
  to re-derive the secret.
- A support action is delayed with `SubmitQueue` for a random 2–12 seconds. A repeated
  support response (400/409 nullifier already used) is treated as a quiet success by
  the UI so a double click cannot appear as an error.
- `IndexedDbStorage.getStore()` returns the object store while the transaction is still
  active. Resolving it on `tx.oncomplete` made the store unusable and left enrolment
  stuck at "Saving your enrolment receipt…". The database is opened at its current
  version (not a hard-coded version 1); when another store already exists at that
  version, `openDb` upgrades once so enrolment and supported-id stores can share one
  database without a `VersionError`.
- M058 calls `stripImage` on images when they are added to the form. If the image is
  corrupt or canvas re-encoding fails, the original file is kept and the file is treated
  like a video/document: the metadata acknowledgement checkbox becomes required. A
  failed strip must not break the form or silently claim that metadata was removed.
- The enrolment wizard updates state in place on `input` events (`onChange(next, false)`)
  instead of rebuilding the step DOM. Rebuilding on every keystroke replaced the
  focused field and made students type only one character at a time. Navigation
  validity is refreshed separately; full re-renders remain only for step/status changes.
- M063 dev login: `POST /api/auth/dev-login` now prefers an explicit `staffId`
  from the dropdown and falls back to the older `{role, universityId}` form from
  M032. The new `GET /api/auth/dev-accounts` (both gated on `DEV_LOGIN=true`)
  lists seeded staff rows joined with university names; `/api/health` reports a
  `devLogin` flag so the portal shows the red "development login" section only
  when the server enables it. `npm run seed` seeds one registrar, one
  investigator and one admin per demo university with placeholder addresses
  (`dev-<role>-<university>`), idempotently by address check. The staff session
  token lives in `sessionStorage` only. Role guards are client-side route rules
  in `university/roles.ts` (`/complaints` investigator+admin, `/roster`
  registrar+admin, `/keys` all roles since M064, because investigators must
  load the university private key before complaint pages open) verified by
  unit tests; server-side route authorization continues to use the M032
  `requireStaff` hook.
- The root `node_modules/vite` had drifted to 8.3.8 while the lockfile pins
  6.4.6, which broke `tsc -p apps/web`. `npm ci` restored the locked tree
  (`npm install` needs `--legacy-peer-deps`, see above).
- M064 stores the university private key as a passphrase-encrypted backup blob
  (`SecureStore.exportBackup`, PBKDF2 100k + AES-256-GCM) in the IndexedDB
  backend of the secure store, not as a `SecureStore` entry keyed by a secret:
  staff have no student secret to derive a storage key from, and the blob is
  already encrypted at rest. The in-memory imported `CryptoKey` is cleared on
  every page refresh, so the portal always asks for the passphrase again; a
  wrong passphrase fails the GCM authentication. The import flow accepts the
  exact `.dev-keys/university-<id>.json` files from `npm run seed:keys`
  (passphrase `demo`). `PUT /api/university/:id/public-key` requires a staff
  session of that university, validates that the JWK is an RSA public key
  without private components, and stores it in
  `universities.public_key_jwk`.
- M065 community key delivery: the admin browser generates a 32-byte AES key with
  `generateCommunityKey`, wraps it for the UGC RSA public key with
  `wrapAesKeyBytes`, and posts `{ wrappedForUgc, communityKey }` as base64 to
  `POST /api/university/:id/community-key`. The server never writes the raw key
  to SQLite: it stores the UGC copy in `community_key_wrapped_for_ugc` and a
  student-delivery copy in `community_key_wrapped_for_delivery`, produced with
  `SecureStore.exportBackup({communityKey}, COMMUNITY_DELIVERY_SECRET)`. The
  endpoint and the metadata `GET` are admin-only and scoped to the admin's own
  university; the UGC public key is read from the seeded `staff` row with no
  university.
- `POST /api/enroll` now returns `communityKey` (base64 raw AES-256) instead of
  the old `communityKeyWrapped`, because the M044 UGC-wrapped copy cannot be
  opened by a student. `EnrollmentService` unwraps the delivery copy at
  enrollment time. When `COMMUNITY_DELIVERY_SECRET` is unset (tests, a server
  without demo keys) enrollment still succeeds and `communityKey` is `null`.
  This replaces the M029/M052 placeholder noted earlier; complaint payload
  reading itself remains M060/M067 work, and the M065 server test verifies the
  delivered key opens a sealed payload.
- The academic year label uses a July boundary (`July 2026 -> 2026/2027`) and is
  recorded by the server when the key is created, alongside an ISO creation
  timestamp in the new `community_key_created_at` and
  `community_key_academic_year` columns. Creating another key replaces the
  current one; the UI warns that a backup of the previous key is needed if older
  complaints must stay readable. The browser keeps its encrypted backup in the
  `usafe-university` IndexedDB database under `communityKeyBackup:<id>` and can
  re-download it.
