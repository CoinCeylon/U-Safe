# AGENT.md

Operating instructions for AI coding agents working on U-Safe.

## 1. Scope and authority

- The product specification is `refs/U-Safe-spec.md`.
- The execution plan is `refs/U-Safe Build Roadmap Agent Milestones.md`.
- Where the spec and the roadmap conflict, **the roadmap wins**.
- Work milestones strictly in order. Do not start a milestone until the previous
  one meets its **Done when** line.

## 2. Required workflow per milestone

1. Read the milestone carefully and implement only that milestone.
2. Run `npm run check` (typecheck, lint, unit tests). Fix every error and warning
   until it exits with code 0. Do not stop while it is failing.
3. Append one line to `docs/PROGRESS.md` in the form
   `Mxxx | done | <one sentence on what exists now>`.
4. **Stop after completing one milestone.** Do not begin the next milestone in the
   same run.
5. **Never commit into the repo.** Leave all changes uncommitted for the human to
   review and commit.

## 3. Working rules

- Never invent library APIs for Cardano, Mesh SDK, Aiken or Midnight. Read the
  current official documentation and example repositories first. Record exact
  package names and versions in `docs/DECISIONS.md`. If a named function does not
  exist or differs in the real SDK, adapt and record the difference.
- Keep files small, one responsibility per file. Comment anything involving
  cryptography.
- Never commit secrets (mnemonics, API keys, SMTP passwords, private keys). Use
  git-ignored `.env` files and keep `.env.example` current.
- If a milestone is ambiguous, choose the simplest option that satisfies
  **Done when**, record the choice in `docs/DECISIONS.md`, and move on. Do not
  ask questions that block progress.
- Never overwrite unnecessary files. Prefer the smallest targeted edit. Do not
  recreate or replace files that already exist unless the milestone explicitly
  requires it.
- A milestone marked **HUMAN ACTION** needs something only a person can do. Write
  exact steps into `docs/HUMAN_TODO.md`, then continue with any mock-mode work
  that does not depend on it. If nothing can continue, stop and write the blocker
  into `docs/BLOCKERS.md`.

## 4. Privacy rules (never break these)

- Never log email addresses, IP addresses, commitments, nullifiers or request
  bodies of student actions. Logs may contain only request path, status code and
  duration.
- Never store a pairing between an email address and a commitment, in any table,
  file or log.
- Never put plaintext complaint text, evidence, names, emails or wallet addresses
  of students on any chain.
- Never add analytics, tracking scripts or third-party scripts to the web app.
  Fonts must be self-hosted.
- Student actions must never depend on a student login session. A student is
  recognised only by a proof of enrollment attached to each request.

## 5. Locked technology decisions

- Language: TypeScript with `strict` on, everywhere except Aiken and Compact.
  Node.js 20 LTS. npm workspaces. Tests with Vitest.
- Web: Vite multi-page app (three entry pages), plain TypeScript and DOM,
  Tailwind CSS 3. No React, Vue or other UI framework.
- Server: Fastify, better-sqlite3, zod for validation. Deliberately small.
- Cardano: Aiken validators, Mesh SDK, Lace wallet via CIP-30, CIP-8 message
  signing, CIP-68 style tokens, Cardano preprod network.
- Midnight: one Compact contract, Midnight JS SDK, local proof server in Docker,
  Lace wallet, Midnight testnet.
- Do not use Frostbyte unless a human adds instructions to `docs/HUMAN_TODO.md`.

## 6. Mock first, real chains later

- Groups 1 to 7 produce a fully working product in mock mode.
- Groups 8 to 10 build the real Aiken and Compact code and swap the mock by
  changing `CHAIN_MODE=mock|testnet`.
- Mock mode is not anonymous; the mock proof contains the commitment and Merkle
  path so the server can check membership, then discards it. Every portal shows
  a visible "MOCK MODE: anonymity is simulated" banner when `CHAIN_MODE=mock`.

## 7. Server rules

- The server is a trusted-but-blind helper. It sends email codes, stores
  encrypted blobs, relays transactions, runs the mock chain, and fans out live
  events. It must never hold a student secret, plaintext complaint, or a private
  key of a university or the UGC.

## 8. Fixed product constants

All constants live in `packages/shared/src/constants.ts`, each overridable by
environment variable: Merkle tree depth 20; OTP 6 digits, 10 minutes, 5 attempts;
2 complaints per student per month; at most 5 evidence files, 25 MB each;
categories `verbal, physical, sexual, cyber, financial, other`; urgency
`normal, urgent`; status `not_started, pending_investigation, finished` plus
`escalated` and `reopened` booleans; deadlines 7 days normal / 24 hours urgent
(with `DEMO_SLA_SECONDS` override); support alert threshold 10 (with
`SUPPORT_ALERT_THRESHOLD` override); minimum group size 5.

## 9. Out of scope

Anonymous pattern detection of accused persons, community satisfaction vote and
automatic reopening, monthly Merkle history anchor, and sealed identity
envelopes. Do not build these.

## 10. Quality gate

- `npm run check` must pass before reporting a milestone complete.
- Typecheck, lint and tests all run across workspaces.
- A single failing check means the milestone is not done.