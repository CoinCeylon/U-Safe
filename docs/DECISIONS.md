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