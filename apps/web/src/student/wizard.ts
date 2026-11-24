// Onboarding wizard for the student portal.
//
// Four steps:
//   1. Choose university and enter university email (with privacy explanation).
//   2. Enter the 6-digit OTP code received by email.
//   3. Connect wallet (Lace via CIP-30, or a fake dev wallet).
//   4. Finish — enrolment is completed in later milestones.
//
// Non-sensitive progress (current step, university, email) is kept in memory
// and persisted to sessionStorage so the wizard resumes after a refresh.
// Sensitive values (OTP code, wallet signature, student secret) are never
// persisted here. Once the student secret is available (M051/M052), the
// persisted progress moves into SecureStore (encrypted with the secret).
//
// See docs/DECISIONS.md for the persistence choice.

import { button } from '../ui/button';
import { input } from '../ui/input';
import { select } from '../ui/select';
import { toast } from '../ui/toast';

export type Step = 1 | 2 | 3 | 4;

interface WizardState {
  step: Step;
  universityId: string;
  universityName: string;
  email: string;
  code: string;
  walletConnected: boolean;
}

const STORAGE_KEY = 'usafe-wizard-state';

const DEFAULT_STATE: WizardState = {
  step: 1,
  universityId: '',
  universityName: '',
  email: '',
  code: '',
  walletConnected: false,
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
    // sessionStorage may be unavailable (e.g. private mode); start fresh.
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
    // Fallback demo list so the wizard is usable without a running server.
    universitiesCache = [
      { value: 'demo-university-1', label: 'Demo University' },
      { value: 'demo-university-2', label: 'Hillside College' },
      { value: 'demo-university-3', label: 'Riverside Institute' },
    ];
    return universitiesCache;
  }
}

// ---------------------------------------------------------------------------
// Step renderers
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
  onChange: (next: Partial<WizardState>) => void,
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
      onChange({
        universityId: selected.value,
        universityName: selected.label,
      });
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
    onChange({ email: emailControl.value });
  });
  section.append(emailInput);

  const error = document.createElement('p');
  error.className = 'text-xs text-danger';
  error.hidden = true;
  error.textContent = 'Please select a university and enter a valid email address.';
  section.append(error);

  // Reveal the error only after the user has interacted with the fields.
  const validate = (): boolean => {
    const ok =
      state.universityId.length > 0 && isValidEmail(state.email);
    error.hidden = ok;
    return ok;
  };
  universityControl.addEventListener('blur', validate);
  emailControl.addEventListener('blur', validate);
  emailControl.addEventListener('input', validate);

  return section;
}

function renderStep2(
  state: WizardState,
  onChange: (next: Partial<WizardState>) => void,
): HTMLElement {
  const section = document.createElement('section');
  section.className = 'flex flex-col gap-4';

  const heading = document.createElement('h2');
  heading.className = 'text-lg font-semibold text-slate-900';
  heading.textContent = 'Step 2 of 4 — Verify your email';
  section.append(heading);

  const intro = document.createElement('p');
  intro.className = 'text-sm text-slate-600 leading-relaxed';
  intro.textContent =
    'Enter the 6-digit code sent to your email. The code expires after 10 minutes.';
  section.append(intro);

  const codeInput = input({
    id: 'wizard-code',
    label: '6-digit code',
    type: 'text',
    placeholder: '000000',
    value: state.code,
    disabled: state.step !== 2,
  });
  const codeControl = codeInput.querySelector('input')!;
  codeControl.inputMode = 'numeric';
  codeControl.addEventListener('input', () => {
    // Keep only digits, max 6.
    const value = codeControl.value.replace(/\D/g, '').slice(0, 6);
    codeControl.value = value;
    onChange({ code: value });
  });
  section.append(codeInput);

  const error = document.createElement('p');
  error.className = 'text-xs text-danger';
  error.hidden = true;
  error.textContent = 'Please enter a valid 6-digit code.';
  section.append(error);

  const validate = (): boolean => {
    const ok = isValidCode(state.code);
    error.hidden = ok;
    return ok;
  };
  codeControl.addEventListener('blur', validate);
  codeControl.addEventListener('input', validate);

  const resend = button({
    label: 'Resend code',
    variant: 'secondary',
    onClick: () => {
      toast('A new code has been sent to your email.', 'info');
    },
  });
  section.append(resend);

  return section;
}

function renderStep3(
  state: WizardState,
  onChange: (next: Partial<WizardState>) => void,
): HTMLElement {
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

  const connect = button({
    label: 'Connect wallet (Lace)',
    variant: 'primary',
    onClick: () => {
      onChange({ walletConnected: true });
      toast('Wallet connected.', 'success');
    },
  });
  section.append(connect);

  const fake = button({
    label: 'Use fake wallet (development only)',
    variant: 'secondary',
    onClick: () => {
      onChange({ walletConnected: true });
      toast('Fake wallet connected.', 'warning');
    },
  });
  fake.classList.add('mt-2');
  section.append(fake);

  const notice = document.createElement('p');
  notice.className = 'text-xs text-slate-500 mt-2';
  notice.textContent =
    'Real Lace integration is wired in the next milestone. The wizard advances once a wallet is connected.';
  section.append(notice);

  return section;
}

function renderStep4(): HTMLElement {
  const section = document.createElement('section');
  section.className = 'flex flex-col gap-4 items-center text-center';

  const heading = document.createElement('h2');
  heading.className = 'text-lg font-semibold text-slate-900';
  heading.textContent = 'Step 4 of 4 — Ready';
  section.append(heading);

  const text = document.createElement('p');
  text.className = 'text-sm text-slate-600 leading-relaxed max-w-xs';
  text.textContent =
    'Your enrolment will be completed in the next step. You will then be able to file and support complaints.';
  section.append(text);

  return section;
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
    4: () => renderStep4(),
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

  function onChange(next: Partial<WizardState>): void {
    Object.assign(state, next);
    persist(state);
    renderStep();
  }

  function renderStep(): void {
    stepOutlet.replaceChildren();
    const stepEl = stepRenderers[state.step](state);
    stepOutlet.append(stepEl);
    backBtn.disabled = state.step <= 1;
    nextBtn.disabled = !isValid(state);
    nextBtn.textContent = state.step === 4 ? 'Finish' : 'Next';
  }

  backBtn.addEventListener('click', () => {
    if (state.step > 1) {
      onChange({ step: (state.step - 1) as Step });
    }
  });

  nextBtn.addEventListener('click', () => {
    if (state.step === 4) {
      clearPersisted();
      toast('Onboarding complete.', 'success');
      return;
    }
    onChange({ step: (state.step + 1) as Step });
  });

  renderStep();
  return { element: root };
}
