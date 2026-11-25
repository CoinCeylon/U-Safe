import { describe, expect, it } from 'vitest';
import { FakeWallet } from './wallet';

describe('FakeWallet (development only)', () => {
  it('derives a deterministic signature for the same message and passphrase', async () => {
    const a = new FakeWallet('dev-passphrase');
    const b = new FakeWallet('dev-passphrase');
    await a.connect();
    await b.connect();

    const message = 'U-Safe student secret v1|university-demo';
    const sigA = await a.signMessage(message);
    const sigB = await b.signMessage(message);

    expect(sigA).toBe(sigB);
    expect(sigA.length).toBeGreaterThan(0);
  });

  it('derives different signatures for different passphrases', async () => {
    const a = new FakeWallet('passphrase-one');
    const b = new FakeWallet('passphrase-two');
    await a.connect();
    await b.connect();

    const message = 'U-Safe student secret v1|university-demo';
    const sigA = await a.signMessage(message);
    const sigB = await b.signMessage(message);

    expect(sigA).not.toBe(sigB);
  });

  it('reports the same address for the same passphrase', async () => {
    const a = new FakeWallet('dev-passphrase');
    const b = new FakeWallet('dev-passphrase');
    await a.connect();
    await b.connect();

    expect(a.getAddress()).toBe(b.getAddress());
    expect(a.getAddress()).toMatch(/^addr_test1/);
  });

  it('rejects signing before connect', async () => {
    const a = new FakeWallet('dev-passphrase');
    await expect(a.signMessage('hello')).rejects.toThrow(
      'Fake wallet is not connected',
    );
  });
});
