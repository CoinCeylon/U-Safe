// Student wallet connection module.
//
// Supports two wallets:
//   - Lace (real, via the Mesh SDK BrowserWallet, CIP-30 / CIP-8 signData) —
//     the production path for connecting a student's wallet.
//   - FakeWallet (development only, ?fakewallet=1) — derives a deterministic
//     HMAC-SHA256 signature from a typed passphrase. A red warning must be shown
//     whenever the fake wallet is active.
//
// The Mesh SDK is the source of truth for the Lace integration:
//   @meshsdk/core ^1.9.1
//     - BrowserWallet.getInstalledWallets() -> Wallet[] { id, name, icon, version }
//     - BrowserWallet.enable('lace') -> BrowserWallet
//     - browserWallet.signData(payload, address?) -> DataSignature { signature, key }
//     - browserWallet.getUsedAddresses() -> string[]
//   Lace wallet name: 'lace'
//   Lace install URL: https://lace.dev/
//
// Never invent Mesh SDK APIs. If @meshsdk/core changes, adapt this file and
// record the difference in docs/DECISIONS.md.

import type { BrowserWallet, DataSignature } from '@meshsdk/core';

const LACE_WALLET_NAME = 'lace';
const LACE_INSTALL_URL = 'https://lace.dev/';
// Default passphrase used by the fake wallet when none is supplied (dev only).
const DEV_FAKE_PASSPHRASE = 'u-safe-dev-fake-wallet';

// Mesh is loaded on first use only. Its dependencies need Node built-ins, so a
// static import would stop the whole student portal from loading (blank page).
const loadMesh = () => import('@meshsdk/core');

export type WalletType = 'lace' | 'fake';

export interface StudentWallet {
  connect(): Promise<void>;
  getAddress(): string | null;
  signMessage(message: string): Promise<string>;
  isConnected(): boolean;
  getType(): WalletType;
}

// ---------------------------------------------------------------------------
// Lace wallet (real, CIP-30 / CIP-8 via Mesh SDK)
// ---------------------------------------------------------------------------

class LaceWallet implements StudentWallet {
  private wallet: BrowserWallet | null = null;
  private address: string | null = null;

  getType(): WalletType {
    return 'lace';
  }

  isConnected(): boolean {
    return this.wallet !== null;
  }

  getAddress(): string | null {
    return this.address;
  }

  async connect(): Promise<void> {
    const mesh = await loadMesh();
    const installed = mesh.BrowserWallet.getInstalledWallets();
    const lace = installed.find((w) => w.name === LACE_WALLET_NAME);
    if (!lace) {
      throw new Error(
        'Lace wallet is not installed. Install it from ' + LACE_INSTALL_URL,
      );
    }
    this.wallet = await mesh.BrowserWallet.enable(LACE_WALLET_NAME);

    const addresses = await this.wallet.getUsedAddresses();
    this.address = addresses[0] ?? null;
    if (!this.address) {
      const rewards = await this.wallet.getRewardAddresses();
      this.address = rewards[0] ?? null;
    }
    if (!this.address) {
      throw new Error('Lace wallet returned no address');
    }
  }

  async signMessage(message: string): Promise<string> {
    if (!this.wallet || !this.address) {
      throw new Error('Lace wallet is not connected');
    }
    const signature: DataSignature = await this.wallet.signData(
      message,
      this.address,
    );
    return signature.signature;
  }
}

// ---------------------------------------------------------------------------
// Fake wallet (development only)
// ---------------------------------------------------------------------------

const encoder = new TextEncoder();

async function sha256Bytes(input: string): Promise<Uint8Array> {
  const hash = await crypto.subtle.digest('SHA-256', encoder.encode(input));
  return new Uint8Array(hash);
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export class FakeWallet implements StudentWallet {
  private readonly passphrase: string;
  private address: string | null = null;
  private connected = false;
  private signingKey: CryptoKey | null = null;

  constructor(passphrase: string) {
    this.passphrase = passphrase;
  }

  getType(): WalletType {
    return 'fake';
  }

  isConnected(): boolean {
    return this.connected;
  }

  getAddress(): string | null {
    return this.address;
  }

  async connect(): Promise<void> {
    const seed = await sha256Bytes(this.passphrase);
    // Deterministic testnet-style bech32-looking address (development only).
    this.address = 'addr_test1' + toHex(seed).slice(0, 44);
    this.signingKey = await crypto.subtle.importKey(
      'raw',
      encoder.encode(this.passphrase),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    this.connected = true;
  }

  async signMessage(message: string): Promise<string> {
    if (!this.connected || !this.signingKey) {
      throw new Error('Fake wallet is not connected');
    }
    const signature = await crypto.subtle.sign(
      'HMAC',
      this.signingKey,
      encoder.encode(message),
    );
    return toHex(new Uint8Array(signature));
  }
}

// ---------------------------------------------------------------------------
// Module-level active wallet
// ---------------------------------------------------------------------------

let active: StudentWallet | null = null;

// The fake wallet's passphrase is development-only and must survive a reload:
// `unlockStudent` calls `connectWallet()` without a passphrase after a refresh,
// so the typed passphrase is remembered in this tab's sessionStorage. A real
// Lace wallet persists its own account, so this is never used outside fake mode.
const FAKE_PASSPHRASE_KEY = 'usafe-dev-fake-wallet-passphrase';

function rememberFakePassphrase(passphrase: string): void {
  try {
    sessionStorage.setItem(FAKE_PASSPHRASE_KEY, passphrase);
  } catch {
    // Storage is optional; the current session still works in memory.
  }
}

function readRememberedFakePassphrase(): string | null {
  try {
    return sessionStorage.getItem(FAKE_PASSPHRASE_KEY);
  } catch {
    return null;
  }
}

/** Clears the fake wallet and its remembered passphrase (development only). */
export function clearFakeWalletSession(): void {
  if (active?.getType() === 'fake') {
    active = null;
  }
  try {
    sessionStorage.removeItem(FAKE_PASSPHRASE_KEY);
  } catch {
    // ignore
  }
}

export function isFakeWalletMode(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  return new URLSearchParams(window.location.search).get('fakewallet') === '1';
}

export function getWalletType(): WalletType | null {
  return active?.getType() ?? null;
}

export function isConnected(): boolean {
  return active?.isConnected() ?? false;
}

export function getAddress(): string | null {
  return active?.getAddress() ?? null;
}

export async function isLaceInstalled(): Promise<boolean> {
  try {
    const mesh = await loadMesh();
    const installed = mesh.BrowserWallet.getInstalledWallets();
    return installed.some((w) => w.name === LACE_WALLET_NAME);
  } catch {
    return false;
  }
}

export function laceInstallUrl(): string {
  return LACE_INSTALL_URL;
}

export async function connectWallet(options?: {
  passphrase?: string;
}): Promise<void> {
  if (isFakeWalletMode()) {
    const passphrase =
      options?.passphrase ??
      readRememberedFakePassphrase() ??
      DEV_FAKE_PASSPHRASE;
    rememberFakePassphrase(passphrase);
    active = new FakeWallet(passphrase);
  } else {
    active = new LaceWallet();
  }
  await active.connect();
}

export async function signMessage(message: string): Promise<string> {
  if (!active) {
    throw new Error(
      'Wallet is not connected. Call connectWallet() first.',
    );
  }
  return active.signMessage(message);
}
