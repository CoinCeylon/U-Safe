// University role key setup view (M064). Three states:
// 1. loaded      - private key is in memory for this tab
// 2. unlock      - a passphrase-protected backup exists (shown after every
//                  page refresh); asks for the passphrase, wrong ones fail
// 3. setup       - no key yet: import the demo `.dev-keys` backup file or
//                  generate a new pair, download the mandatory backup and
//                  register the public key with the server

import { badge } from '../ui/badge';
import { button } from '../ui/button';
import { card } from '../ui/card';
import { input } from '../ui/input';
import type { StaffSession } from './auth';
import {
  clearLoadedRoleKey,
  generateAndStoreRoleKey,
  getLoadedRoleKey,
  hasStoredBackup,
  publicKeyFingerprint,
  registerPublicKey,
  staffKeyStorage,
  unlockBackupBlob,
  unlockStoredBackup,
  type LoadedRoleKey,
} from './staffKeys';

export interface KeySetupOptions {
  session: StaffSession;
  /** Re-renders the current route (state changed). */
  onChanged: () => void;
}

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

export const renderKeySetup = async (
  section: HTMLElement,
  { session, onChanged }: KeySetupOptions,
): Promise<void> => {
  const storage = staffKeyStorage();
  const universityId = session.staff.universityId ?? '';

  const loaded = getLoadedRoleKey();
  if (loaded !== null && loaded.universityId === universityId) {
    renderLoadedState(section, session, onChanged, loaded);
    return;
  }

  const waiting = document.createElement('p');
  waiting.className = 'text-sm text-slate-600';
  waiting.textContent = 'Checking for a stored key…';
  section.replaceChildren(waiting);

  let stored = false;
  try {
    stored = await hasStoredBackup(storage, universityId);
  } catch {
    stored = false;
  }

  if (stored) {
    renderUnlockState(section, session, onChanged);
    return;
  }
  renderSetupState(section, session);
};

const renderLoadedState = (
  section: HTMLElement,
  session: StaffSession,
  onChanged: () => void,
  loaded: LoadedRoleKey,
): void => {
  const fingerprint = document.createElement('p');
  fingerprint.className = 'font-mono text-xs text-slate-500';
  void publicKeyFingerprint(loaded.publicKeyJwk).then((value) => {
    fingerprint.textContent = `public key fingerprint: ${value}`;
  });

  const note = document.createElement('p');
  note.className = 'text-sm text-slate-600';
  note.textContent =
    'The private key stays in this browser tab only. Refreshing the page asks for the passphrase again.';

  const error = errorParagraph();

  const lockButton = button({
    label: 'Lock (forget for this tab)',
    variant: 'secondary',
    onClick: () => {
      clearLoadedRoleKey();
      onChanged();
    },
  });

  const registerButton = button({
    label: 'Register public key with server',
    onClick: () => {
      registerButton.disabled = true;
      void registerPublicKey(
        session.token,
        loaded.universityId,
        JSON.stringify(loaded.publicKeyJwk),
      )
        .then(() => {
          error.classList.add('hidden');
          registerButton.replaceWith(
            successNote('Public key registered with the server.'),
          );
        })
        .catch((error_: unknown) => {
          showError(
            error,
            error_ instanceof Error ? error_.message : String(error_),
          );
        })
        .finally(() => {
          registerButton.disabled = false;
        });
    },
  });

  const status = card(
    'University private key',
    badge('Loaded', 'success'),
    fingerprint,
    note,
    registerButton,
    lockButton,
    error,
  );
  section.replaceChildren(status);
};

const successNote = (message: string): HTMLParagraphElement => {
  const element = document.createElement('p');
  element.className = 'text-sm text-success';
  element.textContent = message;
  return element;
};

