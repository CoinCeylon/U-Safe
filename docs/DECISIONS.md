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
- `vite` ^6.4.6 is a root devDependency because Vitest declares it as a peer. Vitest is
  ^4.1.12 rather than 5: Vitest 5's optional `@types/node` peer requires `^22 || >=24`,
  which conflicts with the locked Node.js 20 types (`@types/node` ^20.19.43) and makes a
  plain `npm install` fail with ERESOLVE. Vitest 4 accepts `@types/node` ^20 and Node 20,
  so `npm install` succeeds with no flags or `--legacy-peer-deps`.
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
- M059 must compare a new description with "the open complaints of the same university"
  in the browser, but at this point no description text is readable anywhere: the server
  may never hold plaintext complaint text (locked rule), sealed payloads arrive with the
  M060 submission pipeline, and community-key delivery to students is M065. The chosen
  design keeps the real engine and UI now and a clearly-marked corpus source: the
  comparison runs against descriptions the portal has legitimately read, kept in a
  per-university localStorage cache (`complaint-text.ts`, max 30 entries, finished and
  UGC-owned complaints excluded). M060 should cache the student's own filed text and the
  community-key feed work should cache decrypted text by calling `rememberComplaintText`;
  the suggestion box lights up as soon as those writers exist. The score is the Jaccard
  token overlap after stopword removal; matches must be strictly above 0.5, at most three
  are shown, and "Support this one instead" links to the existing complaint detail page
  (the full support flow of M056 already lives there) rather than re-implementing the
  queued support submission inside the form. Suggestions update debounced (600 ms) while
  typing and once more at submit; they never block filing, because a similar complaint
  can still be a distinct incident.
- The enrolment wizard updates state in place on `input` events (`onChange(next, false)`)
  instead of rebuilding the step DOM. Rebuilding on every keystroke replaced the
  focused field and made students type only one character at a time. Navigation
  validity is refreshed separately; full re-renders remain only for step/status changes.
- M060 adds the community-key delivery route `POST /api/universities/:id/community-key`
  (behind `requireEnrollmentProof`) and `GET /api/ugc/public-key`. The delivery route
  unwraps `universities.community_key_wrapped_for_delivery` with
  `COMMUNITY_DELIVERY_SECRET` (added to the server config) and returns the raw key over
  TLS, matching the documented limitation that "students receive the community key from
  the server". M065's key-creation flow will keep feeding the same column, so this route
  stays unchanged then. The delivery request uses a mock membership proof with context
  `support|community-key-delivery` (nullifier bound to that fixed pseudo id): the server
  verifies membership and discards the proof, so no filing or support slot is consumed.
- The sealed payload blob is a small JSON envelope (`apps/web/src/lib/sealedEnvelope.ts`)
  with `kind` `community` (open with the university community key) or `ugc-only`
  (staff-involved). The ledger's `payloadHash`/`payloadLocator` are the SHA-256 of the
  envelope bytes. The "UGC-only key" of M043/M078 is a fresh random AES-256 key the
  complainant's browser generates per complaint; its copy wrapped for the UGC public key
  rides inside the envelope as `sealedKeyWrapped`, so only the UGC can ever read the
  payload. This keeps the UGC portal (M078) implementable without any new delivery
  channel.
- Staff-involved evidence per-file keys are wrapped for the UGC public key only, not the
  university's, because specification section 6 (staff involvement) states such evidence
  "is encrypted for the UGC only" and M066 never gives university staff a detail view of
  these complaints. Normal complaints wrap each file key for both the university and UGC
  public keys. The M060 milestone text is ambiguous here; the specification resolves it.
- Encrypted evidence blobs use a small binary framing (`serializeEncryptedChunks` in
  `@usafe/crypto`): magic `USF1`, a little-endian chunk count, then per chunk a length
  prefix and `iv || ciphertext`. This keeps the 1 MB chunking of `encryptFile` intact so
  M067 can decrypt streamed, chunk by chunk.
