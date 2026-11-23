import { describe, it, expect } from 'vitest';
import {
  deriveStudentSecret,
  studentSecretMessage,
} from './secret';

const enc = new TextEncoder();

describe('studentSecretMessage', () => {
  it('builds the fixed message with the university id appended', () => {
    expect(studentSecretMessage('uni-a')).toBe(
      'U-Safe student secret v1|uni-a',
    );
    expect(studentSecretMessage('uni-b')).toBe(
      'U-Safe student secret v1|uni-b',
    );
  });
});

describe('deriveStudentSecret', () => {
  const signature = enc.encode(
    'deterministic-fake-signature-bytes-for-testing',
  );

  it('always returns a 32-byte secret', async () => {
    const secret = await deriveStudentSecret(signature, 'uni-a');
    expect(secret).toHaveLength(32);
  });

  it('is deterministic: same inputs give the same secret', async () => {
    const a = await deriveStudentSecret(signature, 'uni-a');
    const b = await deriveStudentSecret(signature, 'uni-a');
    expect(a).toEqual(b);
  });

  it('a different university id gives a different secret', async () => {
    const a = await deriveStudentSecret(signature, 'uni-a');
    const b = await deriveStudentSecret(signature, 'uni-b');
    expect(a).not.toEqual(b);
  });

  it('a different signature gives a different secret', async () => {
    const a = await deriveStudentSecret(enc.encode('sig-one'), 'uni-a');
    const b = await deriveStudentSecret(enc.encode('sig-two'), 'uni-a');
    expect(a).not.toEqual(b);
  });
});