const renderUnlockState = (
  section: HTMLElement,
  session: StaffSession,
  onChanged: () => void,
): void => {
  const heading = document.createElement('h2');
  heading.className = 'text-xl font-semibold text-slate-900';
  heading.textContent = 'Unlock the university key';

  const intro = document.createElement('p');
  intro.className = 'text-sm text-slate-600';
  intro.textContent =
    'A passphrase-protected key backup is stored in this browser. Enter the passphrase to load the private key.';

  const passphraseInput = input({
    id: 'key-passphrase',
    label: 'Passphrase',
    type: 'password',
    placeholder: 'key passphrase',
  });

  const error = errorParagraph();

  const unlockButton = button({
    label: 'Unlock key',
    onClick: () => {
      const value =
        passphraseInput.querySelector<HTMLInputElement>('#key-passphrase')
          ?.value ?? '';
      if (value === '') {
        showError(error, 'Enter the passphrase.');
        return;
      }
      unlockButton.disabled = true;
      void unlockStoredBackup(
        staffKeyStorage(),
        session.staff.universityId ?? '',
        value,
      )
        .then(() => {
          onChanged();
        })
        .catch((error_: unknown) => {
          showError(
            error,
            error_ instanceof Error ? error_.message : String(error_),
          );
        })
        .finally(() => {
          unlockButton.disabled = false;
        });
    },
  });

  const status = card('Unlock', passphraseInput, unlockButton, error);
  section.replaceChildren(heading, intro, status);
};

const renderSetupState = (
  section: HTMLElement,
  session: StaffSession,
): void => {
  const heading = document.createElement('h2');
  heading.className = 'text-xl font-semibold text-slate-900';
  heading.textContent = 'Set up the university key';

  const intro = document.createElement('p');
  intro.className = 'text-sm text-slate-600';
  intro.textContent =
    'The university key pair is an RSA-OAEP 2048 key used to seal and open complaint evidence. Choose one of the two options below.';

  const importError = errorParagraph();
  const fileLabel = document.createElement('label');
  fileLabel.className = 'text-sm font-medium text-slate-700';
  fileLabel.textContent = 'Backup file (.json)';
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'application/json,.json';
  fileInput.className =
    'w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 file:mr-3 file:rounded-md file:border-0 file:bg-primary-light file:px-3 file:py-1 file:text-sm file:text-primary-dark';

  const importPassphrase = input({
    id: 'import-passphrase',
    label: 'Backup passphrase',
    type: 'password',
    placeholder: 'passphrase of the backup file',
  });

  const importHint = document.createElement('p');
  importHint.className = 'text-xs text-slate-500';
  importHint.textContent =
    'For the demo: pick the file from the server\u2019s .dev-keys folder (university-<id>.json); its passphrase is \u201cdemo\u201d.';

  const importButton = button({
    label: 'Import backup',
    variant: 'secondary',
    onClick: () => {
      const file = fileInput.files?.[0];
      if (file === undefined) {
        showError(importError, 'Choose a backup file first.');
        return;
      }
      const passphrase =
        importPassphrase.querySelector<HTMLInputElement>('#import-passphrase')
          ?.value ?? '';
      if (passphrase === '') {
        showError(importError, 'Enter the backup passphrase.');
        return;
      }
      importButton.disabled = true;
      void file
        .text()
        .then((backupJson) =>
          unlockBackupBlob(
            staffKeyStorage(),
            session.staff.universityId ?? '',
            backupJson,
            passphrase,
          ).then((loaded) => ({ backupJson, loaded })),
        )
        .then(({ backupJson, loaded }) => {
          renderFinishState(section, session, {
            backupJson,
            loaded,
            generated: false,
          });
        })
        .catch((error_: unknown) => {
          showError(
            importError,
            error_ instanceof Error ? error_.message : String(error_),
          );
        })
        .finally(() => {
          importButton.disabled = false;
        });
    },
  });

  const importCard = card(
    'Option 1: Import an existing key backup',
    fileLabel,
    fileInput,
    importPassphrase,
    importHint,
    importButton,
    importError,
  );

  const generateError = errorParagraph();
  const passphraseInput = input({
    id: 'generate-passphrase',
    label: 'Choose a passphrase',
    type: 'password',
    placeholder: 'at least 8 characters',
  });
  const confirmInput = input({
    id: 'generate-confirm',
    label: 'Confirm passphrase',
    type: 'password',
    placeholder: 'repeat the passphrase',
  });

  const generateButton = button({
    label: 'Generate key pair',
    onClick: () => {
      const passphrase =
        passphraseInput.querySelector<HTMLInputElement>('#generate-passphrase')
          ?.value ?? '';
      const confirm =
        confirmInput.querySelector<HTMLInputElement>('#generate-confirm')
          ?.value ?? '';
      if (passphrase.length < 8) {
        showError(generateError, 'The passphrase needs at least 8 characters.');
        return;
      }
      if (passphrase !== confirm) {
        showError(generateError, 'The passphrases do not match.');
        return;
      }
      generateButton.disabled = true;
      void generateAndStoreRoleKey(
        staffKeyStorage(),
        session.staff.universityId ?? '',
        passphrase,
      )
        .then((result) => {
          const loaded = getLoadedRoleKey();
          if (loaded === null) {
            throw new Error('The generated key could not be loaded.');
          }
          renderFinishState(section, session, {
            backupJson: result.backupJson,
            loaded,
            generated: true,
          });
        })
        .catch((error_: unknown) => {
          showError(
            generateError,
            error_ instanceof Error ? error_.message : String(error_),
          );
        })
        .finally(() => {
          generateButton.disabled = false;
        });
    },
  });

  const generateCard = card(
    'Option 2: Generate a new key pair',
    passphraseInput,
    confirmInput,
    generateButton,
    generateError,
  );

  section.replaceChildren(heading, intro, importCard, generateCard);
};