- The submission pipeline (`apps/web/src/student/submit.ts`) keeps encrypted artifacts
  and uploaded blob hashes per pipeline instance, so a retry resumes from the failed step
  and never re-uploads a blob. Known edge case, accepted for mock mode: if the filing
  request reaches the ledger but the response is lost, a retry burns the second monthly
  slot and can create a second complaint, because the client cannot know the first
  filing succeeded. The two-slot monthly limit still prevents a third copy.
- Filing receipts are stored through `SecureStore` (IndexedDB, encrypted with the
  student secret) in `apps/web/src/student/filings.ts`; M061 builds the "My complaints"
  page on top of them. Non-staff-involved filed descriptions also feed the M059
  duplicate-suggestion cache via `rememberComplaintText`; staff-involved text never
  does.
- M061's "per-file keys wrapped for the student themselves" are stored as raw base64
  keys inside the receipt: `SecureStore` already encrypts every stored value with a
  key derived from the student secret, and an extra AES wrap with the same root
  secret would add no security. Only the receipts page can read them, and only
  after the wallet re-derives the secret.
- The My complaints page (`my-complaints.ts`) builds its list from local receipts
  only; nothing on the page is stored or sent anywhere new. Statuses refresh through
  the same public, proof-less `GET /api/complaints/:id?university=` endpoint the feed
  and detail pages already use (no student identity is attached), triggered once on
  load and then by `/api/events` SSE messages for receipt ids; the last observed
  status is written back into the receipt so a reload starts from the latest state.
  Evidence re-download (`evidenceDownload.ts`) reads blobs by their public hash,
  verifies the SHA-256 against the receipt before decrypting, and shows
  "Integrity verified" on success. The page states clearly that clearing site data
  removes the receipts permanently and restoring the wallet does not bring them back.
- M062's helpline list lives in `packages/shared` as `HELPLINES` (overridable with the
  `HELPLINES` environment variable, a JSON array of `{name, phone, description?}`).
  It defaults to an **empty** list on purpose: no unverified phone number is ever
  shown to a student. The help page renders generic emergency guidance (campus
  security / police, 119 in Sri Lanka) that is correct without configuration, plus
  a "no helplines configured yet" note when the list is empty.
- Offline detection (M062, `apps/web/src/lib/offline.ts`) treats a `TypeError` from
  `fetch` or `navigator.onLine === false` as "offline" and shows one friendly
  message with a retry path: the feed error state has a Try again button that also
  reconnects the SSE stream (which is closed on error instead of silently dying),
  support clicks and wizard steps show offline wording, and the submission pipeline
  keeps the failed step's cause on `StepError` so its retry screen can say the
  network was the problem. The student portal also shows toasts on browser
  offline/online events.
