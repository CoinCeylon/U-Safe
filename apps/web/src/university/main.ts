import '../styles/app.css';
import { createFrame } from '../ui/frame';
import { createRouter } from '../lib/router';
import { button } from '../ui/button';
import { card } from '../ui/card';
import {
  clearSession,
  fetchHealth,
  loadSession,
  saveSession,
  type StaffSession,
} from './auth';
import { createLoginView } from './login';
import { canAccess, ruleForPath, rulesForRole } from './roles';
import { renderKeySetup } from './keySetup';
import { renderCommunityKey } from './communityKey';
import { getLoadedRoleKey } from './staffKeys';

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) {
  throw new Error('Missing #app root');
}

const portalFrame = createFrame({ portalName: 'University Portal' });
root.append(portalFrame.element);

const router = createRouter(portalFrame.content);

// The staff session lives in sessionStorage only (M063): closing the tab
// signs the staff member out.
let session: StaffSession | null = loadSession();
let logoutButton: HTMLButtonElement | null = null;

const buildNav = (): void => {
  if (session === null) {
    portalFrame.setNav([]);
    return;
  }
  portalFrame.setNav(
    rulesForRole(session.staff.role).map((rule) => ({
      label: rule.label,
      path: rule.path,
    })),
  );
};

const buildHeaderControls = (): void => {
  if (logoutButton !== null) {
    logoutButton.remove();
    logoutButton = null;
  }
  if (session === null) {
    portalFrame.setRoleBadge(null);
    return;
  }
  portalFrame.setRoleBadge(session.staff.role);
  logoutButton = button({
    label: 'Log out',
    variant: 'secondary',
    onClick: () => {
      clearSession();
      session = null;
      buildHeaderControls();
      buildNav();
      router.navigate('/');
    },
  });
  portalFrame.header.append(logoutButton);
};

const loginView = (): HTMLElement =>
  createLoginView({
    onLoggedIn: (active) => {
      session = active;
      saveSession(active);
      buildHeaderControls();
      buildNav();
      router.navigate('/');
    },
  });

const accessDeniedView = (path: string): HTMLElement => {
  const section = document.createElement('section');
  section.className = 'mx-auto flex w-full max-w-md flex-col gap-3';
  const heading = document.createElement('h2');
  heading.className = 'text-xl font-semibold text-slate-900';
  heading.textContent = 'Access denied';
  const text = document.createElement('p');
  text.className = 'text-sm text-slate-600';
  text.textContent = `Your role (${session?.staff.role ?? 'unknown'}) cannot open ${path}. Ask an administrator if you need access.`;
  section.append(heading, text);
  return section;
};

/**
 * Wraps a route handler with the M063 role guard: no session shows the
 * login view, a role outside the route rule shows the denied view.
 */
const guarded = (
  path: string,
  render: () => HTMLElement,
): (() => HTMLElement) => {
  return () => {
    if (session === null) {
      return loginView();
    }
    const rule = ruleForPath(path);
    if (rule === null || !canAccess(session.staff.role, rule.roles)) {
      return accessDeniedView(path);
    }
    return render();
  };
};

const placeholder = (title: string, note: string): HTMLElement => {
  const section = document.createElement('section');
  section.className = 'flex flex-col gap-2';
  const heading = document.createElement('h2');
  heading.className = 'text-xl font-semibold text-slate-900';
  heading.textContent = title;
  const text = document.createElement('p');
  text.className = 'text-sm text-slate-600';
  text.textContent = note;
  section.append(heading, text);
  return section;
};

const homeView = (): HTMLElement => {
  if (session === null) {
    return loginView();
  }
  const section = document.createElement('section');
  const intro = card(
    'Signed in',
    (() => {
      const text = document.createElement('p');
      text.className = 'text-sm text-slate-600';
      text.textContent = `Role: ${session.staff.role}. University: ${session.staff.universityId ?? 'not assigned'}. Use the navigation on the left.`;
      const keyStatus = document.createElement('p');
      keyStatus.className = 'text-sm text-slate-600';
      keyStatus.textContent =
        getLoadedRoleKey() !== null
          ? 'University key: loaded in this tab.'
          : 'University key: not loaded yet. Open Keys to load it.';
      text.append(document.createElement('br'), keyStatus);
      return text;
    })(),
  );
  section.append(intro);
  return section;
};

const keySetupView = (): HTMLElement => {
  const section = document.createElement('section');
  if (session === null) {
    return loginView();
  }
  const active = session;
  const rerender = (): void => {
    router.navigate(router.currentPath());
  };
  void renderKeySetup(section, { session: active, onChanged: rerender });
  return section;
};

const communityKeyView = (): HTMLElement => {
  const section = document.createElement('section');
  if (session === null) {
    return loginView();
  }
  const active = session;
  const rerender = (): void => {
    router.navigate(router.currentPath());
  };
  void renderCommunityKey(section, { session: active, onChanged: rerender });
  return section;
};

const keyLockedView = (): HTMLElement => {
  const section = document.createElement('section');
  section.className = 'mx-auto flex w-full max-w-md flex-col gap-3';
  const heading = document.createElement('h2');
  heading.className = 'text-xl font-semibold text-slate-900';
  heading.textContent = 'University key required';
  const text = document.createElement('p');
  text.className = 'text-sm text-slate-600';
  text.textContent =
    'Complaint pages stay locked until the university private key is loaded in this tab, because complaint payloads are sealed with it.';
  const toKeys = button({
    label: 'Open key setup',
    onClick: () => {
      router.navigate('/keys');
    },
  });
  section.append(heading, text, toKeys);
  return section;
};

router.register('/', guarded('/', homeView));
router.register(
  '/complaints',
  guarded('/complaints', () => {
    // M064: complaint pages are blocked until a private key is loaded.
    if (getLoadedRoleKey() === null) {
      return keyLockedView();
    }
    return placeholder(
      'Complaints',
      'Complaints dashboard arrives in a later milestone.',
    );
  }),
);
router.register(
  '/roster',
  guarded('/roster', () =>
    placeholder('Roster', 'Roster tools arrive in a later milestone.'),
  ),
);
router.register('/keys', guarded('/keys', keySetupView));
router.register(
  '/community-key',
  guarded('/community-key', communityKeyView),
);

buildHeaderControls();
buildNav();
router.start();

// Visible mock-mode banner (required whenever CHAIN_MODE=mock).
void fetchHealth().then((health) => {
  if (health === null || health.mode !== 'mock') {
    return;
  }
  const banner = document.createElement('p');
  banner.className =
    'bg-warning-light px-4 py-2 text-center text-sm font-medium text-warning';
  banner.textContent = 'MOCK MODE: anonymity is simulated';
  portalFrame.element.prepend(banner);
});
