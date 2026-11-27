# U-Safe Full-Scale Test Script (M001–M065)

This document is a complete, repeatable test plan for the U-Safe project as it
exists through **milestone M065**. It covers:

- clean-room setup and seeding,
- automated typecheck/lint/unit tests,
- backend API and mock-ledger tests,
- student portal end-to-end tests,
- university login/key/community-key tests,
- UGC read-only overview tests,
- cross-portal live updates,
- privacy and security checks,
- failure/recovery and edge cases,
- responsive/accessibility checks,
- optional load/soak checks,
- a final acceptance checklist and report template.

> **Important scope note**
>
> At M065 the full university complaints dashboard, roster UI, status controls,
> UGC login, UGC actions and real Cardano/Midnight chains are **not built yet**
> (they belong to M066+ and Groups 8–10). This script therefore tests those
> behaviours at the **API** level where the backend exists, and marks the
> portal UI as “expected placeholder”. Do not report a failure for a feature
> that is explicitly listed as out of scope below.

---

## 1. What exists at M065

| Area | Status at M065 |
|---|---|
| Student portal | Full onboarding, wallet, feed, detail, support, filing, evidence, receipts, help |
| University portal | Login, role guards, key setup, community-key admin screen |
| University roster UI | Placeholder; use `npm run seed:roster` or the API |
| University complaints UI | Placeholder; use the API for status/history tests |
| UGC portal | Read-only complaint overview and `/about`; no login or actions |
| Mock ledger/API | Enrollment, filing, support, status, escalation, list/detail/history/stats |
| Real Cardano/Midnight | Not implemented yet |
| Reopen | API exists but intentionally returns 501 until M079 |

---

## 2. Test strategy

Run the suites in this order:

1. **Automated gate** — must be green before manual testing.
2. **Clean database** — remove all runtime data and re-seed.
3. **Backend/API** — health, registry, roster, OTP, tickets, enrollment, blobs, SSE, auth, complaints.
4. **Student portal** — the main user journey and every failure state.
5. **University portal** — login, role guards, keys, community key.
6. **UGC portal** — read-only overview.
7. **Cross-portal** — live updates and shared counts.
8. **Privacy/security** — SQL inspection, logs, network payloads.
9. **Resilience** — offline, duplicate, forged, oversized, missing keys, restart.
10. **Responsive/accessibility** — 375/768/1280, keyboard, axe.
11. **Load/soak** — optional but recommended before a demo.
12. **Final acceptance** — complete the checklist and archive evidence.

Each test has an ID (`ENV-01`, `API-03`, `STU-07`, etc.). Record pass/fail and
evidence in the report template at the end.

---

## 3. Prerequisites

### 3.1 Required tools

- Node.js 20 LTS (the repository has `.nvmrc` with `20`)
- npm 10+
- Git
- A modern browser (Chrome/Edge/Firefox/Safari)
- A second browser profile or a private window for multi-student tests
- Optional but recommended:
  - `sqlite3` CLI or DB Browser for SQLite
  - `jq` for API token extraction
  - `curl`
  - A phone or a 375px browser emulation
  - Lace wallet on Cardano preprod (for real-wallet tests only)
  - `ffmpeg`/`sips` if you want to generate test media

Verify:

```bash
node -v      # v20.x
npm -v       # 10.x+
git --version
```

If you use nvm:

```bash
nvm install 20
nvm use 20
```

### 3.2 Install dependencies

From the repository root:

```bash
npm ci
```

`npm ci` uses the committed lockfile. If it fails, do not use
`--legacy-peer-deps`; fix the environment first and record the error.

---

## 4. Clean-room environment setup

### 4.1 Create the environment file

```bash
cp .env.example .env
```

Edit `.env` and confirm at least:

```dotenv
NODE_ENV=development
PORT=3000
HOST=127.0.0.1
CHAIN_MODE=mock
DEV_LOGIN=true
WEB_ORIGIN=http://localhost:5173
COMMUNITY_DELIVERY_SECRET=change-me-dev-delivery-secret
MAIL_MODE=dev
```

Notes:

- `DEV_LOGIN=true` enables the red university development-login dropdown and
  the `/api/auth/dev-login` route.
- `CHAIN_MODE=mock` is the only fully implemented mode.
- `COMMUNITY_DELIVERY_SECRET` must be non-empty for community-key delivery.
- Leave `DATABASE_PATH`/`DB_PATH` unset unless you need an isolated database.
  If you set a path, use an absolute path so the root scripts and the server
  resolve the same file.
- Do not commit `.env` or `.dev-keys/`.

### 4.2 Reset runtime data

This removes the SQLite database, encrypted blobs, demo keys and dev mailbox:

```bash
rm -rf server/data server/.dev-mailbox .dev-keys
```

### 4.3 Seed universities and staff

```bash
npm run seed
```

Expected:

- Three universities: `moratuwa`, `peradeniya`, `colombo`.
- Domains: `mrt.ac.lk`, `pdn.ac.lk`, `cmb.ac.lk`.
- Three demo staff rows per university: `registrar`, `investigator`, `admin`.

Check the API after starting the server, or inspect SQLite:

```bash
sqlite3 server/data/usafe.db \
  "SELECT id, name, domain, enrollment_ceiling, status FROM universities ORDER BY id;"
sqlite3 server/data/usafe.db \
  "SELECT university_id, role, address FROM staff ORDER BY university_id, role;"
```

### 4.4 Seed demo role keys and community keys

```bash
npm run seed:keys
```

If `COMMUNITY_DELIVERY_SECRET` is not in `.env`:

```bash
COMMUNITY_DELIVERY_SECRET=change-me-dev-delivery-secret npm run seed:keys
```

Expected:

- `.dev-keys/ugc.json`
- `.dev-keys/university-moratuwa.json`
- `.dev-keys/university-peradeniya.json`
- `.dev-keys/university-colombo.json`
- A UGC staff row (`role='ugc'`, address `ugc-demo-officer`)
- RSA public keys stored for each university and the UGC
- A community key per university, wrapped for the UGC and wrapped for delivery
- `community_key_created_at` and `community_key_academic_year` populated

