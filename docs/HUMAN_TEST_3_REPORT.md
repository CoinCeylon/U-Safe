# Human Test 3: Backend — Execution Report

All 10 iterations passed.

## Environment
- Node 20 via nvm
- Server: `npm run dev -w server` (port 3000)
- Fresh SQLite DB per iteration: `server/data/usafe.db`
- Seeded universities: moratuwa, peradeniya, colombo

## Steps performed

1. Start server + seed
   - `npm run seed -w server`
   - `npm run seed:roster -- moratuwa roster.csv`
   - Verify `GET /api/health` returns `{ ok: true, mode: "mock" }`
   - Verify `GET /api/universities` returns 3 universities

2. Roster import
   - CSV: `roster.csv` with 5 rows on `mrt.ac.lk`
   - `npm run seed:roster -- moratuwa roster.csv`
   - Verified 5 accepted, 0 rejected
   - DB check: roster has only `email_hash` (64-char hex, no `@`), no `commitment`/`email` columns

3. OTP request + verify
   - `npm run try:otp -- student1@mrt.ac.lk`
   - Script requests OTP, reads newest `server/.dev-mailbox/*.txt`, extracts 6-digit code, verifies
   - Result: enrollment ticket issued (`ticket`, `universityId`)

4. OTP reuse rejection
   - Re-verify the same code
   - Result: `{ "ok": false }`

5. OTP lock after 5 wrong codes
   - Request OTP for `student2@mrt.ac.lk`
   - Submit `000000` five times
   - Verify correct code is rejected (HTTP 429/invalid)

6. Blob round trip
   - `npm run try:blob`
   - Uploads generated file to `POST /api/blobs`, downloads via `GET /api/blobs/:hash`
   - Verified downloaded bytes equal uploaded bytes

7. Live events
   - `npm run try:event`
   - Publishes test event via `POST /api/events/publish`
   - SSE clients on `GET /api/events` receive `{ type, id }` only

## Result
10/10 iterations passed. No failures.
