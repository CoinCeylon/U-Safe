# Design System 375px Report

Date: 2026-11-25
Milestone: M006

## Evidence

- `apps/web/src/ui/index.ts` exports every primitive: button, card, badge,
  input, textarea, select, modal, toast, spinner, emptyState, table.
- `apps/web/src/ui/dev.ts` renders every one of them on the showcase page.
- `apps/web/src/ui/dev.html` declares `width=device-width, initial-scale=1`.
- `apps/web/src/ui/dev.test.ts` asserts all of the above so a missing primitive
  or missing viewport tag fails `npm run check`.

## Manual check at 375px

The showcase uses a single-column, `max-w-3xl` layout with `p-4` padding; the
button row is `flex flex-wrap` and cards/inputs are full width. A browser
DevTools check at 375×812 was performed while building M006 and again after the
audit changes: no horizontal overflow, all controls reachable, modal and toast
usable.

If a future change adds a fixed-width element, re-run this check before marking
M006 complete again.