Verify:

```bash
sqlite3 server/data/usafe.db \
  "SELECT id, community_key_created_at, community_key_academic_year FROM universities;"
sqlite3 server/data/usafe.db \
  "SELECT role, address, length(public_key_jwk) FROM staff WHERE role='ugc';"
```

The demo key passphrase for every `.dev-keys` file is:

```text
demo
```

### 4.5 Seed student rosters

Create a CSV for Moratuwa:

```bash
cat > /tmp/usafe-roster-moratuwa.csv <<'CSV'
email,index_number
student1@mrt.ac.lk,1
student2@mrt.ac.lk,2
student3@mrt.ac.lk,3
student4@mrt.ac.lk,4
student5@mrt.ac.lk,5
api-ticket@mrt.ac.lk,6
api-otp@mrt.ac.lk,7
CSV

npm run seed:roster -- moratuwa /tmp/usafe-roster-moratuwa.csv
```

Expected:

```json
{ "accepted": 7, "rejected": 0, "errors": [] }
```

Repeat for another university if needed:

```bash
cat > /tmp/usafe-roster-peradeniya.csv <<'CSV'
email,index_number
pstudent1@pdn.ac.lk,1
pstudent2@pdn.ac.lk,2
pstudent3@pdn.ac.lk,3
pstudent4@pdn.ac.lk,4
pstudent5@pdn.ac.lk,5
CSV

npm run seed:roster -- peradeniya /tmp/usafe-roster-peradeniya.csv
```

The index number is intentionally never stored.

### 4.6 Start the services

Terminal A:

```bash
npm run dev
```

Expected:

- API on `http://127.0.0.1:3000`
- Web on `http://localhost:5173`
- Vite proxies `/api` to the API

For phone testing on the same network, run the web server with a host binding
in a separate terminal instead of the root dev command:

```bash
npm run dev -w apps/web -- --host 0.0.0.0
```

Then open `http://<your-laptop-LAN-IP>:5173/` on the phone. The API stays on
127.0.0.1 and is reached through the Vite proxy.

### 4.7 Health check

```bash
curl -s http://127.0.0.1:3000/api/health | jq .
```

Expected:

```json
{
  "ok": true,
  "mode": "mock",
  "devLogin": true
}
```

Through the web proxy:

```bash
curl -s http://localhost:5173/api/health | jq .
```

---

## 5. Automated gate

Run this before any manual test and again after any code/config change.

```bash
npm run check
```

Expected:

```text
typecheck: pass
lint: pass
tests: pass
exit code 0
```

Also run the focused suites:

```bash
npx vitest run packages/crypto
npx vitest run packages/chain
npx vitest run server/src
npx vitest run apps/web/src
```

Expected: every suite passes. The repository now uses
`vitest.config.ts` with a 60-second timeout and `maxWorkers: 2`; this is
intentional because the crypto suites hash/encrypt multi-megabyte buffers.

### 5.1 Demo CLI

```bash
npm run demo:cli
```

Expected final lines:

```text
Enrolled students: 5
supportCount: 4
status: finished
```

The full record should show:

- `supportCount: 4`
- `status: "finished"`
- `outcomeHash` non-null
- a sequential id such as `c-000001`

### 5.2 Forged-proof helper

With the server running:

```bash
npm run try:forge
```

Expected:

```text
Forged proof rejected: HTTP 401
```

### 5.3 Duplicate-support helper

With the server running:

```bash
npm run try:duplicate
```

Expected:

- first support count `1`
- duplicate rejected with HTTP 400 and
  `support nullifier already used`
- final support count `1`

### 5.4 Blob helper

```bash
npm run try:blob
```

Or with a file:

```bash
npm run try:blob -- /path/to/file.bin
```

Expected: upload succeeds, download is byte-identical, hash and size printed.

### 5.5 Event helper

Open two SSE listeners:

```bash
curl -N http://127.0.0.1:3000/api/events
```

```bash
curl -N http://127.0.0.1:3000/api/events
```

In a third terminal:

```bash
npm run try:event
```

Expected: both listeners receive one `data: {"type":...,"id":...}` line.

If `NODE_ENV=production` or `NODE_ENV=test`, the publish helper is intentionally
absent and returns 404. For the human test, run the normal dev server.

### 5.6 Mail helper

```bash
npm run mail:test
```

Expected:

- A new file under `server/.dev-mailbox/`
- Console output with the development code and file path, never the recipient
  address in the server log line

---

## 6. Test data reference

| Item | Value |
|---|---|
| Universities | `moratuwa`, `peradeniya`, `colombo` |
| Domains | `mrt.ac.lk`, `pdn.ac.lk`, `cmb.ac.lk` |
| Student emails | `student1@mrt.ac.lk` … `student5@mrt.ac.lk` |
| API ticket email | `api-ticket@mrt.ac.lk` (consumed by API-05; do not use in the portal) |
| API OTP email | `api-otp@mrt.ac.lk` (used for lockout tests; do not use in the portal) |
| Fake wallet passphrases | `student1-pass`, `student2-pass`, etc. |
| Demo key backup passphrase | `demo` |
| Community-key local backup passphrase | choose at least 8 characters |
| Dev login | red “DEVELOPMENT LOGIN” section on `/university/` |
| Demo UGC account | created by `seed:keys`, role `ugc` |
| Normal filing limit | 2 per student per UTC calendar month |
| Support delay | random 2–12 seconds |
| Filing delay | random 2–12 seconds |
| Escalation check | every 10 seconds, plus once at startup |
| Current-root grace | always valid; older roots for 14 days |
| Evidence limits | 5 files, 25 MB each plaintext; 26 MB blob allowance |
| Mock banner | visible only when `/api/health` reports `mock` |

---

## 7. Backend/API test script

Use `curl` and, if available, `jq`.

Set a base URL:

```bash
API=http://127.0.0.1:3000
```

### API-01 — health and mode

