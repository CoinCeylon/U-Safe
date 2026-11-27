// Community key admin screen (M065).
//
// Creating a key generates a random AES-256 community key in this browser,
// wraps it for the UGC public key, and posts both the wrapped copy and the key
// itself over TLS. The server stores the student-delivery copy wrapped under
// COMMUNITY_DELIVERY_SECRET. A passphrase-protected copy stays in this browser
// (IndexedDB) so the university can open complaint payloads later.
//
// The key is never persisted in plaintext and never written to the database
// unwrapped. Request bodies are not logged by the server.

import {
  IndexedDbStorage,
  SecureStore,
  generateCommunityKey,
  importPublicKeyJwk,
  wrapAesKeyBytes,
  type StorageBackend,
} from '@usafe/crypto';
import { badge } from '../ui/badge';
import { button } from '../ui/button';
import { card } from '../ui/card';
import { input } from '../ui/input';
import { toast } from '../ui/toast';
import type { StaffSession } from './auth';

interface CommunityKeyInfo {
  hasKey: boolean;
  createdAt: string | null;
  academicYear: string | null;
  /** String in the metadata route; object accepted defensively. */
  ugcPublicKeyJwk: string | JsonWebKey | null;
}

interface CreatedCommunityKey {
  createdAt: string;
  academicYear: string;
}

export interface CommunityKeyOptions {
  session: StaffSession;
  /** Re-renders the current route after the key changes. */
  onChanged: () => void;
}

export const communityKeyStorage = (): StorageBackend =>
  new IndexedDbStorage('usafe-university', 'community-keys');

const storageKey = (universityId: string): string =>
  `communityKeyBackup:${universityId}`;

const toBase64 = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes));

const errorParagraph = (): HTMLParagraphElement => {
  const element = document.createElement('p');
  element.className = 'hidden text-sm text-danger';
  element.setAttribute('role', 'alert');
  return element;
};

const showError = (element: HTMLParagraphElement, message: string): void => {
  element.textContent = message;
  element.classList.remove('hidden');
};

