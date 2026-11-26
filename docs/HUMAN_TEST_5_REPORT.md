# Human Test 5 — 10-Round Automated Run

Date: 2026-11-25
Runner: coding agent (in-app browser + shell), mock mode
Result: **10 / 10 rounds passed** after three application fixes.

## Why an isolated harness

The developer's normal dev server was already running on ports 3000/5173. To
avoid disturbing it (and to test the "second browser" with separate
IndexedDB/localStorage), the run used:

- API server: port **3001**, database `server/data/human-test-5.db`
- Student A web origin: `http://localhost:5180`
- Student B web origin: `http://localhost:5181`
- Both Vite instances proxied `/api` to `http://127.0.0.1:3001` through the new
  `VITE_API_TARGET` override in `apps/web/vite.config.ts`.

This makes A and B different browser origins, so their `sessionStorage`,
`localStorage` and IndexedDB receipts are isolated — equivalent to two browsers.

## Exact setup commands

```sh
cd /Users/chamalinduwara/Desktop/U-Safe
source "$HOME/.nvm/nvm.sh" && nvm use 20

# fresh test database
rm -f server/data/human-test-5.db server/data/human-test-5.db-*
cd server
DATABASE_PATH=./data/human-test-5.db npx tsx src/seed.ts
cd ..

# demo keys, isolated output directory
COMMUNITY_DELIVERY_SECRET=change-me-dev-delivery-secret \
  DATABASE_PATH=server/data/human-test-5.db \
  DEV_KEYS_DIR=.dev-keys/human-test-5 \
  npx tsx scripts/seed-keys.ts

# 60 demo students: human-test5-r1a … r30b @mrt.ac.lk
cd server
DATABASE_PATH=./data/human-test-5.db \
  npx tsx src/seed-roster.ts moratuwa ../tmp/human-test-5-roster.csv
cd ..

# API server
cd server
PORT=3001 DATABASE_PATH=./data/human-test-5.db \
  COMMUNITY_DELIVERY_SECRET=change-me-dev-delivery-secret \
  npx tsx src/index.ts

# two web origins (separate terminals)
cd apps/web
VITE_API_TARGET=http://127.0.0.1:3001 npx vite --port 5180 --strictPort
VITE_API_TARGET=http://127.0.0.1:3001 npx vite --port 5181 --strictPort
```

Readiness check used:

```sh
curl -sS http://127.0.0.1:3001/api/health
# {"ok":true,"mode":"mock"}
```

## What every round did (9 Human Test 5 steps)

1. Cleared both origins (`localStorage`, `sessionStorage`, IndexedDB) and opened
   `…/student/index.html?fakewallet=1`.
2. Step 1: selected **University of Moratuwa**, entered the round's student A
   email, pressed Next.
3. Step 2: the code was read from the newest file in `server/.dev-mailbox/`,
   entered, **Verify code** pressed, then Next.
4. Step 3: typed a round-specific fake-wallet passphrase, pressed
   **Connect wallet**, saw `Wallet connected` and an `addr_test1…` address, then
   Next.
5. Step 4: pressed **Finish enrolment** and waited for
   `Enrolment complete.`
6. Student B did the same enrolment on the 5181 origin.
7. B was parked on the community feed. A filed a normal complaint with:
   - description ≥40 characters,
   - a 1×1 PNG (`rN-photo.png`),
   - a 12-byte WebM (`rN-clip.webm`),
   - the video metadata acknowledgement checkbox.
   The progress list reached `Submitted. Your complaint is now on record.` and
   B's feed showed `Complaint c-…` **without a refresh**.
8. B opened the complaint, pressed **Support this complaint** twice; the result
   was `1 student supports this complaint` and a disabled `You support this`
   button.
9. A filed a second complaint with **“This involves a staff member or official”**
   ticked. B's feed showed `Details restricted to the UGC` for it.
10. B attached `malware.exe`; the form showed
    `malware.exe: Executable files cannot be attached.`