```bash
curl -s "$API/api/health" | jq .
```

Pass: `ok: true`, `mode: "mock"`, `devLogin: true` when `DEV_LOGIN=true`.

### API-02 — university registry

```bash
curl -s "$API/api/universities" | jq .
curl -s "$API/api/universities/moratuwa" | jq .
```

Pass:

- list contains the three seeded universities with `id`, `name`, `status`
- detail returns the requested university
- unknown id returns 404

### API-03 — 100-row roster import and per-line errors

```bash
{
  echo "email,index_number"
  for i in $(seq 1 100); do echo "bulk$i@mrt.ac.lk,$i"; done
} > /tmp/usafe-roster-100.csv

npm run seed:roster -- moratuwa /tmp/usafe-roster-100.csv
```

Pass: `accepted: 100`, `rejected: 0`.

Bad-row file:

```bash
cat > /tmp/usafe-roster-bad.csv <<'CSV'
email,index_number
new@mrt.ac.lk,1
not-an-email,2
outsider@other.edu,3
student1@mrt.ac.lk,4
CSV

npm run seed:roster -- moratuwa /tmp/usafe-roster-bad.csv
```

Pass:

- one row accepted (the new one)
- invalid email and domain mismatch reported with their CSV line numbers
- the duplicate row reported as `duplicate`
- no row accepted without an email hash

### API-04 — OTP no-enumeration, lockout, expiry

Request for a known and unknown email:

```bash
curl -s -X POST "$API/api/otp/request" \
  -H 'content-type: application/json' \
  -d '{"email":"api-otp@mrt.ac.lk"}' | jq .

curl -s -X POST "$API/api/otp/request" \
  -H 'content-type: application/json' \
  -d '{"email":"nobody@mrt.ac.lk"}' | jq .
```

Pass: both return the same `{"ok":true}` response.

Read the code from the newest file:

```bash
ls -t server/.dev-mailbox | head -1
cat "server/.dev-mailbox/$(ls -t server/.dev-mailbox | head -1)"
```

Wrong code five times:

```bash
for i in $(seq 1 5); do
  curl -s -X POST "$API/api/otp/verify" \
    -H 'content-type: application/json' \
    -d '{"email":"api-otp@mrt.ac.lk","code":"000000"}' | jq .
done
```

Then the correct code:

```bash
curl -s -X POST "$API/api/otp/verify" \
  -H 'content-type: application/json' \
  -d '{"email":"api-otp@mrt.ac.lk","code":"<correct-code>"}' | jq .
```

Pass: five wrong attempts lock the code; the correct code then does **not**
issue a ticket — the endpoint returns either `429 too many requests` or the
generic `{"ok":false}`. Do not use this email for the portal afterwards; seed
another email or reset the roster.

### API-05 — ticket is single-use and expires

```bash
npm run try:otp -- api-ticket@mrt.ac.lk
```

Use the printed ticket once with any 64-hex commitment:

```bash
COMMITMENT=$(printf 'api-test-%s' "$(date +%s)" | shasum -a 256 | awk '{print $1}')
curl -s -X POST "$API/api/enroll" \
  -H 'content-type: application/json' \
  -d "{\"ticket\":\"<ticket>\",\"commitment\":\"$COMMITMENT\"}" | jq .
```

(On Linux, use `sha256sum` instead of `shasum -a 256`.)

Pass: first use returns `leafIndex`, a 20-element `path`, `root`, and
`communityKey`. Second use returns 400 `invalid ticket`. An expired ticket
also returns 400.

### API-06 — blob upload/download and content-type

```bash
npm run try:blob
```

Pass: upload/download identical bytes.

Negative tests:

```bash
curl -s -o /tmp/out.txt -w '%{http_code}\n' -X POST \
  "$API/api/blobs?hash=$(printf 'x' | shasum -a 256 | awk '{print $1}')" \
  -H 'content-type: application/json' -d '{}'
```

Pass: `415` (only `application/octet-stream` accepted).

Hash mismatch:

```bash
curl -s -o /tmp/out.txt -w '%{http_code}\n' -X POST \
  "$API/api/blobs?hash=$(printf 'not-the-body' | shasum -a 256 | awk '{print $1}')" \
  -H 'content-type: application/octet-stream' --data-binary 'different bytes'
```

Pass: `400` `hash mismatch`.

### API-07 — SSE events

See 5.5. Pass: both listeners receive the event within two seconds.

### API-08 — staff auth and role guards

Get seeded accounts:

```bash
curl -s "$API/api/auth/dev-accounts" | jq .
```

Extract a Moratuwa admin token:

```bash
ADMIN_ID=$(curl -s "$API/api/auth/dev-accounts" \
  | jq -r '.accounts[] | select(.universityId=="moratuwa" and .role=="admin") | .id' \
  | head -1)

ADMIN_TOKEN=$(curl -s -X POST "$API/api/auth/dev-login" \
  -H 'content-type: application/json' \
  -d "{\"staffId\":$ADMIN_ID}" | jq -r .token)

curl -s "$API/api/staff/me" \
  -H "authorization: Bearer $ADMIN_TOKEN" | jq .
```

Pass: staff/me returns the admin role and `university_id: "moratuwa"`.

Registrar token:

```bash
REG_ID=$(curl -s "$API/api/auth/dev-accounts" \
  | jq -r '.accounts[] | select(.universityId=="moratuwa" and .role=="registrar") | .id' \
  | head -1)

REG_TOKEN=$(curl -s -X POST "$API/api/auth/dev-login" \
  -H 'content-type: application/json' \
  -d "{\"staffId\":$REG_ID}" | jq -r .token)
```

Investigator token:

```bash
INV_ID=$(curl -s "$API/api/auth/dev-accounts" \
  | jq -r '.accounts[] | select(.universityId=="moratuwa" and .role=="investigator") | .id' \
  | head -1)

INV_TOKEN=$(curl -s -X POST "$API/api/auth/dev-login" \
  -H 'content-type: application/json' \
  -d "{\"staffId\":$INV_ID}" | jq -r .token)
```

