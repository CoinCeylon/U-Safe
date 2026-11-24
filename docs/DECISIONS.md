# U-Safe Decisions

Record package names, versions and adaptations here.

- Node.js 20 LTS (`.nvmrc`).
- Fastify 5 for the server, `@fastify/cors` for CORS.
- better-sqlite3 for SQLite.
- tsx for running TypeScript server code in development.
- concurrently for running server + web in `npm run dev`.
- Vite proxies `/api` to `http://127.0.0.1:3000` in development.
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
