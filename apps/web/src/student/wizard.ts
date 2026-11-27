// Onboarding wizard for the student portal (M049, M050, M051, M052).
//
// Four steps:
//   1. Choose university and enter university email (with privacy explanation).
//   2. Request and verify a 6-digit OTP code -> enrolment ticket.
//   3. Connect wallet (Lace via CIP-30, or a fake dev wallet).
//   4. Unlock the student secret, compute the commitment, call
//      POST /api/enroll and persist the result in SecureStore.
//
// Non-sensitive progress (step, university, email) is persisted to
// sessionStorage so the wizard resumes after a refresh. Sensitive values
// (OTP code, ticket, wallet signature, student secret) are memory-only.
//
// See docs/DECISIONS.md for the persistence choice.

import { button } from '../ui/button';
import { navigate } from '../lib/router';
import { friendlyError, isOfflineError } from '../lib/offline';
import { input } from '../ui/input';
import { select } from '../ui/select';
import { toast } from '../ui/toast';
import {
  connectWallet,
  clearFakeWalletSession,
  isConnected,
  getAddress,
  isFakeWalletMode,
} from './wallet';
import {
  unlockStudent,
  getCommitment,
  clearStudentSecret,
} from './unlock';
import {
  requestOtp,
  verifyOtp,
  enroll,
  saveEnrollment,
  type OtpTicket,
} from './enroll';

export type Step = 1 | 2 | 3 | 4;

interface WizardState {
  step: Step;
  universityId: string;
  universityName: string;
  email: string;
  code: string;
  ticket: string | null;
  walletConnected: boolean;
  otpRequested: boolean;
  otpError: string | null;
  enrollStatus: 'idle' | 'deriving' | 'committing' | 'enrolling' | 'saving' | 'done' | 'error';
  enrollError: string | null;
}

// `rerender` is false for keystrokes. Rebuilding the step on every character
// replaces the focused input and makes the student type one character at a time.
type WizardChange = (next: Partial<WizardState>, rerender?: boolean) => void;

const STORAGE_KEY = 'usafe-wizard-state';

const DEFAULT_STATE: WizardState = {
  step: 1,
  universityId: '',
  universityName: '',
  email: '',
  code: '',
  ticket: null,
  walletConnected: false,
  otpRequested: false,
  otpError: null,
  enrollStatus: 'idle',
  enrollError: null,
};

function loadState(): WizardState {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { ...DEFAULT_STATE };
    }
    const parsed = JSON.parse(raw) as Partial<WizardState>;
    return {
      ...DEFAULT_STATE,
      step: parsed.step ?? 1,
      universityId: parsed.universityId ?? '',
      universityName: parsed.universityName ?? '',
      email: parsed.email ?? '',
    };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

function persist(state: WizardState): void {
  try {
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        step: state.step,
        universityId: state.universityId,
        universityName: state.universityName,
        email: state.email,
      }),
    );
  } catch {
    // sessionStorage unavailable; progress lives in memory only this session.
  }
}

