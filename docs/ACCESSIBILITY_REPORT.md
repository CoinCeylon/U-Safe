# Accessibility / Keyboard Report

Date: 2026-11-25
Milestone: M062

## Automated checks present in `npm run check`

- `apps/web/src/ui/frame.test.ts` verifies the mock-banner predicate used by the
  shared frame.
- `apps/web/src/student/detail.test.ts` covers the four complaint states.
- The UI source uses native controls with labels, `alt` text on the evidence
  preview, `aria-live="polite"` on the toast host, `role="status"` on progress
  areas, a skip link and a focusable `main` landmark.

There is no axe-core dependency in the locked dependency set, so no automated
axe run is performed. The checks below are the recorded keyboard/accessibility
walkthrough.

## Keyboard walkthrough (student portal)

1. Load the student portal and press Tab. The first stop is "Skip to main
   content"; Enter moves focus into `main`.
2. Tab through the wizard: university select, email input, Continue, Back. All
   focus rings are visible (global `:focus-visible` outline in `app.css`).
3. On step 3, Tab reaches the fake-wallet passphrase field and the Connect
   button. Enter connects; focus does not get trapped.
4. Enrolment success screen: Tab reaches "Go to the feed" and "My complaints".
5. Feed: Tab reaches the status filter, category filter, sort select, each card
   link and the Support button. Enter on a card link opens the detail page.
6. Detail: the description is announced, the timeline is an ordered list, and
   the Support button has a text label in every state (Checking/Supporting/You
   support this).
7. File complaint: Tab reaches description, category, urgency radios, staff
   checkbox, accused details, file picker, metadata acknowledgement and Submit.
   Submitting with an empty description focuses the description field and shows
   an alert-region message.
8. Help page is static, keyboard readable, and works offline.

## Known limitations

- Video/document evidence cannot have metadata removed; the form requires an
  explicit acknowledgement checkbox.
- The university and UGC overview pages are read-only placeholders until
  M063+/M073+ and use the same native controls and frame.

No critical accessibility issue was found in this walkthrough.
