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