import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  OFFLINE_MESSAGE,
  friendlyError,
  isOfflineError,
} from './offline';

describe('offline helpers (M062)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('recognises fetch network failures (TypeError)', () => {
    const error = new TypeError('fetch failed');
    expect(isOfflineError(error)).toBe(true);
  });

  it('recognises the browser offline state for any error', () => {
    vi.stubGlobal('navigator', { onLine: false });
    expect(isOfflineError(new Error('anything'))).toBe(true);
  });

  it('does not treat ordinary server errors as offline', () => {
    vi.stubGlobal('navigator', { onLine: true });
    expect(isOfflineError(new Error('HTTP 400'))).toBe(false);
    expect(isOfflineError('not an error')).toBe(false);
  });

  it('maps offline errors to the friendly offline message', () => {
    vi.stubGlobal('navigator', { onLine: true });
    expect(friendlyError(new TypeError('fetch failed'), 'fallback')).toBe(
      OFFLINE_MESSAGE,
    );
  });

  it('keeps a real error message when it is not offline', () => {
    vi.stubGlobal('navigator', { onLine: true });
    expect(friendlyError(new Error('filing nullifier already used'), 'x')).toBe(
      'filing nullifier already used',
    );
  });

  it('falls back to the given message for unknown errors', () => {
    vi.stubGlobal('navigator', { onLine: true });
    expect(friendlyError('mystery', 'Could not do the thing.')).toBe(
      'Could not do the thing.',
    );
    expect(friendlyError(new Error(''), 'Could not do the thing.')).toBe(
      'Could not do the thing.',
    );
  });
});
