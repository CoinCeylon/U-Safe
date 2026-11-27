import { describe, expect, it } from 'vitest';
import {
  PRIVACY_NOTICE_HEADING,
  PRIVACY_NOTICE_LINES,
} from './wizard';

describe('M049 onboarding privacy notice', () => {
  const copy = [PRIVACY_NOTICE_HEADING, ...PRIVACY_NOTICE_LINES].join(' ');

  it('does not claim the university cannot read complaint text or evidence', () => {
    expect(copy).not.toMatch(/cannot see your complaint text/i);
    expect(copy).not.toMatch(/cannot see your evidence/i);
  });

  it('states who can read text and evidence', () => {
    expect(copy).toMatch(/university can read the complaint text and evidence/i);
    expect(copy).toMatch(/other students .* complaint text, but not evidence/i);
    expect(copy).toMatch(/UGC can read both/i);
    expect(copy).toMatch(/only the UGC can read the details and evidence/i);
    expect(copy).toMatch(/server operator could also decrypt complaint text/i);
  });

  it('keeps the identity and email promise honest', () => {
    expect(copy).toMatch(/cannot link a complaint.*to you/i);
    expect(copy).toMatch(/email is used only for the enrolment code/i);
  });
});
