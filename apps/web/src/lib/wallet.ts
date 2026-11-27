/**
 * Shared CIP-30 wallet module used by the university portal login (M063) and
 * later by the student portal (M050). Wraps Mesh's BrowserWallet behind a
 * small interface so portals never touch the SDK directly.
 *
 * Mesh's browser bundle is several megabytes, so it is imported dynamically
 * and only when a wallet action actually happens.
 */

export interface InstalledWallet {
  id: string;
  name: string;
}

/** CIP-8 `signData` result: hex-encoded signature and public key. */
export interface WalletSignature {
  signature: string;
  key: string;
}

export interface ConnectedWallet {
  /** The wallet's change address (bech32). */
  getAddress(): Promise<string>;
  /**
   * Signs a fixed message with CIP-30 `signData` (CIP-8 envelope). The
   * signature is deterministic for a given wallet and message.
   */
  signMessage(message: string): Promise<WalletSignature>;
}

export const LACE_INSTALL_URL = 'https://lace.io/';

const loadMesh = async (): Promise<
  (typeof import('@meshsdk/core'))['BrowserWallet']
> => {
  const mesh = await import('@meshsdk/core');
  return mesh.BrowserWallet;
};

export const getInstalledWallets = async (): Promise<InstalledWallet[]> => {
  const BrowserWallet = await loadMesh();
  return BrowserWallet.getInstalledWallets().map((wallet) => ({
    id: wallet.id,
    name: wallet.name,
  }));
};

export const connectWallet = async (
  walletId = 'lace',
): Promise<ConnectedWallet> => {
  const BrowserWallet = await loadMesh();
  const wallet = await BrowserWallet.enable(walletId);
  return {
    getAddress: () => wallet.getChangeAddress(),
    signMessage: async (message: string) => {
      const address = await wallet.getChangeAddress();
      // Mesh's BrowserWallet.signData signature is (payload, address?), not
      // (address, payload). Passing the address first makes CIP-8 login sign
      // the address as the payload and fails verification.
      return wallet.signData(message, address);
    },
  };
};