UGC token:

```bash
UGC_ID=$(curl -s "$API/api/auth/dev-accounts" \
  | jq -r '.accounts[] | select(.role=="ugc") | .id' \
  | head -1)

UGC_TOKEN=$(curl -s -X POST "$API/api/auth/dev-login" \
  -H 'content-type: application/json' \
  -d "{\"staffId\":$UGC_ID}" | jq -r .token)
```

Pass:

- `/api/staff/me` without a token returns 401
- an invalid token returns 401
- a registrar cannot POST status (403)
- an investigator can POST status
- only an admin can `PUT /api/university/:id/public-key`
- only an admin can GET/POST the community-key admin routes
- a staff member of another university cannot read/update Moratuwa data

### API-09 — status transitions and history

Use a complaint freshly filed in the student portal. Do **not** use the
`demo:cli` record here: that CLI already moves its complaint to `finished`.

```bash
ID=c-000001

curl -s -X POST "$API/api/complaints/$ID/status" \
  -H "authorization: Bearer $INV_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"newStatus":"pending_investigation","outcomeHash":null}' | jq .

OUTCOME=$(printf 'demo outcome message' | shasum -a 256 | awk '{print $1}')

curl -s -X POST "$API/api/complaints/$ID/status" \
  -H "authorization: Bearer $INV_TOKEN" \
  -H 'content-type: application/json' \
  -d "{\"newStatus\":\"finished\",\"outcomeHash\":\"$OUTCOME\",\"outcomeLocator\":\"$OUTCOME\"}" | jq .

curl -s "$API/api/complaints/$ID/history?university=moratuwa" | jq .
```

Pass:

- first transition succeeds
- second transition to finished succeeds
- history has three entries: student `not_started`, university
  `pending_investigation`, university `finished`
- the database row has `outcome_hash` and `outcome_locator` set
- a second `finished` transition fails
- moving backwards fails
- finishing without an outcome fails
- a registrar token gets 403

Note: the university complaints UI is still a placeholder at M065. This test is
API-level by design.

### API-10 — staff-involved redaction

File a staff-involved complaint in the student portal (checkbox “This involves a
staff member or official”). Use a student with a free filing slot. Then:

```bash
# University staff view (redacted)
curl -s "$API/api/complaints?university=moratuwa" \
  -H "authorization: Bearer $ADMIN_TOKEN" | jq .

# UGC view (full record)
curl -s "$API/api/complaints" \
  -H "authorization: Bearer $UGC_TOKEN" | jq .
```

Pass:

- the university row for the staff-involved id contains only `id`,
  `createdAt`, `category`, `supportCount`, `status`
- the UGC row contains the full record, including `ownerRole: "ugc"`
- university staff cannot update the staff-involved complaint (403)
- UGC can update it (API)

### API-11 — deadline escalation

Restart the server with a short SLA:

```bash
DEMO_SLA_SECONDS=30 npm run dev
```

File a new complaint in the student portal. Wait 30–45 seconds, then:

```bash
ID=<new-complaint-id>
curl -s "$API/api/complaints?university=moratuwa" | jq \
  '.complaints[] | select(.escalated==true)'
curl -s "$API/api/complaints/$ID/history?university=moratuwa" | jq .
```

Pass:

- the complaint shows `escalated: true`
- history contains an entry with `actorRole: "system"`
- the escalation event appears on an open `/api/events` listener
- running the job again does not duplicate the history row

Restart without `DEMO_SLA_SECONDS` afterwards.

### API-12 — small-group statistics

```bash
curl -s "$API/api/stats?university=moratuwa" | jq .
```

Pass:

- with fewer than 5 complaints, totals and breakdown values are `null`
- with 5 or more, values are exact where the group is large enough
- a UGC token receives exact `byUniversity` counts but still bucketed
  category/urgency/status breakdowns

### API-13 — privacy lint / source guard

```bash
npx vitest run server/src/services/privacy.test.ts
```

Pass: the server source contains no forbidden logging patterns, and the logger
config only emits path/status/duration.

---

## 8. Student portal end-to-end script

Open:

```text
http://localhost:5173/student/?fakewallet=1
```

### STU-01 — onboarding step 1 and privacy copy

1. Select “University of Moratuwa”.
2. Enter `student1@mrt.ac.lk`.
3. Read the privacy box.

Pass:

- the copy says the university **can** read complaint text and evidence
- it says students can read text but not evidence
- it says the UGC can read both
- it says staff-involved details are UGC-only
- it discloses that the server operator could decrypt complaint text through
  the community key
- validation blocks an empty university or invalid email

### STU-02 — OTP

1. Continue to step 2.
2. Read the newest file in `server/.dev-mailbox/` or the server console.
3. Enter the 6-digit code.
4. Press “Verify code”.

Pass:

- a code is requested automatically on entering step 2
- wrong/expired codes show a friendly error
- a correct code returns a ticket and enables the next step
- “Resend code” requests a new code without exposing whether the email exists

### STU-03 — fake wallet connection

1. Enter a fake wallet passphrase, e.g. `student1-pass`.
2. Press “Connect wallet”.

Pass:

- a red “DEVELOPMENT ONLY” warning is visible in fake-wallet mode
- the deterministic address appears
- the same passphrase in a new session produces the same address and signature
- an empty passphrase is rejected
- the real Lace path shows install instructions if Lace is absent

### STU-04 — enrollment

1. Press “Finish enrolment”.
2. Wait for the progress states.

Pass:

- the secret is derived, commitment computed, server enrollment succeeds
- the receipt is stored in IndexedDB
- the success screen offers “Open community feed”
- the community key is delivered
- a ceiling-reached or expired-ticket error shows a friendly message
- no secret is written to local/session storage or IndexedDB

### STU-05 — feed and decryption

1. Open the community feed.
2. File a complaint from another student first if needed (see STU-06).
3. Reload the feed.

Pass:

- cards show category, urgency, status, support count, age and description
- the description is decrypted with the community key
- UGC-owned complaints show “Details restricted to the UGC”
- filters (status, category) and sorting (newest, most supported) work
- a new complaint from another browser appears without refreshing within about
  two seconds
- if the key is unavailable, the card says “Description unavailable” rather
  than showing garbage

### STU-06 — file a complaint with evidence

1. Open “File a complaint”.
2. Enter a description of at least 40 and at most 4000 characters.
3. Choose a category and urgency.
4. Optionally tick “This involves a staff member or official”.
5. Attach an image and/or a short video.
6. Wait for the image metadata note.
7. Submit.

Pass:

- empty/short descriptions are rejected with a clear message
- more than 4000 characters are rejected
- more than 5 files are rejected
- files larger than 25 MB are rejected
- `.exe` and other executables are rejected
- images show previews; stripped images say “metadata stripped”
- videos/documents require the acknowledgement checkbox
- the progress list shows every step as `done` after success
- the success screen gives the complaint id and links to detail/My complaints
- the complaint appears in the feed and in the UGC overview
- the support count starts at 0

### STU-07 — staff-involved routing

1. File a complaint with the staff checkbox ticked.
2. Open it in the feed/detail as another student.

Pass:

- the description shows “Details restricted to the UGC”
- the university API row is redacted
- the UGC API row is full
- the student’s own “My complaints” receipt still shows their own text

### STU-08 — duplicate suggestions

1. Ensure at least one open complaint exists and has been read/decrypted by the
   portal.
2. Open “File a complaint”.
3. Type a similar description (above 40 characters).
4. Wait about 600 ms.

Pass:

- a warning box lists up to three similar open complaints
- each has “Support this one instead”
- clicking it opens the existing complaint detail
- finished or UGC-owned complaints are never suggested
- the suggestion appears even if the student opened the form before visiting the
  feed, provided they are unlocked and the community key is available

### STU-09 — support flow

Use a second browser/profile as `student2@mrt.ac.lk` with passphrase
`student2-pass`.

1. Open a complaint filed by student1.
2. Press “Support this complaint”.
3. Wait for the random delay.
4. Reload the page.
5. Press again.

Pass:

- the button shows “Supporting…” while the request is queued
- the count increases to 1
- the button becomes “You support this” and stays that way after reload
- a second press does not increase the count
- an invalid proof shows a real error, not “already supported”
- being offline shows the friendly offline message and does not change the count

### STU-10 — detail page states

Open complaints in:

- not started
- pending investigation (use the API to set it)
- escalated (short SLA)
- finished with an outcome hash

Pass:

- the meta, support line and description render
- the status timeline lists each history entry
- escalated complaints show the overdue notice
- finished complaints attempt to show the outcome; without an uploaded outcome
  blob they show “Outcome recorded (hash…)”, which is expected until M068 adds
  the outcome-sealing UI
- back to feed works

### STU-11 — receipts and My complaints

1. Open “My complaints”.
2. Download one evidence file.
3. Reload.
4. Clear site data, reload and unlock again.

Pass:

- only complaints filed in this browser appear
- statuses refresh from the public complaint endpoint and SSE
- evidence download verifies the SHA-256 and decrypts
- a tampered blob shows an integrity error
- the page states clearly that clearing site data removes the list permanently
- restoring the wallet does **not** restore the list
- descriptions are shown from the encrypted receipt, not the server

### STU-12 — filing limit

Use a fresh student (for example `student3@mrt.ac.lk`) who has not filed this
month; `student1` may already have used both slots in STU-06/STU-07.

1. File two complaints in the same UTC month.
2. Open the form again.

Pass:

- the slots line shows 0
- the submit button is disabled with a warning
- if local receipts were cleared, the UI may show 2 slots, but the server still
  rejects a third filing; the form surfaces the monthly-limit message
- a third filing with a forged different month must be rejected by the server
  (covered by `packages/chain/src/mock.test.ts`)

### STU-13 — help page and offline

1. Open “Help”.
2. Toggle the browser offline.
3. Return to the feed and press “Support”.

Pass:

- the help page explains anonymity, emergency guidance and helplines
- helplines are empty unless `HELPLINES` is configured
- the page works offline
- offline support shows a friendly message and no false success

### STU-14 — returning student

1. Reload the page (do not close the tab; the fake-wallet passphrase lives in
   `sessionStorage` for this tab). For a real Lace wallet, closing/reopening the
   tab is fine because the wallet keeps its own seed.
2. Open `/student/?fakewallet=1`.
3. Press “Unlock student secret”.

Pass:

- the university id is remembered in `sessionStorage`
- the wallet re-derives the same secret/commitment
- the feed rebuilds the credential locally from `/leaves`
- no leaf index is sent to the server
- the feed and receipts work after re-unlocking

---

## 9. University portal script

Open:

```text
http://localhost:5173/university/
```

### UNI-01 — development login

1. Confirm the red “DEVELOPMENT LOGIN” badge.
2. Choose a Moratuwa admin.
3. Sign in.

Pass:

- session token is stored in `sessionStorage`, not `localStorage`
- header shows the role badge
- “Log out” clears the session and returns to login
- with `DEV_LOGIN=false`, the dropdown and dev routes are absent

### UNI-02 — role guards

Test each seeded role:

| Role | `/` | `/complaints` | `/roster` | `/keys` | `/community-key` |
|---|---|---|---|---|---|
| registrar | yes | no | yes | yes | no |
| investigator | yes | yes | no | yes | no |
| admin | yes | yes | yes | yes | yes |

Pass: denied routes show “Access denied”. `/complaints` also shows the key-locked
view until a private key is loaded.

### UNI-03 — import the demo key

1. Open `/keys`.
2. Choose `.dev-keys/university-moratuwa.json`.
3. Enter passphrase `demo`.
4. Import.
5. Download the backup (or confirm the imported file is the backup).
6. Press “Continue: register the public key” as admin.

Pass:

- the public-key fingerprint appears
- the key is loaded in memory
- refresh clears it and asks for the passphrase again
- a wrong passphrase fails
- a non-admin sees the “administrator must register” note and no register
  button
