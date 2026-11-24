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
