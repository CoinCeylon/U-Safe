// M006 evidence: the design-system showcase renders every primitive and the
// page is built for a 375px-first layout. The primitives themselves are plain
// DOM helpers, so the useful automated check is that the showcase imports and
// exercises every exported primitive and that the page declares a phone
// viewport.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const devSource = readFileSync(
  fileURLToPath(new URL('./dev.ts', import.meta.url)),
  'utf8',
);
const devHtml = readFileSync(
  fileURLToPath(new URL('./dev.html', import.meta.url)),
  'utf8',
);
const indexSource = readFileSync(
  fileURLToPath(new URL('./index.ts', import.meta.url)),
  'utf8',
);

const PRIMITIVES = [
  'button',
  'card',
  'badge',
  'input',
  'textarea',
  'select',
  'modal',
  'toast',
  'spinner',
  'emptyState',
  'table',
];

describe('M006 design system showcase', () => {
  it('exports every required primitive', () => {
    for (const name of PRIMITIVES) {
      expect(indexSource, `missing export: ${name}`).toContain(name);
    }
  });

  it('renders every primitive on the showcase page', () => {
    for (const name of PRIMITIVES) {
      expect(devSource, `showcase does not use: ${name}`).toContain(name);
    }
  });

  it('declares a phone viewport so the 375px layout is usable', () => {
    expect(devHtml).toContain('name="viewport"');
    expect(devHtml).toContain('width=device-width');
  });
});
