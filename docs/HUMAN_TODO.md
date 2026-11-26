# U-Safe Human TODO

The fixing agent completed the audit fixes without blocking on a human. The
following are verification-only follow-ups that need a real browser or wallet.

## Audit verification (2026-11-25)

1. **Real Lace CIP-8 login (M032/M063).** The server now verifies signatures with
   Mesh `checkSignature`, but the happy path needs a real Lace wallet on preprod.
   Request `POST /api/auth/challenge`, sign the nonce with CIP-30 `signData`, and
   post `{address, key, signature, nonce}` to `/api/auth/login`. Wrong signature,
   replay and expiry are already unit-tested.
2. **Real IndexedDB reload (M020).** The unit suite models a reload over a shared
   storage backend. Open the student portal, enrol, close and reopen the tab, and
   confirm the encrypted receipt is still readable after re-unlocking.
3. **Accessibility pass (M062).** Run an axe-core browser extension or similar on
   the student portal at 375px and record any critical issues. The keyboard
   walkthrough is in `docs/ACCESSIBILITY_REPORT.md`.
4. **Design showcase at 375px (M006).** Open `/src/ui/dev.html` at 375×812 and
   confirm no horizontal overflow; see `docs/DESIGN_SYSTEM_REPORT.md`.