11. B opened an unsupported complaint, simulated offline (`navigator.onLine =
    false`, `fetch` rejecting with `TypeError`), pressed Support and saw
    `You appear to be offline. Nothing was sent — check your connection and try again.`
12. A opened **My complaints**, downloaded `rN-clip.webm`, and the row showed
    `Integrity verified`. The download was a completed 12-byte file.

## Round results

| Round | Students | Normal complaint | Staff complaint | Live | Support | .exe | Offline | Download |
|---|---|---|---|---|---|---|---|---|
| 1 | r3a/r3b | c-000004 | c-000005 | yes | 1 | refused | yes | 12 B |
| 2 | r4a/r4b | c-000006 | c-000007 | yes | 1 | refused | yes | 12 B |
| 3 | r6a/r6b | c-000009 | c-000010 | yes | 1 | refused | yes | 12 B |
| 4 | r7a/r7b | c-000011 | c-000012 | yes | 1 | refused | yes | 12 B |
| 5 | r8a/r8b | c-000013 | c-000014 | yes | 1 | refused | yes | 12 B |
| 6 | r9a/r9b | c-000015 | c-000016 | yes | 1 | refused | yes | 12 B |
| 7 | r10a/r10b | c-000017 | c-000018 | yes | 1 | refused | yes | 12 B |
| 8 | r11a/r11b | c-000019 | c-000020 | yes | 1 | refused | yes | 12 B |
| 9 | r12a/r12b | c-000021 | c-000022 | yes | 1 | refused | yes | 12 B |
| 10 | r13a/r13b | c-000023 | c-000024 | yes | 1 | refused | yes | 12 B |

`r5a/r5b` was an incomplete attempt interrupted by the harness being restarted;
it is not counted. `r1a/r1b` was the warm-up round that found the first bugs.

The downloaded video bytes were verified in the warm-up round:

```text
1a45dfa30102030405060708
```

which matches the injected 12-byte WebM exactly.

## Dev-server environment

As of 2026-11-26, `server/src/env.ts` loads the git-ignored `.env` automatically.
A local `.env` with `COMMUNITY_DELIVERY_SECRET=change-me-dev-delivery-secret` is
therefore enough for `npm run dev`; inline variables in the commands above
remain valid and take precedence. This fixes the HTTP 503 seen when the server
was started without that variable in its own terminal.

## Errors found and fixed during the loop

1. **Fake-wallet passphrase was lost on reload.**
   - Symptom: after a reload, unlock silently used the default passphrase and
     the commitment no longer matched the enrolled leaf
     (`Own commitment not found in university leaves`).
   - Fix: `wallet.ts` remembers the fake passphrase in this tab's
     `sessionStorage` (`usafe-dev-fake-wallet-passphrase`) and reuses it when
     `connectWallet()` is called without options. "Start over" clears it.
   - Regression test added in `wallet.test.ts`.

2. **`fetch` was called with the pipeline object as `this`.**
   - Symptom: every filing failed at the “Wrap file keys” step with
     `TypeError: Failed to execute 'fetch' on 'Window': Illegal invocation`.
   - Fix: `SubmissionPipeline` now binds the fetch function
     (`(options.fetchImpl ?? fetch).bind(globalThis)`).
   - Regression test added in `submit.test.ts`.

3. **The feed did not rebuild the in-memory credential after enrolment.**
   - Symptom: the second student saw
     `Your enrollment credential is not ready yet...` immediately after
     enrolling.
   - Fix: `feed.ts` and `detail.ts` now call `refreshCredential()` automatically
     when the secret is unlocked but the cached credential is empty.

4. **Harness-only issue:** the offline simulation restored `fetch` before the
   2–12 second submission delay, so one support request slipped through. The
   harness now keeps the offline override for 20 seconds; no app change was
   needed.

## Final quality gate

```sh
npm run check
# Test Files  41 passed (41)
# Tests       301 passed (301)
# exit 0
```

All changes are left uncommitted.