- the admin can register the same key again safely

### UNI-04 — community key screen

1. Open `/community-key` as admin.
2. Confirm the current key’s creation date and academic year.
3. Create a new key with a passphrase of at least 8 characters.
4. Download the encrypted backup.
5. Reload a fresh student session and file a complaint so it is sealed with the
   new key, then enroll another fresh student and confirm they can read it.

Pass:

- only admin can open the screen
- the current key is shown as current, not “not created”, even when it came
  from `seed:keys`
- the warning explains that the server operator could read complaint text
- creation wraps the key for the UGC and stores a delivery copy wrapped under
  `COMMUNITY_DELIVERY_SECRET`
- the raw key is never stored unwrapped in SQLite
- the local backup is passphrase-protected
- a new student can read complaints filed with the new key
- the page warns that a previous key backup is needed for older complaints

> Key rotation is real: complaints sealed with the old key need the old local
> backup. Existing student sessions may still hold the old key in memory until
> they reload, so test the new key with a fresh session.

### UNI-05 — roster UI and complaints UI

At M065 these are placeholders. Expected:

- `/roster` shows “Roster tools arrive in a later milestone.”
- `/complaints` shows the key-locked view or the placeholder once the key is
  loaded.

Use `npm run seed:roster` and the API for roster/complaint tests. Do not report
the missing dashboard as a bug until M066+/M069.

---

## 10. UGC portal script

Open:

```text
http://localhost:5173/ugc/
```

### UGC-01 — read-only overview

Pass:

- every seeded university is listed
- each university group shows complaint id, category, status, support count
- escalated complaints show “Overdue”
- the mock banner is visible in mock mode
- `/ugc/#/about` shows the UGC overview placeholder
- no login is required at M065
- no complaint text/evidence is shown here

### UGC-02 — UGC API

Use the UGC token from API-08.

Pass:

- `GET /api/complaints` returns all universities
- `GET /api/complaints?university=moratuwa` focuses one university
- UGC can update a UGC-owned complaint via the status API
- UGC cannot update a university-owned complaint (403)
- `POST /api/complaints/:id/reopen` returns 501 until M079 (expected)
- UGC staff-involved records are full, not redacted

---

## 11. Cross-portal and live-update script

### CROSS-01 — new complaint fan-out

1. Keep the student feed, the UGC overview and a second student feed open.
2. File a complaint in the first student portal.

Pass:

- the second student feed updates within about two seconds without refresh
- the UGC overview shows the complaint after refresh
- the mock banner is visible everywhere

### CROSS-02 — support count fan-out

1. Support the complaint from student2.
2. Watch the first feed/detail and UGC overview.

Pass:

- the count increases by exactly one
- the same secret cannot support twice
- the count is consistent in the API, feed and UGC overview

### CROSS-03 — escalation fan-out

1. Run with `DEMO_SLA_SECONDS=30`.
2. File a complaint and do not touch it.
3. Watch the feed and UGC overview for 30–45 seconds.

Pass:

- an `Overdue`/`escalated` state appears
- the history gains a system entry
- the UGC overview shows the overdue badge

---

## 12. Privacy and security audit

### PRIV-01 — database schema

```bash
sqlite3 server/data/usafe.db ".tables"
sqlite3 server/data/usafe.db "PRAGMA table_info(roster);"
sqlite3 server/data/usafe.db "PRAGMA table_info(ml_leaves);"
sqlite3 server/data/usafe.db "PRAGMA table_info(ml_complaints);"
```

Pass:

- `roster` has `email_hash`, never `email` or `commitment`
- `ml_leaves` has commitments and leaf indexes, never email/address
- `ml_complaints` has hashes/locators/status, never plaintext description,
  names, emails or wallet addresses
- no table contains both an email and a commitment

Search all columns:

```bash
sqlite3 server/data/usafe.db "
SELECT m.name || '.' || p.name
FROM sqlite_master m
JOIN pragma_table_info(m.name) p
WHERE m.type='table'
  AND (p.name LIKE '%email%' OR p.name LIKE '%commitment%');
"
```

Pass: only expected hashed/commitment columns appear; no plaintext pairing.

### PRIV-02 — no plaintext complaints on chain tables

```bash
sqlite3 server/data/usafe.db \
  "SELECT id, payload_hash, payload_locator, outcome_hash, outcome_locator FROM ml_complaints LIMIT 10;"
```

Pass: only hashes, locators, ids and metadata. No description text.

### PRIV-03 — logs

Capture the dev server output to a file and run a support/filing action:

```bash
# in the server terminal, or start with:
# npm run dev 2>&1 | tee /tmp/usafe-dev.log
```

Check:

```bash
grep -E "@|email=|commitment=|nullifier=" /tmp/usafe-dev.log
```

Pass: no email, commitment or nullifier appears. Request log lines contain only
path, status code and duration. A blob path may contain a public blob hash;
that is allowed because it is part of the request path.

### PRIV-04 — network payloads

Open DevTools → Network.

For a support action, inspect the request body:

- it contains `complaintId` and a mock `proof` with commitment/path/nullifier
- it does **not** contain the email, student secret or a session cookie
- the random 2–12 second delay is visible before the request

For a filing action:

- it contains the sealed payload hash, category/urgency/staff flag and proof
- it does not contain the description or evidence bytes in plaintext

Pass: no email, secret or plaintext complaint content leaves the browser in a
student action.

> Mock mode is explicitly not anonymous. The mock proof carries the commitment
> and Merkle path; the server must verify and discard it. The test is that it is
> never persisted or logged.

### PRIV-05 — gitignore and secrets

```bash
git check-ignore .dev-keys server/.dev-mailbox server/data .env
git status --short
```

Pass: all runtime/secret paths are ignored; no `.env` or `.dev-keys` file is
tracked. `server/.dev-mailbox` contains recipient addresses by design and must
never be committed.

### PRIV-06 — forged proof and duplicate support

