# U-Safe Architecture

U-Safe is an anonymous university ragging complaint system built on Cardano (Aiken)
and Midnight (Compact). Three portals (student, university, UGC) share one Vite
web app; a small Fastify + SQLite server acts as a trusted-but-blind helper.

## Components

- **Web app** (`apps/web`): Vite multi-page app, plain TypeScript + DOM, Tailwind 3.
- **Server** (`server`): Fastify, better-sqlite3, zod validation. Stores encrypted
  blobs, sends OTP codes, runs the mock chain, fans out live events.
- **Shared** (`packages/shared`): types, constants, zod schemas.
- **Crypto** (`packages/crypto`): client-side hashing, Merkle, AES, RSA, stripping.
- **Chain** (`packages/chain`): `LedgerAdapter` interface with mock implementation.
- **Contracts** (`contracts/aiken`, `contracts/compact`): real chain code (later groups).

## Rules

- Students have no login sessions; each request carries a proof of enrollment.
- Never log emails, IPs, commitments, nullifiers or request bodies.
- Never store an email-to-commitment pairing.
- Never put plaintext complaint text or evidence on any chain.
- No analytics or third-party scripts; fonts self-hosted.
- Secrets live only in `.env` (git-ignored); `.env.example` stays current.

## Chain modes

`CHAIN_MODE=mock|testnet`. Groups 1-7 work fully in mock mode.