- Accessibility (M062): a global `:focus-visible` outline lives in
  `styles/app.css` (Tailwind's reset removes browser defaults), and the shared
  `ui/frame.ts` gained a "Skip to main content" link plus a focusable `main`
  landmark — every portal using the frame gets both. All student controls are
  native elements (buttons, links, inputs, selects, radios with labels), the only
  `img` (evidence preview) has alt text, the spinner is `aria-hidden` with a
  screen-reader label, toasts announce through `aria-live="polite"`, and dynamic
  progress areas use `role="status"`. The help page is fully static, so it works
  with no network at all.

## Audit fixes (2026-11-25)

These entries record the changes made in response to the M001-M062 audit. The
fixing agent did not commit anything; all changes are left for human review.

- **M014:** zero-node precomputation now uses its own `merkle-zero` domain tag,
  distinct from `merkle-inner`. `MerkleTree.root()` is an alias for `getRoot()`.
  `MerkleTree.verify(leaf, proof, index, root, adapter, expectedDepth)` now
  rejects any proof whose length is not the expected tree depth; the default is
  `MERKLE_TREE_DEPTH` (20). Tests cover a valid two-leaf proof and an empty-path
  forgery.
- **M017:** `sealPayload` now returns the SHA-256 of the exact sealed bytes
  (`iv || ciphertext`), not the plaintext JSON hash, and `openPayload` verifies
  that hash before decrypting. The test recomputes the digest from the stored
  sealed bytes and asserts it is not the plaintext hash.
- **M018:** when no canvas is available (Node/tests), `stripImage` now removes
  the JPEG APP1 EXIF segment byte-for-byte instead of giving up. A GPS-tagged
  JPEG fixture is run through `stripImage` and checked with the independent
  byte-level EXIF reader. PNG/WebP still rely on the browser canvas path and are
  covered by the recorded human test.
- **M019:** the crypto playground hashes a `File` built from the serialized
  encrypted chunks, and the label now correctly says "SHA-256 of encrypted
  bytes". A fixed SHA-256 vector test (`abc`) and an encrypted-bytes test were
  added.
- **M020:** a reload is modelled by constructing a second `SecureStore` over the
  same storage backend; the value decrypts. Real IndexedDB persistence is still
  browser-only and is covered by the human test report; the unit suite does not
  include a fake IndexedDB implementation.
- **M022:** the playground now has an editable ciphertext textarea. Decryption
  parses the edited hex, so changing one character produces an error (Human Test
  2, step 4). The report is in `docs/HUMAN_TEST_2_REPORT.md`.
- **M025:** `POST /api/university/:id/roster` now runs behind
  `requireStaff(['registrar', 'admin'])`. `requireStaff` accepts a single role
  or an array. Tests cover an unauthenticated rejection, a 100-row import and
  per-line error reporting.
- **M029:** `MockLedger.prepareEnrollment` computes the leaf/path/root without
  writing; `EnrollmentService` then burns the ticket, checks the ceiling, writes
  the leaf/root and marks the roster row in one synchronous SQLite transaction.
  The ticket is peeked (not consumed) only to prepare the ledger. A
  failure-injection test proves that a ledger commit error rolls back the ticket
  and roster row. The old synchronous `StubLedger` test double has no
  `prepareEnrollment`; when it is used the ledger call remains a fallback after
  the transaction, but production (`server/src/index.ts`) always uses
  `MockLedger` and therefore the single-transaction path.
- **M032:** `POST /api/auth/challenge` issues a single-use, five-minute nonce
  kept in memory only. `POST /api/auth/login` consumes it and verifies the CIP-8
  `signData` signature with Mesh's `checkSignature` against the staff wallet
  address. The old `GET` challenge route is gone. Tests cover a wrong signature,
  replay, expiry and `requireStaff` rejection. A full happy-path Lace signature
  still requires a real wallet and is a human test.
- **M038:** mock nullifiers are now derived from the **public commitment** and
  the proof context (`mockNullifier`, tag `mock-nullifier`), so the server can
  recompute them without the student secret. Verification requires exactly
  `MERKLE_TREE_DEPTH` siblings, recomputes the nullifier, rejects unsupported
  contexts and rejects any unbound/fabricated nullifier. The leaf index is no
  longer in the proof; the server looks it up in the public leaf list, which
  also binds the commitment to the claimed university. `try:forge` now also
  sends a real-root/empty-path proof.
- **M039:** complaint ids come from `ml_complaint_sequence` (migration 005)
  inside the insert transaction, giving `c-000001`, `c-000002`, ... instead of
  timestamps. The existing two-slot nullifier rule still enforces the monthly
  limit.
- **M040:** support verification resolves the commitment in the complaint
  university's leaf list, so a caller cannot claim another university's proof.
  The support context id must equal the route's complaint id, and the reused
  support nullifier is rejected with the specific message before proof
  verification so the UI can treat it quietly.
- **M048 / AGENT.md section 6:** the mock banner now lives in the shared
  `ui/frame.ts` and is revealed when `/api/health` reports `mock`. The landing
  page no longer clones a hidden banner, so it appears after health resolves.
  All portals use the frame. The visibility predicate is unit-tested.
- **M050:** the fake-wallet wizard step now has a passphrase field, requires it
  before connecting, and passes it to `connectWallet`. The passphrase stays in
  memory. Lace determinism comes from CIP-8/Ed25519 and still needs a real wallet
  for end-to-end verification.
- **M053:** `leafIndex` was removed from `MockProofData`; the client still keeps
  it locally to build the path, but never sends it. `watchRoots` is wired into
  the feed and refreshes the local credential when the root changes.
- **M054/M055:** the feed and detail pages download the sealed payload blob by
  its `payloadHash`, open it with the community key, and render the description.
  Finished complaints decrypt the outcome blob. `ugc-only` envelopes show the
  UGC-restricted message. Plaintext read by the feed/detail page feeds the M059
  cache. `MockLedger.fileComplaint` publishes `complaint.created`.
- **M057:** the form imports `FILING_LIMIT_PER_MONTH` and derives remaining slots
  from local receipts for the current month (`countFilingsInMonth`), disabling
  submit at zero. It no longer hardcodes 3.
- **M059:** feed and detail decryption call `rememberComplaintText`, so text
  read in one view is available to the duplicate checker. The form still never
  blocks filing on a suggestion.
- **M060:** the university and UGC portals now render a shared, read-only
  complaint overview (`lib/complaintOverview.ts`) instead of placeholders, so a
  newly filed complaint is visible on all three portals with its support count.
  The end-to-end pipeline test now uses two images and one video.
- **Privacy logging:** the `onResponse` hook logs only the pathname (query
  strings removed), status and duration; startup logs only the chain mode. The
  privacy test asserts both.
- **Constants:** `CATEGORIES`, `URGENCIES`, `STATUSES`,
  `NORMAL_DEADLINE_SECONDS` and `URGENT_DEADLINE_SECONDS` are now
  environment-overridable, with the locked values as defaults. `.env.example`
  documents them. Enum overrides are restricted to the known values so zod
  schemas stay valid.
- **M001:** `.aiken/` was added to `.gitignore`; a repository test asserts every
  required ignore pattern.
- **CC-1:** the Tailwind CDN script was removed from `apps/web/crypto.html`; the
  playground imports the self-hosted stylesheet.

## Human Test 5 loop fixes (2026-11-25)

- `apps/web/vite.config.ts` reads `VITE_API_TARGET` so an isolated harness can
  run its own API port and two web origins without changing the default proxy.
  The default remains `http://127.0.0.1:3000`.
- The fake wallet remembers its passphrase in `sessionStorage`
  (`usafe-dev-fake-wallet-passphrase`, development only). `unlockStudent` calls
  `connectWallet()` without options after a refresh, so without this it silently
  fell back to the default passphrase and derived a different commitment.
  `clearFakeWalletSession()` removes it when the wizard starts over.
- `SubmissionPipeline` binds its `fetch` implementation. Calling an unbound
  `window.fetch` as `this.fetchImpl(...)` throws `Illegal invocation` in
  browsers; Node's fetch is forgiving, which is why the unit tests missed it.
- `renderFeed` and `renderDetail` rebuild an empty in-memory credential via
  `refreshCredential()` instead of showing a "not ready" message after a fresh
  enrolment or a module reload.
- The full 10-round run and exact commands are recorded in
  `docs/HUMAN_TEST_5_REPORT.md`.

## Community-key delivery fix (2026-11-26)

- The submission pipeline failed at "Seal the complaint payload" with HTTP 503
  when the dev server was started without `COMMUNITY_DELIVERY_SECRET` in that
  terminal. The repository never loaded `.env`, even though `.env.example`
  documented the variable.
- `dotenv` ^18.0.10 is now a runtime dependency. `server/src/env.ts` loads a
  git-ignored `.env` from both `INIT_CWD` (npm workspace invocation root) and
  the current directory. It is imported by `server/src/config.ts` and by every
  root/server script that reads `process.env` directly. Explicit inline
  environment variables still win because dotenv does not overwrite them.
- A local `.env` was created from the dev defaults with
  `COMMUNITY_DELIVERY_SECRET=change-me-dev-delivery-secret`, matching the
  existing seeded key backups. It is git-ignored.
- `.env.example` now uses `EMAIL_HASH_SALT=dev-email-hash-salt` (the same value
  as the server default) and explains that `DATABASE_PATH` should be left unset
  for the seeded dev database. The previous example values silently created a
  second database for root-level scripts and mismatched existing roster hashes.
- `getCommunityKey()` now includes the server's JSON `error` message in the
  progress-step failure instead of the misleading generic "ask your university
  to create one" text.