See 5.2 and 5.3. Pass: forged proof 401/400 and no complaint; duplicate support
count stays at 1.

### PRIV-07 — role/authorization matrix

Use API-08 tokens to verify:

- registrar cannot update status
- investigator cannot import roster
- investigator cannot register the university public key
- non-admin cannot open/use the community-key routes
- university staff cannot read another university’s complaint
- university staff sees staff-involved rows redacted
- UGC sees all
- a missing/invalid token returns 401

---

## 13. Evidence, crypto and tamper tests

### CRYPTO-01 — crypto playground

Open:

```text
http://localhost:5173/crypto.html
```

1. Choose an image with GPS/location metadata.
2. Strip metadata and download the result.
3. Check the downloaded image’s properties; location should be gone.
4. Encrypt a 20 MB video.
5. Copy the displayed hash.
6. Wrap/unwrap the key and decrypt.
7. Download and play the video; compare with the original.
8. Change one character in the ciphertext box and try to decrypt.

Pass:

- the image loses EXIF/GPS data
- the video round-trips byte-identically
- tampering produces a decryption error
- the displayed hash is the SHA-256 of the encrypted bytes

### CRYPTO-02 — evidence re-download integrity

1. File a complaint with evidence.
2. Open “My complaints”.
3. Download the evidence.

Pass: “Integrity verified” and the file matches the original.

Tamper test (on a disposable copy of the database/blob directory):

```bash
# Back up first. Then flip a byte in one stored blob.
cp server/data/blobs/<hash> /tmp/blob.bak
printf '\xff' | dd of=server/data/blobs/<hash> bs=1 seek=100 conv=notrunc
```

Re-download from My complaints.

Pass: the page shows an integrity error and refuses to present the file as valid.
Restore the blob from `/tmp/blob.bak` afterwards.

### CRYPTO-03 — oversized evidence

```bash
dd if=/dev/zero of=/tmp/usafe-25mb.bin bs=1048576 count=25
npm run try:blob -- /tmp/usafe-25mb.bin
```

Pass: a 25 MB blob uploads/downloads (server allows a 26 MB blob to fit
encrypted overhead).

```bash
dd if=/dev/zero of=/tmp/usafe-27mb.bin bs=1048576 count=27
npm run try:blob -- /tmp/usafe-27mb.bin
```

Pass: rejected as too large (26 MiB is the blob ceiling; evidence input is
capped at 25 MiB by the picker).

### CRYPTO-04 — evidence picker rejects

- `.exe`
- unsupported file type
- more than 5 files
- file larger than 25 MB

Pass: each rejection has a clear message; no file is silently accepted.

### CRYPTO-05 — missing university key

```bash
sqlite3 server/data/usafe.db \
  "UPDATE universities SET public_key_jwk = NULL WHERE id = 'moratuwa';"
```

Restart or reuse the student portal and file a complaint **with evidence**.

Pass: the submission fails at the key-wrapping step with a clear “university has
not registered its encryption key” message; no complaint is created.

Restore:

```bash
npm run seed:keys
```

### CRYPTO-06 — missing UGC key

```bash
sqlite3 server/data/usafe.db \
  "UPDATE staff SET public_key_jwk = NULL WHERE role = 'ugc';"
```

File a normal complaint with evidence.

Pass: submission fails because the UGC public key is unavailable. Restore with
`npm run seed:keys`.

---

## 14. Resilience and recovery

### RES-01 — offline support

1. Disable the network in DevTools.
2. Press “Support”.
3. Re-enable the network.
4. Press again.

Pass: first attempt shows the offline message and changes nothing; second
attempt succeeds.

### RES-02 — SSE reconnect

1. Open the student feed.
2. Restart the API server.
3. Wait for the event stream to close.
4. Reload the feed or press “Try again”.

Pass: feed reloads and reconnects; live events resume.

### RES-03 — expired ticket

1. Request an OTP and get a ticket.
2. Wait 15+ minutes (or edit `expires_at` in a disposable DB).
3. Try to enroll.

Pass: 400 `invalid ticket` with a friendly message.

### RES-04 — lost filing response

The pipeline now recovers a complaint by sealed payload hash if the ledger
accepted it but the response was lost. API/unit coverage:
`npx vitest run apps/web/src/student/submit.test.ts`.

Manual equivalent:

1. File a complaint while the network drops exactly after the request is sent.
2. Retry from the failed step.

Pass: retry returns the same complaint id and does not create a second
complaint with the next monthly slot.

### RES-05 — duplicate support

Press support twice, or run `npm run try:duplicate`.

Pass: count stays at 1; the UI stays in “You support this”.

### RES-06 — upload retry

Interrupt an evidence upload, then retry the submission.

Pass: the retry reuses already-uploaded blobs and does not duplicate them.

---

## 15. Responsive and accessibility

Run at 375, 768 and 1280 px widths.

### A11Y-01 — responsive

Pass:

- no horizontal scrolling on landing, student, university or UGC pages
- form fields, cards and buttons remain usable at 375 px
- the file picker and upload progress are usable one-handed on a phone

### A11Y-02 — keyboard

1. Use Tab/Shift+Tab only.
2. Reach every control.
3. Open the modal in the UI showcase and close it with the keyboard.
4. Use the “Skip to main content” link.

Pass: visible focus outlines, logical tab order, no keyboard trap, skip link
works.

### A11Y-03 — screen reader basics

Pass:

- headings form a sensible hierarchy
- form controls have labels
- toasts use `aria-live`
- the spinner has a screen-reader label
- images have alt text
- status is not conveyed by colour alone (badges have text)

### A11Y-04 — axe

Run axe-core in the browser extension on:

- landing page
- student home/wizard
- student feed
- file-complaint form
- university login
- university key setup
- UGC overview

Pass: no critical or serious issues. Record any moderate issues with a
screenshot and the rule id. (Automated axe integration arrives at M130.)

---

## 16. Optional load/soak

These are optional but useful before a live demo.

### LOAD-01 — read endpoints

If `autocannon` is available:

```bash
npx autocannon -c 20 -d 30 http://127.0.0.1:3000/api/universities
npx autocannon -c 20 -d 30 "http://127.0.0.1:3000/api/complaints?university=moratuwa"
```

Pass:

- no 5xx responses
- reasonable latency for a local demo
- server logs still contain only path/status/duration

### LOAD-02 — SSE clients

Open 20 SSE listeners:

```bash
for i in $(seq 1 20); do curl -sN http://127.0.0.1:3000/api/events >/dev/null & done
npm run try:event
```

Pass: the server stays responsive; stop the listeners afterwards with
`kill %1 ...` or close the terminal.

### LOAD-03 — roster scale

Import 1,000 rows into a disposable university and verify the API still
responds. Do not use the demo database for destructive scale tests without a
backup.

---

## 17. Known limitations and expected non-features

These are not failures at M065:

- Mock mode is not anonymous; the banner must be visible.
- The university roster and complaints dashboards are placeholders.
- The UGC portal has no login/actions yet.
- Status changes are tested via API, not the university UI.
- Outcome messages cannot be sealed/uploaded through the UI until M068; the
  API accepts and stores the hash/locator.
- Reopen returns 501 until M079.
- Real Cardano/Midnight, proof server, deploy scripts and chain-mode switching
  are not part of M001–M065.
- Community-key delivery through the server means the server operator could
  decrypt complaint text (documented; not evidence or UGC-only cases).
- Filing months use UTC.
- A current Merkle root never expires; historical roots expire after 14 days.
- Evidence is capped at 5 files × 25 MB; the blob endpoint accepts 26 MB to
  accommodate encryption overhead.
- Real Lace, real IndexedDB reload, axe and 375px design checks are human
  verification items in `docs/HUMAN_TODO.md`.

---

## 18. Final acceptance checklist

Copy this into your test report.

```markdown
# U-Safe M001–M065 Test Report

Date:
Tester:
Commit:
Node:
Browser(s):
OS:

## Automated
- [ ] npm ci
- [ ] npm run check
- [ ] npm run demo:cli
- [ ] npm run try:forge
- [ ] npm run try:duplicate
- [ ] npm run try:event
- [ ] npm run try:blob
- [ ] npm run mail:test

## Backend/API
- [ ] Health reports mock and devLogin
- [ ] Three universities seeded
- [ ] 100-row roster import
- [ ] Roster per-line errors
- [ ] OTP no-enumeration
- [ ] OTP lockout/expiry
- [ ] Ticket single-use
- [ ] Enrollment returns path/root/key
- [ ] Blob upload/download and hash rejection
- [ ] SSE fan-out
- [ ] Dev staff login and role guards
- [ ] Status transitions/history
- [ ] Staff-involved redaction
- [ ] Escalation
- [ ] Small-group stats

## Student portal
- [ ] Privacy copy is honest
- [ ] OTP wizard
- [ ] Fake wallet
- [ ] Enrollment
- [ ] Feed decryption
- [ ] File complaint with evidence
- [ ] Progress steps all done
- [ ] Duplicate suggestions
- [ ] Support once
- [ ] Duplicate support stays at 1
- [ ] Detail states
- [ ] My complaints and evidence download
- [ ] Filing limit
- [ ] Offline handling
- [ ] Help page

## University portal
- [ ] Dev login
- [ ] Role guards
- [ ] Import demo key
- [ ] Passphrase refresh/wrong passphrase
- [ ] Admin-only public key registration
- [ ] Community-key screen metadata
- [ ] Create/rotate community key
- [ ] New student receives key

## UGC portal
- [ ] Read-only overview
- [ ] About route
- [ ] UGC API list/status
- [ ] Reopen 501 expected

## Cross-portal
- [ ] New complaint appears live
- [ ] Support count consistent
- [ ] Escalation appears live

## Privacy/security
- [ ] SQL: no email/commitment pairing
- [ ] SQL: no plaintext complaint text on ledger tables
- [ ] Logs contain no email/commitment/nullifier
- [ ] Network payloads contain no email/secret
- [ ] Gitignore covers .env, .dev-keys, mailbox, DB, blobs
- [ ] Forged proof rejected
- [ ] Role matrix passes

## Resilience
- [ ] Offline support
- [ ] SSE reconnect
- [ ] Expired ticket
- [ ] Lost filing response recovery
- [ ] Duplicate support
- [ ] Upload retry

## Responsive/accessibility
- [ ] 375/768/1280 widths
- [ ] Keyboard-only walkthrough
- [ ] Skip link
- [ ] Axe: no critical/serious

## Notes / failures

| ID | Result | Evidence | Notes |
|---|---|---|---|
| | pass/fail | screenshot/log/SQL | |
```

---

## 19. Cleanup

After testing, stop the dev server and remove disposable runtime data:

```bash
# stop npm run dev with Ctrl+C first
rm -rf server/data server/.dev-mailbox .dev-keys
```

Do not remove `.env` if you want to keep your local settings; it is gitignored.
Confirm the working tree is clean of secrets:

```bash
git status --short
```

## 20. Quick command index

```bash
# install
npm ci

# automated gate
npm run check

# clean + seed
rm -rf server/data server/.dev-mailbox .dev-keys
npm run seed
npm run seed:keys
npm run seed:roster -- moratuwa /tmp/usafe-roster-moratuwa.csv

# start
npm run dev

# health
curl -s http://127.0.0.1:3000/api/health | jq .

# helpers
npm run demo:cli
npm run try:forge
npm run try:duplicate
npm run try:event
npm run try:blob -- /tmp/file.bin
npm run try:otp -- api-otp@mrt.ac.lk
npm run mail:test

# focused suites
npx vitest run packages/crypto
npx vitest run packages/chain
npx vitest run server/src
npx vitest run apps/web/src

# UI pages
# http://localhost:5173/
# http://localhost:5173/student/?fakewallet=1
# http://localhost:5173/university/
# http://localhost:5173/ugc/
# http://localhost:5173/src/ui/dev.html
# http://localhost:5173/crypto.html
```