const readInfo = async (
  token: string,
  universityId: string,
): Promise<CommunityKeyInfo> => {
  const response = await fetch(
    `/api/university/${encodeURIComponent(universityId)}/community-key`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  if (response.status === 403) {
    throw new Error('Only an administrator can manage the community key.');
  }
  if (!response.ok) {
    throw new Error(`Could not load the community key (${response.status}).`);
  }
  return (await response.json()) as CommunityKeyInfo;
};

const createCommunityKey = async (
  session: StaffSession,
  universityId: string,
  ugcPublicKeyJwk: string | JsonWebKey,
  passphrase: string,
): Promise<CreatedCommunityKey> => {
  const communityKey = generateCommunityKey();
  try {
    const ugcJwk =
      typeof ugcPublicKeyJwk === 'string'
        ? (JSON.parse(ugcPublicKeyJwk) as JsonWebKey)
        : ugcPublicKeyJwk;
    const wrapped = await wrapAesKeyBytes(
      communityKey,
      await importPublicKeyJwk(ugcJwk),
    );

    const response = await fetch(
      `/api/university/${encodeURIComponent(universityId)}/community-key`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${session.token}`,
        },
        body: JSON.stringify({
          wrappedForUgc: toBase64(wrapped),
          communityKey: toBase64(communityKey),
        }),
      },
    );
    if (!response.ok) {
      throw new Error(
        `The server rejected the community key (status ${response.status}).`,
      );
    }
    const created = (await response.json()) as CreatedCommunityKey;

    const backup = await SecureStore.exportBackup(
      {
        role: 'community',
        universityId,
        communityKey: toBase64(communityKey),
        createdAt: created.createdAt,
        academicYear: created.academicYear,
      },
      passphrase,
    );
    await communityKeyStorage().setItem(storageKey(universityId), backup);
    return created;
  } finally {
    // The browser copy is now protected by the passphrase; do not keep the
    // raw key in a reachable variable longer than necessary.
    communityKey.fill(0);
  }
};

const downloadBackup = async (universityId: string): Promise<void> => {
  const backup = await communityKeyStorage().getItem(storageKey(universityId));
  if (backup === null) {
    throw new Error('No encrypted community key copy is stored in this browser.');
  }
  const url = URL.createObjectURL(
    new Blob([backup], { type: 'application/json' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = `usafe-community-key-${universityId}.json`;
  link.click();
  URL.revokeObjectURL(url);
};

const renderCurrentKey = (
  section: HTMLElement,
  info: CommunityKeyInfo,
  universityId: string,
): HTMLElement => {
  if (info.hasKey) {
    const created = document.createElement('p');
    created.className = 'text-sm text-slate-600';
    created.textContent =
      info.createdAt !== null
        ? `Created ${new Date(info.createdAt).toLocaleString()} (academic year ${info.academicYear ?? 'unknown'}).`
        : 'This key was seeded before creation metadata was stored; its creation date is unknown.';

    const download = button({
      label: 'Download encrypted backup',
      variant: 'secondary',
      onClick: () => {
        void downloadBackup(universityId).catch((error: unknown) => {
          toast(
            error instanceof Error ? error.message : String(error),
            'danger',
          );
        });
      },
    });

    return card(
      'Current community key',
      badge(
        info.academicYear !== null
          ? `Academic year ${info.academicYear}`
          : 'Academic year unknown',
        'success',
      ),
      created,
      download,
    );
  }

  const empty = document.createElement('p');
  empty.className = 'text-sm text-slate-600';
  empty.textContent =
    'No community key has been created for this university yet. Students cannot read complaint descriptions until one exists.';
  return card('Current community key', badge('Not created', 'warning'), empty);
};

export const renderCommunityKey = async (
  section: HTMLElement,
  { session, onChanged }: CommunityKeyOptions,
): Promise<void> => {
  const universityId = session.staff.universityId ?? '';
  if (universityId === '') {
    const message = document.createElement('p');
    message.className = 'text-sm text-danger';
    message.textContent = 'This staff account is not attached to a university.';
    section.replaceChildren(message);
    return;
  }

  const heading = document.createElement('h2');
  heading.className = 'text-xl font-semibold text-slate-900';
  heading.textContent = 'Community key';

  const intro = document.createElement('p');
  intro.className = 'text-sm text-slate-600';
  intro.textContent =
    'The community key lets students of this university read complaint descriptions. Every enrolled student receives it.';

  const warning = document.createElement('div');
  warning.className =
    'rounded-md border border-warning bg-warning-light p-3 text-sm text-warning';
  warning.setAttribute('role', 'note');
  warning.textContent =
    'Anyone who holds this key can read students\u2019 complaint descriptions. That includes the server operator, because the server delivers the key to newly enrolled students. Evidence files and staff-involved complaints stay protected by separate keys.';

  const loading = document.createElement('p');
  loading.className = 'text-sm text-slate-600';
  loading.textContent = 'Loading the current community key…';
  section.replaceChildren(heading, intro, warning, loading);

  let info: CommunityKeyInfo;
  try {
    info = await readInfo(session.token, universityId);
  } catch (error) {
    const message = document.createElement('p');
    message.className = 'text-sm text-danger';
    message.textContent = error instanceof Error ? error.message : String(error);
    section.replaceChildren(heading, intro, warning, message);
    return;
  }

  const current = renderCurrentKey(section, info, universityId);

  const passphraseInput = input({
    id: 'community-key-passphrase',
    label: 'Staff passphrase for the local key copy',
    type: 'password',
    placeholder: 'at least 8 characters',
  });
  const confirmInput = input({
    id: 'community-key-confirm',
    label: 'Confirm passphrase',
    type: 'password',
    placeholder: 'repeat the passphrase',
  });

  const error = errorParagraph();
  const createButton = button({
    label: 'Create new community key',
    onClick: () => {
      const passphrase =
        passphraseInput.querySelector<HTMLInputElement>(
          '#community-key-passphrase',
        )?.value ?? '';
      const confirm =
        confirmInput.querySelector<HTMLInputElement>('#community-key-confirm')
          ?.value ?? '';
      if (passphrase.length < 8) {
        showError(error, 'The passphrase needs at least 8 characters.');
        return;
      }
      if (passphrase !== confirm) {
        showError(error, 'The passphrases do not match.');
        return;
      }
      if (info.ugcPublicKeyJwk === null) {
        showError(
          error,
          'The UGC public key is not available yet. Run the demo key seed first.',
        );
        return;
      }

      createButton.disabled = true;
      void createCommunityKey(
        session,
        universityId,
        info.ugcPublicKeyJwk,
        passphrase,
      )
        .then(() => {
          toast('Community key created.', 'success');
          onChanged();
        })
        .catch((error_: unknown) => {
          showError(
            error,
            error_ instanceof Error ? error_.message : String(error_),
          );
        })
        .finally(() => {
          createButton.disabled = false;
        });
    },
  });

  const createCard = card(
    info.hasKey ? 'Replace the community key' : 'Create a community key',
    (() => {
      const note = document.createElement('p');
      note.className = 'text-sm text-slate-600';
      note.textContent = info.hasKey
        ? 'Replacing the key means newly enrolled students receive the new key. Keep the encrypted backup of the previous key if older complaints must stay readable.'
        : 'The key is generated in this browser. The server stores only wrapped copies.';
      return note;
    })(),
    passphraseInput,
    confirmInput,
    createButton,
    error,
  );

  section.replaceChildren(heading, intro, warning, current, createCard);
};
