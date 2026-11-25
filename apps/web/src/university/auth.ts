import {
  connectWallet,
  getInstalledWallets,
  LACE_INSTALL_URL,
  type WalletSignature,
} from '../lib/wallet';

/**
 * University portal auth client (M063). Wraps the M032 endpoints:
 * GET /api/auth/challenge, POST /api/auth/login, POST /api/auth/dev-login
 * and GET /api/staff/me. The session token lives in sessionStorage only.
 */

export interface StaffInfo {
  id: number;
  role: string;
  universityId: string | null;
  address: string;
}

export interface StaffSession {
  token: string;
  staff: StaffInfo;
}

export interface DevAccount {
  id: number;
  role: string;
  universityId: string | null;
  universityName: string | null;
  address: string;
}

export interface HealthInfo {
  ok: boolean;
  mode: string;
  devLogin: boolean;
}

export interface LoginError {
  kind: 'no_wallet' | 'rejected' | 'invalid' | 'network';
  message: string;
}

const SESSION_KEY = 'usafe.university.session';

const parseStaff = (raw: Record<string, unknown>): StaffInfo => ({
  id: Number(raw.id),
  role: String(raw.role),
  universityId:
    typeof raw.university_id === 'string' ? raw.university_id : null,
  address: String(raw.address),
});

const request = async <T>(
  path: string,
  init?: RequestInit,
): Promise<{ status: number; body: T | null }> => {
  const response = await fetch(path, init);
  let body: T | null = null;
  try {
    body = (await response.json()) as T;
  } catch {
    body = null;
  }
  return { status: response.status, body };
};

const postJson = <T>(
  path: string,
  payload: unknown,
): Promise<{ status: number; body: T | null }> =>
  request<T>(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });

export const loadSession = (): StaffSession | null => {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (raw === null) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<StaffSession>;
    if (
      typeof parsed.token !== 'string' ||
      parsed.token === '' ||
      typeof parsed.staff !== 'object' ||
      parsed.staff === null
    ) {
      return null;
    }
    return {
      token: parsed.token,
      staff: {
        id: Number(parsed.staff.id),
        role: String(parsed.staff.role),
        universityId:
          parsed.staff.universityId === null ||
          parsed.staff.universityId === undefined
            ? null
            : String(parsed.staff.universityId),
        address: String(parsed.staff.address),
      },
    };
  } catch {
    return null;
  }
};

export const saveSession = (session: StaffSession): void => {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
};

export const clearSession = (): void => {
  sessionStorage.removeItem(SESSION_KEY);
};

export const fetchHealth = async (): Promise<HealthInfo | null> => {
  const { body } = await request<HealthInfo>('/api/health');
  if (body === null || typeof body.ok !== 'boolean') {
    return null;
  }
  return {
    ok: body.ok,
    mode: String(body.mode),
    devLogin: body.devLogin === true,
  };
};

export const fetchDevAccounts = async (): Promise<DevAccount[]> => {
  const { body } = await request<{ accounts: DevAccount[] }>(
    '/api/auth/dev-accounts',
  );
  return body?.accounts ?? [];
};

const fetchStaffMe = async (token: string): Promise<StaffInfo | null> => {
  const { status, body } = await request<{ staff: Record<string, unknown> }>(
    '/api/staff/me',
    { headers: { authorization: `Bearer ${token}` } },
  );
  if (status !== 200 || body === null || body.staff === undefined) {
    return null;
  }
  return parseStaff(body.staff);
};

const startSession = async (
  token: string,
): Promise<{ session: StaffSession } | { error: LoginError }> => {
  const staff = await fetchStaffMe(token);
  if (staff === null) {
    return {
      error: { kind: 'invalid', message: 'The session could not be verified.' },
    };
  }
  const session = { token, staff };
  saveSession(session);
  return { session };
};

/**
 * Full CIP-8 wallet login: challenge -> connect wallet -> signData ->
 * POST /api/auth/login -> verify via /api/staff/me -> store the session.
 */
export const loginWithWallet = async (
  walletId = 'lace',
): Promise<{ session: StaffSession } | { error: LoginError }> => {
  const installed = await getInstalledWallets();
  if (installed.length === 0) {
    return {
      error: {
        kind: 'no_wallet',
        message: `No Cardano wallet detected. Install Lace from ${LACE_INSTALL_URL} and reload this page.`,
      },
    };
  }

  try {
    const { body: challengeBody } = await request<{ nonce: string }>(
      '/api/auth/challenge',
    );
    const nonce = challengeBody?.nonce !== undefined ? challengeBody.nonce : '';

    const wallet = await connectWallet(walletId);
    const address = await wallet.getAddress();
    const signature: WalletSignature = await wallet.signMessage(nonce);

    const { status, body } = await postJson<{ token: string }>(
      '/api/auth/login',
      {
        address,
        signature: signature.signature,
        key: signature.key,
        nonce,
      },
    );
    if (status !== 200 || body === null || typeof body.token !== 'string') {
      return {
        error: {
          kind: 'invalid',
          message:
            'Sign-in failed. This wallet is not registered as university staff.',
        },
      };
    }
    return await startSession(body.token);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('not registered')) {
      return { error: { kind: 'invalid', message } };
    }
    return {
      error: { kind: 'network', message: 'Sign-in could not be completed.' },
    };
  }
};

/**
 * Development login (only when the server reports DEV_LOGIN=true): picks a
 * seeded staff account from the dropdown and signs in as that account.
 */
export const loginWithDevAccount = async (
  staffId: number,
): Promise<{ session: StaffSession } | { error: LoginError }> => {
  const { status, body } = await postJson<{ token: string }>(
    '/api/auth/dev-login',
    { staffId },
  );
  if (status !== 200 || body === null || typeof body.token !== 'string') {
    return {
      error: {
        kind: 'invalid',
        message: 'Development login failed. Seed the staff accounts first.',
      },
    };
  }
  return await startSession(body.token);
};

export const logout = (): void => {
  clearSession();
};
