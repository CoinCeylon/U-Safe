import { badge } from '../ui/badge';
import { button } from '../ui/button';
import { card } from '../ui/card';
import { select } from '../ui/select';
import {
  fetchDevAccounts,
  fetchHealth,
  loginWithDevAccount,
  loginWithWallet,
  type DevAccount,
  type HealthInfo,
  type StaffSession,
} from './auth';
import { getInstalledWallets, LACE_INSTALL_URL } from '../lib/wallet';

/**
 * University portal login view (M063): a Connect wallet and sign in button
 * running the CIP-8 challenge flow, plus - only when the server reports
 * DEV_LOGIN=true - a dropdown of seeded accounts under a red
 * "development login" label.
 */

export interface LoginViewOptions {
  onLoggedIn: (session: StaffSession) => void;
}

export const createLoginView = ({
  onLoggedIn,
}: LoginViewOptions): HTMLElement => {
  const section = document.createElement('section');
  section.className = 'mx-auto flex w-full max-w-sm flex-col gap-4';

  const heading = document.createElement('h2');
  heading.className = 'text-xl font-semibold text-slate-900';
  heading.textContent = 'University staff sign-in';
  const intro = document.createElement('p');
  intro.className = 'text-sm text-slate-600';
  intro.textContent =
    'Sign in with the wallet registered for your staff account.';
  section.append(heading, intro);

  const errorElement = document.createElement('p');
  errorElement.className = 'hidden text-sm text-danger';
  errorElement.setAttribute('role', 'alert');

  const showError = (message: string): void => {
    errorElement.textContent = message;
    errorElement.classList.remove('hidden');
  };

  const walletButton = button({
    label: 'Connect wallet and sign in',
    onClick: () => {
      walletButton.disabled = true;
      void runWalletLogin(onLoggedIn, showError).finally(() => {
        walletButton.disabled = false;
      });
    },
  });

  const walletCard = card('Wallet sign-in', walletButton);
  section.append(walletCard, errorElement);

  // The check loads Mesh lazily; the hint appears without blocking the page.
  void getInstalledWallets().then((installed) => {
    if (installed.length === 0) {
      walletCard.append(buildInstallHelp());
    }
  });

  const devSection = document.createElement('div');
  devSection.className = 'hidden';
  section.append(devSection);
  void loadDevSection(devSection, onLoggedIn, showError);

  return section;
};

const runWalletLogin = async (
  onLoggedIn: (session: StaffSession) => void,
  showError: (message: string) => void,
): Promise<void> => {
  try {
    const result = await loginWithWallet();
    if ('session' in result) {
      onLoggedIn(result.session);
      return;
    }
    showError(result.error.message);
  } catch {
    showError('Wallet sign-in failed. Please try again.');
  }
};

const buildInstallHelp = (): HTMLParagraphElement => {
  const help = document.createElement('p');
  help.className = 'text-sm text-slate-600';
  const link = document.createElement('a');
  link.href = LACE_INSTALL_URL;
  link.target = '_blank';
  link.rel = 'noreferrer';
  link.className = 'text-primary underline';
  link.textContent = 'Install the Lace wallet';
  help.append('No Cardano wallet detected. ', link, ', then reload this page.');
  return help;
};

const loadDevSection = async (
  container: HTMLElement,
  onLoggedIn: (session: StaffSession) => void,
  showError: (message: string) => void,
): Promise<void> => {
  let health: HealthInfo | null = null;
  try {
    health = await fetchHealth();
  } catch {
    health = null;
  }
  if (health === null || !health.devLogin) {
    return;
  }

  let accounts: DevAccount[] = [];
  try {
    accounts = await fetchDevAccounts();
  } catch {
    accounts = [];
  }
  if (accounts.length === 0) {
    return;
  }

  const labelRow = document.createElement('div');
  labelRow.className = 'flex items-center gap-2';
  labelRow.append(badge('DEVELOPMENT LOGIN', 'danger'));
  const note = document.createElement('span');
  note.className = 'text-xs text-slate-500';
  note.textContent = 'dev-only, bypasses the wallet';
  labelRow.append(note);

  const accountSelect = select({
    id: 'dev-account',
    label: 'Seeded account',
    options: accounts.map((account) => ({
      value: String(account.id),
      label: `${account.universityName ?? account.universityId ?? 'University'} — ${account.role}`,
    })),
  });

  const devButton = button({
    label: 'Sign in (dev)',
    variant: 'danger',
    onClick: () => {
      const control =
        accountSelect.querySelector<HTMLSelectElement>('#dev-account');
      const staffId = Number(control?.value);
      if (!Number.isInteger(staffId) || staffId <= 0) {
        return;
      }
      devButton.disabled = true;
      void runDevLogin(staffId, onLoggedIn, showError).finally(() => {
        devButton.disabled = false;
      });
    },
  });

  container.className = 'flex flex-col gap-2';
  container.replaceChildren(
    labelRow,
    card('Seeded staff accounts', accountSelect, devButton),
  );
};

const runDevLogin = async (
  staffId: number,
  onLoggedIn: (session: StaffSession) => void,
  showError: (message: string) => void,
): Promise<void> => {
  try {
    const result = await loginWithDevAccount(staffId);
    if ('session' in result) {
      onLoggedIn(result.session);
      return;
    }
    showError(
      result.error.kind === 'invalid'
        ? 'Development login failed. Run npm run seed first.'
        : result.error.message,
    );
  } catch {
    showError('Development login failed.');
  }
};