interface FinishSetup {
  backupJson: string;
  loaded: LoadedRoleKey;
  generated: boolean;
}

const renderFinishState = (
  section: HTMLElement,
  session: StaffSession,
  { backupJson, loaded, generated }: FinishSetup,
): void => {
  const heading = document.createElement('h2');
  heading.className = 'text-xl font-semibold text-slate-900';
  heading.textContent = 'Key ready';

  const fingerprint = document.createElement('p');
  fingerprint.className = 'font-mono text-xs text-slate-500';
  void publicKeyFingerprint(loaded.publicKeyJwk).then((value) => {
    fingerprint.textContent = `public key fingerprint: ${value}`;
  });

  const backupNote = document.createElement('p');
  backupNote.className = 'text-sm text-slate-600';
  backupNote.textContent = generated
    ? 'Download the backup file now and keep it somewhere safe. Without it the key cannot be recovered, and complaints sealed with this key would become unreadable.'
    : 'The imported file is your backup. You can download another copy below.';

  let downloaded = !generated;
  const downloadButton = button({
    label: 'Download key backup',
    variant: 'secondary',
    onClick: () => {
      downloaded = true;
      const blobUrl = URL.createObjectURL(
        new Blob([backupJson], { type: 'application/json' }),
      );
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = `usafe-university-${loaded.universityId}-key.json`;
      link.click();
      URL.revokeObjectURL(blobUrl);
      continueButton.disabled = false;
      downloadNote.textContent = 'Backup downloaded.';
    },
  });

  const downloadNote = document.createElement('p');
  downloadNote.className = 'text-sm text-slate-600';
  downloadNote.textContent = generated
    ? 'The backup download is mandatory before continuing.'
    : '';

  const error = errorParagraph();
  const registered = document.createElement('p');

  const continueButton = button({
    label: 'Continue: register the public key',
    disabled: !downloaded,
    onClick: () => {
      continueButton.disabled = true;
      void registerPublicKey(
        session.token,
        loaded.universityId,
        JSON.stringify(loaded.publicKeyJwk),
      )
        .then(() => {
          error.classList.add('hidden');
          registered.textContent =
            'The public key is registered with the server. Complaint pages are now available.';
          registered.className = 'text-sm text-success';
        })
        .catch((error_: unknown) => {
          showError(
            error,
            error_ instanceof Error ? error_.message : String(error_),
          );
        })
        .finally(() => {
          continueButton.disabled = false;
        });
    },
  });

  const status = card(
    'University key',
    badge('Private key loaded', 'success'),
    fingerprint,
    backupNote,
    downloadButton,
    downloadNote,
    continueButton,
    registered,
    error,
  );
  section.replaceChildren(heading, status);
};
