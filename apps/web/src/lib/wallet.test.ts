import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getChangeAddress: vi.fn(),
  signData: vi.fn(),
  enable: vi.fn(),
  getInstalledWallets: vi.fn(),
}));

vi.mock('@meshsdk/core', () => ({
  BrowserWallet: {
    enable: mocks.enable,
    getInstalledWallets: mocks.getInstalledWallets,
  },
}));

import { connectWallet, getInstalledWallets } from './wallet';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getChangeAddress.mockResolvedValue('addr_test1vqexample');
  mocks.signData.mockResolvedValue({
    signature: 'signature-hex',
    key: 'key-hex',
  });
  mocks.enable.mockResolvedValue({
    getChangeAddress: mocks.getChangeAddress,
    signData: mocks.signData,
  });
  mocks.getInstalledWallets.mockReturnValue([
    { id: 'lace', name: 'Lace', icon: 'icon', version: '1' },
  ]);
});

describe('shared university wallet module (M063)', () => {
  it('passes the message as the signData payload and the address second', async () => {
    const wallet = await connectWallet('lace');
    const result = await wallet.signMessage('U-Safe staff sign-in nonce');

    expect(mocks.enable).toHaveBeenCalledWith('lace');
    expect(mocks.signData).toHaveBeenCalledWith(
      'U-Safe staff sign-in nonce',
      'addr_test1vqexample',
    );
    expect(result).toEqual({
      signature: 'signature-hex',
      key: 'key-hex',
    });
  });

  it('maps installed wallets by id and name for the login page', async () => {
    await expect(getInstalledWallets()).resolves.toEqual([
      { id: 'lace', name: 'Lace' },
    ]);
  });
});
