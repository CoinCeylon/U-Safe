import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeWallet, isLaceWallet } from './wallet';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('Lace wallet detection (M050)', () => {
  it('matches the CIP-30 id, not the capitalised display name', () => {
    expect(isLaceWallet({ id: 'lace' })).toBe(true);
    expect(isLaceWallet({ id: 'eternl' })).toBe(false);
    // The display name is "Lace"; matching it case-sensitively must not count.
    expect(isLaceWallet({ id: 'Lace' })).toBe(false);
  });
});

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

  it('remembers the fake passphrase across a module reload', async () => {
    vi.stubGlobal('window', { location: { search: '?fakewallet=1' } });
    const values = new Map<string, string>();
    vi.stubGlobal('sessionStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, String(value)),
      removeItem: (key: string) => void values.delete(key),
    });

    vi.resetModules();
    const first = await import('./wallet');
    await first.connectWallet({ passphrase: 'round-passphrase' });
    const firstAddress = first.getAddress();

    // A reload clears module state but keeps sessionStorage.
    vi.resetModules();
    const second = await import('./wallet');
    await second.connectWallet();
    expect(second.getAddress()).toBe(firstAddress);
    expect(values.get('usafe-dev-fake-wallet-passphrase')).toBe(
      'round-passphrase',
    );
  });
});