function clearPersisted(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidEmail(value: string): boolean {
  return EMAIL_REGEX.test(value.trim());
}

function isValidCode(value: string): boolean {
  return /^\d{6}$/.test(value);
}

// ---------------------------------------------------------------------------
// Universities
// ---------------------------------------------------------------------------

interface UniversityOption {
  value: string;
  label: string;
}

let universitiesCache: UniversityOption[] | null = null;

export async function fetchUniversities(): Promise<UniversityOption[]> {
  if (universitiesCache !== null) {
    return universitiesCache;
  }
  try {
    const response = await fetch('/api/universities');
    if (!response.ok) {
      throw new Error(`universities ${response.status}`);
    }
    const data = (await response.json()) as Array<{
      id: string;
      name: string;
      status: string;
    }>;
    universitiesCache = data
      .filter((u) => u.status === 'active')
      .map((u) => ({ value: u.id, label: u.name }));
    if (universitiesCache.length === 0) {
      throw new Error('no active universities');
    }
    return universitiesCache;
  } catch {
    universitiesCache = [
      { value: 'demo-university-1', label: 'Demo University' },
      { value: 'demo-university-2', label: 'Hillside College' },
      { value: 'demo-university-3', label: 'Riverside Institute' },
    ];
    return universitiesCache;
  }
}

// ---------------------------------------------------------------------------
// Step 1: university + email + privacy explanation
// ---------------------------------------------------------------------------

function privacyNotice(): HTMLDivElement {
  const box = document.createElement('div');
  box.className =
    'rounded-lg border border-primary-light bg-primary-light p-4 text-sm text-primary-dark';

  const heading = document.createElement('p');
  heading.className = 'font-semibold mb-1';
  heading.textContent = 'What the university can and cannot see';

  const lines = [
    'The university can see that you enrolled and the number of complaints filed.',
    'The university cannot see your complaint text, your evidence, or your identity.',
    'Your email is used only to send the enrolment code and is stored as a hash.',
  ];

  const list = document.createElement('ul');
  list.className = 'list-disc list-inside mt-1 space-y-1 text-sm';
  for (const text of lines) {
    const item = document.createElement('li');
    item.textContent = text;
    list.append(item);
  }

  box.append(heading, list);
  return box;
}

function renderStep1(
  state: WizardState,
  universities: UniversityOption[],
  onChange: WizardChange,
): HTMLElement {
  const section = document.createElement('section');
  section.className = 'flex flex-col gap-4';

  const heading = document.createElement('h2');
  heading.className = 'text-lg font-semibold text-slate-900';
  heading.textContent = 'Step 1 of 4 — Choose your university';
  section.append(heading);

  const intro = document.createElement('p');
  intro.className = 'text-sm text-slate-600 leading-relaxed';
  intro.textContent =
    'Select your university and enter your university email address. We will send a 6-digit code to that address.';
  section.append(intro);

  section.append(privacyNotice());

  const universitySelect = select({
    id: 'wizard-university',
    label: 'University',
    options: universities,
    value: state.universityId,
  });
  const universityControl = universitySelect.querySelector('select')!;
  universityControl.addEventListener('change', () => {
    const selected = universities.find((u) => u.value === universityControl.value);
    if (selected) {
      onChange(
        {
          universityId: selected.value,
          universityName: selected.label,
        },
        false,
      );
      validate();
    }
  });
  section.append(universitySelect);

  const emailInput = input({
    id: 'wizard-email',
    label: 'University email',
    type: 'email',
    placeholder: 'name@university.edu',
    value: state.email,
  });
  const emailControl = emailInput.querySelector('input')!;
  emailControl.addEventListener('input', () => {
    // Update state without replacing this input so focus and caret survive.
    onChange({ email: emailControl.value }, false);
  });
  section.append(emailInput);

  const error = document.createElement('p');
  error.className = 'text-xs text-danger';
  error.hidden = true;
  error.textContent = 'Please select a university and enter a valid email address.';
  section.append(error);

  const validate = (): boolean => {
    const ok = state.universityId.length > 0 && isValidEmail(state.email);
    error.hidden = ok;
    return ok;
  };
  universityControl.addEventListener('blur', validate);
  emailControl.addEventListener('blur', validate);
  emailControl.addEventListener('input', validate);

  return section;
}

// ---------------------------------------------------------------------------
// Step 2: OTP request + verify -> ticket
// ---------------------------------------------------------------------------

function renderStep2(state: WizardState, onChange: WizardChange): HTMLElement {
  const section = document.createElement('section');
  section.className = 'flex flex-col gap-4';

  const heading = document.createElement('h2');
  heading.className = 'text-lg font-semibold text-slate-900';
  heading.textContent = 'Step 2 of 4 — Verify your email';
  section.append(heading);

  const intro = document.createElement('p');
  intro.className = 'text-sm text-slate-600 leading-relaxed';
  intro.textContent =
    'A 6-digit code has been sent to your email. Enter it to receive your enrolment ticket. The code expires after 10 minutes.';
  section.append(intro);

  const otpError = document.createElement('p');
  otpError.id = 'wizard-otp-error';
  otpError.className = 'text-xs text-danger';
  otpError.textContent = state.otpError ?? '';
  otpError.hidden = state.otpError === null;
  section.append(otpError);

  const codeInput = input({
    id: 'wizard-code',
    label: '6-digit code',
    type: 'text',
    placeholder: '000000',
    value: state.code,
  });
  const codeControl = codeInput.querySelector('input')!;
  codeControl.inputMode = 'numeric';
  section.append(codeInput);

  const buttonRow = document.createElement('div');
  buttonRow.className = 'flex flex-col sm:flex-row gap-3';

  const handleVerify = async (): Promise<void> => {
    onChange({ otpError: null, enrollStatus: 'idle' }, false);
    otpError.hidden = true;
    otpError.textContent = '';
    try {
      const ticket: OtpTicket = await verifyOtp(state.email, state.code);
      onChange({ ticket: ticket.ticket });
      toast('Enrolment ticket received.', 'success');
    } catch (error) {
      const message = friendlyError(error, 'Verification failed.');
      onChange({ otpError: message }, false);
      otpError.textContent = message;
      otpError.hidden = false;
    }
  };
  const verify = button({
    label: 'Verify code',
    variant: 'primary',
    disabled: !isValidCode(state.code) || state.ticket !== null,
    onClick: () => {
      void handleVerify();
    },
  });
  buttonRow.append(verify);

  // Keep the code input mounted while updating the dependent button.
  codeControl.addEventListener('input', () => {
    const value = codeControl.value.replace(/\D/g, '').slice(0, 6);
    codeControl.value = value;
    onChange({ code: value }, false);
    verify.disabled = !isValidCode(value) || state.ticket !== null;
  });

  const handleResend = async (): Promise<void> => {
    onChange({ otpError: null, ticket: null, otpRequested: false }, false);
    otpError.hidden = true;
    otpError.textContent = '';
    try {
      await requestOtp(state.email);
      onChange({ otpRequested: true }, false);
      toast('A new code has been sent.', 'info');
      verify.disabled = !isValidCode(state.code) || state.ticket !== null;
    } catch (error) {
      const message =
        friendlyError(error, 'Could not resend code.');
      onChange({ otpError: message }, false);
      otpError.textContent = message;
      otpError.hidden = false;
    }
  };
  const resend = button({
    label: 'Resend code',
    variant: 'secondary',
    onClick: () => {
      void handleResend();
    },
  });
  buttonRow.append(resend);

  section.append(buttonRow);
  return section;
}

// ---------------------------------------------------------------------------
// Step 3: connect wallet
// ---------------------------------------------------------------------------

function renderStep3(state: WizardState, onChange: WizardChange): HTMLElement {
  const section = document.createElement('section');
  section.className = 'flex flex-col gap-4';

  const heading = document.createElement('h2');
  heading.className = 'text-lg font-semibold text-slate-900';
  heading.textContent = 'Step 3 of 4 — Connect your wallet';
  section.append(heading);

  const intro = document.createElement('p');
  intro.className = 'text-sm text-slate-600 leading-relaxed';
  intro.textContent =
    'Connect your Lace wallet to sign the enrolment message. Your wallet address is never stored with your complaint.';
  section.append(intro);

  // The fake wallet derives a deterministic signature from this passphrase.
  // It is never persisted; the real Lace wallet ignores it.
  let fakePassphrase = '';

  if (isFakeWalletMode()) {
    const warn = document.createElement('div');
    warn.className =
      'rounded-md border border-danger bg-danger-light text-danger p-3 text-xs font-medium';
    warn.textContent =
      'DEVELOPMENT ONLY: fake wallet active. Do not use for real enrolments.';
    section.append(warn);

    const passphraseLabel = document.createElement('label');
    passphraseLabel.htmlFor = 'fake-wallet-passphrase';
    passphraseLabel.className = 'text-sm font-medium text-slate-700';
    passphraseLabel.textContent = 'Fake wallet passphrase (development only)';
    const passphraseInput = document.createElement('input');
    passphraseInput.type = 'password';
    passphraseInput.id = 'fake-wallet-passphrase';
    passphraseInput.autocomplete = 'off';
    passphraseInput.className =
      'w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary-light';
    passphraseInput.placeholder = 'Type the same passphrase to get the same wallet';
    passphraseInput.addEventListener('input', () => {
      fakePassphrase = passphraseInput.value;
    });
    const hint = document.createElement('p');
    hint.className = 'text-xs text-slate-500';
    hint.textContent =
      'The same passphrase always produces the same fake address and signature. It is kept in memory only.';
    section.append(passphraseLabel, passphraseInput, hint);
  }

  const connected = state.walletConnected;
  const address = getAddress();

  const handleConnect = async (): Promise<void> => {
    try {
      if (isFakeWalletMode() && fakePassphrase.trim() === '') {
        toast('Type a fake wallet passphrase first.', 'danger');
        return;
      }
      await connectWallet(
        isFakeWalletMode() ? { passphrase: fakePassphrase } : undefined,
      );
      onChange({
        walletConnected: isConnected(),
      });
      if (isConnected()) {
        toast('Wallet connected.', 'success');
      }
    } catch (error) {
      onChange({ walletConnected: false });
      toast(
        error instanceof Error ? error.message : 'Could not connect wallet.',
        'danger',
      );
    }
  };
  const connect = button({
    label: connected ? 'Wallet connected' : 'Connect wallet (Lace)',
    variant: connected ? 'primary' : 'primary',
    disabled: connected,
    onClick: () => {
      void handleConnect();
    },
  });
  section.append(connect);

  if (connected && address !== null) {
    const addr = document.createElement('p');
    addr.className = 'text-xs text-slate-500 break-all';
    addr.textContent = 'Address: ' + address;
    section.append(addr);
  }

  const notice = document.createElement('p');
  notice.className = 'text-xs text-slate-500 mt-2';
  notice.textContent =
    'Real Lace integration triggers a wallet signature popup. The wizard advances once a wallet is connected.';
  section.append(notice);

  return section;
}

// ---------------------------------------------------------------------------
// Step 4: unlock secret, compute commitment, enrol, persist
// ---------------------------------------------------------------------------

const STATUS_LABELS: Record<WizardState['enrollStatus'], string> = {
  deriving: 'Deriving your student secret…',
  committing: 'Computing your commitment…',
  enrolling: 'Sending enrolment to the server…',
  saving: 'Saving your enrolment receipt…',
  done: 'Enrolment complete.',
  error: 'Enrolment failed.',
  idle: 'Ready to enrol.',
};

function renderStep4(state: WizardState, onChange: WizardChange): HTMLElement {
  const section = document.createElement('section');
  section.className = 'flex flex-col gap-4';

  const heading = document.createElement('h2');
  heading.className = 'text-lg font-semibold text-slate-900';
  heading.textContent = 'Step 4 of 4 — Complete enrolment';
  section.append(heading);

  const intro = document.createElement('p');
  intro.className = 'text-sm text-slate-600 leading-relaxed';
  intro.textContent =
    'Unlock your student secret and finalise enrolment. Your commitment (a public hash) is sent to the server; your secret stays in memory only.';
  section.append(intro);

  if (state.enrollError !== null) {
    const err = document.createElement('p');
    err.className = 'text-xs text-danger';
    err.textContent = state.enrollError;
    section.append(err);
  }

  const status = document.createElement('p');
  status.className = 'text-sm text-slate-600';
  status.textContent = STATUS_LABELS[state.enrollStatus];
  section.append(status);

  const buttonRow = document.createElement('div');
  buttonRow.className = 'flex flex-col sm:flex-row gap-3';

  const canEnroll =
    state.ticket !== null &&
    state.walletConnected &&
    state.enrollStatus === 'idle';

  const finish = button({
    label: 'Finish enrolment',
    variant: 'primary',
    disabled: !canEnroll,
    onClick: () => {
      onChange({ enrollError: null });
      void runEnrollment(state, onChange);
    },
  });
  buttonRow.append(finish);

  const logout = button({
    label: 'Start over',
    variant: 'secondary',
    onClick: () => {
      clearStudentSecret();
      clearFakeWalletSession();
      clearPersisted();
      onChange({
        step: 1,
        code: '',
        ticket: null,
        walletConnected: false,
        otpRequested: false,
        otpError: null,
        enrollStatus: 'idle',
        enrollError: null,
      });
    },
  });
  buttonRow.append(logout);

  section.append(buttonRow);

  if (state.enrollStatus === 'done') {
    const success = document.createElement('div');
    success.className =
      'rounded-lg border border-success bg-success-light p-4 text-success';
    const ok = document.createElement('p');
    ok.className = 'font-semibold';
    ok.textContent = 'Enrolment complete.';
    const next = document.createElement('p');
    next.className = 'text-sm';
    next.textContent =
      'Your enrolment receipt is saved. You can now open the feed and file or support complaints.';
    const openFeed = button({
      label: 'Open community feed',
      variant: 'primary',
      onClick: () => {
        navigate('/feed');
      },
    });
    success.append(ok, next, openFeed);
    section.append(success);
  }

  return section;
}

async function runEnrollment(
  state: WizardState,
  onChange: (next: Partial<WizardState>) => void,
): Promise<void> {
  try {
    // 1. Derive the student secret from the wallet signature.
    onChange({ enrollStatus: 'deriving' });
    await unlockStudent(state.universityId);

    // 2. Compute the public commitment (Merkle leaf value).
    onChange({ enrollStatus: 'committing' });
    const commitment = await getCommitment();
    if (commitment === null) {
      throw new Error('Could not compute commitment');
    }
    const commitmentHex = Array.from(commitment, (b) =>
      b.toString(16).padStart(2, '0'),
    ).join('');

    // 3. Enrol with the server.
    onChange({ enrollStatus: 'enrolling' });
    const result = await enroll(state.ticket!, commitmentHex);

    // 4. Persist the enrolment receipt (encrypted with the student secret).
    onChange({ enrollStatus: 'saving' });
    await saveEnrollment(
      state.universityId,
      result.leafIndex,
      result.communityKey,
    );

    onChange({ enrollStatus: 'done' });
    toast('Enrolment complete.', 'success');
  } catch (error) {
    let friendly = friendlyError(error, 'Enrolment failed.');
    if (!isOfflineError(error)) {
      if (friendly === 'ceiling reached') {
        friendly =
          'This university has reached its enrolment ceiling. Please contact the registrar.';
      } else if (friendly === 'invalid ticket') {
        friendly =
          'Your enrolment ticket is invalid or has expired. Request a new code.';
      } else if (friendly.startsWith('HTTP 400')) {
        friendly = 'Enrolment was rejected by the server. Please try again.';
      }
    }
    onChange({ enrollStatus: 'error', enrollError: friendly });
    toast(friendly, 'danger');
  }
}

// ---------------------------------------------------------------------------
// Wizard
// ---------------------------------------------------------------------------

interface RenderedWizard {
  element: HTMLElement;
}

export function renderWizard(
  outlet: HTMLElement,
  universities: UniversityOption[],
): RenderedWizard {
  const state = loadState();

  const root = document.createElement('div');
  root.className = 'flex flex-col gap-5 max-w-md mx-auto';

  const stepOutlet = document.createElement('div');
  stepOutlet.className = 'flex flex-col gap-4';

  const nav = document.createElement('div');
  nav.className =
    'flex items-center justify-between gap-3 pt-4 border-t border-slate-200';

  const backBtn = button({
    label: 'Back',
    variant: 'secondary',
    disabled: true,
  });
  const nextBtn = button({
    label: 'Next',
    variant: 'primary',
    disabled: true,
  });
  nav.append(backBtn, nextBtn);

  root.append(stepOutlet, nav);
  outlet.append(root);

  const stepRenderers: Record<Step, (s: WizardState) => HTMLElement> = {
    1: (s) => renderStep1(s, universities, onChange),
    2: (s) => renderStep2(s, onChange),
    3: (s) => renderStep3(s, onChange),
    4: (s) => renderStep4(s, onChange),
  };

  function isValid(s: WizardState): boolean {
    switch (s.step) {
      case 1:
        return s.universityId.length > 0 && isValidEmail(s.email);
      case 2:
        return isValidCode(s.code);
      case 3:
        return s.walletConnected;
      case 4:
        return false;
    }
  }

  function updateNav(): void {
    backBtn.disabled = state.step <= 1;
    nextBtn.disabled = !isValid(state);
    nextBtn.textContent = state.step === 4 ? 'Finish' : 'Next';
  }

  function onChange(next: Partial<WizardState>, rerender = true): void {
    Object.assign(state, next);
    persist(state);
    // Navigation validity must follow keystrokes even when the step DOM stays
    // mounted. Only step/status changes need a full rebuild.
    updateNav();
    if (rerender) {
      renderStep();
    }
  }

  function renderStep(): void {
    stepOutlet.replaceChildren();
    const stepEl = stepRenderers[state.step](state);
    stepOutlet.append(stepEl);
    updateNav();

    // Kick off the OTP request when step 2 first becomes visible. Its result
    // updates state in place so the code field is never rebuilt mid-typing.
    if (state.step === 2 && state.email && !state.otpRequested) {
      void requestOtp(state.email).then(
        () => onChange({ otpRequested: true }, false),
        (error) => {
          const message =
            friendlyError(error, 'Could not send code.');
          onChange({ otpError: message }, false);
          const errorEl = stepOutlet.querySelector<HTMLElement>('#wizard-otp-error');
          if (errorEl) {
            errorEl.textContent = message;
            errorEl.hidden = false;
          }
        },
      );
    }
  }

  backBtn.addEventListener('click', () => {
    if (state.step > 1) {
      onChange({ step: (state.step - 1) as Step });
    }
  });

  nextBtn.addEventListener('click', () => {
    if (state.step === 4) {
      // Handled by the Finish button in step 4.
      return;
    }
    onChange({ step: (state.step + 1) as Step });
  });

  renderStep();
  return { element: root };
}
