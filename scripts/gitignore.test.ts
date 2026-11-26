// M001 evidence: the repository ignores every required build/secret pattern.
// This is a plain file check so it runs in the same `npm run check` gate as
// the rest of the suite.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const rootIgnore = readFileSync(
  fileURLToPath(new URL('../.gitignore', import.meta.url)),
  'utf8',
);

const REQUIRED_PATTERNS = [
  'node_modules',
  'dist',
  '.env',
  '*.db',
  '.aiken',
  'build/',
  'coverage/',
  '.dev-keys/',
];

describe('M001 .gitignore', () => {
  it('ignores dependencies, build output, secrets, databases and Aiken artifacts', () => {
    for (const pattern of REQUIRED_PATTERNS) {
      expect(rootIgnore, `missing ignore entry: ${pattern}`).toContain(pattern);
    }
  });

  it('keeps .env.example tracked', () => {
    expect(rootIgnore).toContain('!.env.example');
  });
});
