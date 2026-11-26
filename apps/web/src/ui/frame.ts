import { badge } from './badge';

export interface FrameNavItem {
  label: string;
  path: string;
  onClick?: () => void;
}

export interface FrameOptions {
  portalName: string;
  roleBadge?: string | null;
  navItems?: FrameNavItem[];
  onNavigate?: (path: string) => void;
  contentClassName?: string;
}

export interface PortalFrame {
  element: HTMLElement;
  header: HTMLElement;
  nav: HTMLElement;
  content: HTMLElement;
  toastHost: HTMLElement;
  setRoleBadge: (label: string | null) => void;
  setNav: (items: FrameNavItem[]) => void;
}

type FrameInput = string | FrameOptions;

/**
 * AGENT.md section 6: every portal shows the mock-mode warning only when
 * `/api/health` reports `mock`. Kept as a pure predicate so it can be tested.
 */
export function shouldShowMockBanner(mode: string | undefined): boolean {
  return mode === 'mock';
}

// Creates the hidden banner and reveals it after `/api/health` resolves. The
// same element instance stays mounted, so a late health response still makes
// it visible (unlike the old landing-page clone that was never updated).
function buildMockBanner(): HTMLElement {
  const banner = document.createElement('div');
  banner.className =
    'border-b border-warning bg-warning-light px-4 py-2 text-sm font-medium text-warning';
  banner.textContent = 'MOCK MODE: anonymity is simulated';
  banner.setAttribute('role', 'status');
  banner.hidden = true;
  return banner;
}

function normalizeOptions(input: FrameInput): FrameOptions {
  if (typeof input === 'string') {
    return { portalName: input };
  }
  const source = input as unknown as Record<string, unknown>;
  const portalName =
    typeof source.portalName === 'string'
      ? source.portalName
      : typeof source.title === 'string'
        ? source.title
        : typeof source.name === 'string'
          ? source.name
          : 'Portal';

  const navSource =
    source.navItems ?? source.nav ?? source.navigation ?? source.links ?? source.menu;
  const navItems = Array.isArray(navSource)
    ? (navSource as FrameNavItem[])
    : undefined;

  const roleBadge =
    source.roleBadge === undefined && source.role === undefined
      ? undefined
      : (source.roleBadge as string | null | undefined) ??
        (source.role as string | null | undefined);

  return {
    portalName,
    roleBadge,
    navItems,
    onNavigate: typeof source.onNavigate === 'function' ? (source.onNavigate as (path: string) => void) : undefined,
    contentClassName: typeof source.contentClassName === 'string' ? source.contentClassName : undefined,
  };
}

function buildNav(navElement: HTMLElement, items: FrameNavItem[] | undefined, onNavigate?: (path: string) => void): void {
  navElement.replaceChildren();
  const list = document.createElement('ul');
  list.className = 'flex flex-col gap-1';

  for (const item of items ?? []) {
    const li = document.createElement('li');
    const link = document.createElement('a');
    link.textContent = item.label;
    const path = item.path.startsWith('#') ? item.path : `#${item.path.startsWith('/') ? item.path : `/${item.path}`}`;
    link.href = path;
    link.className =
      'block rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:bg-primary-light hover:text-primary-dark';
    if (item.onClick) {
      link.addEventListener('click', (event) => {
        event.preventDefault();
        item.onClick?.();
        onNavigate?.(item.path);
      });
    } else if (onNavigate) {
      link.addEventListener('click', (event) => {
        event.preventDefault();
        onNavigate(item.path);
      });
    }
    li.append(link);
    list.append(li);
  }

  navElement.append(list);
}

export function createFrame(input: FrameInput = 'Portal'): PortalFrame {
  const options = normalizeOptions(input);

  const root = document.createElement('div');
  root.className = 'flex min-h-screen flex-col bg-slate-50';

  const header = document.createElement('header');
  header.className = 'flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3';

  const title = document.createElement('h1');
  title.className = 'text-lg font-semibold text-slate-900';
  title.textContent = options.portalName;
  header.append(title);

  const roleBadge = badge(options.roleBadge ?? '', 'primary');
  if (!options.roleBadge) {
    roleBadge.hidden = true;
  }
  header.append(roleBadge);

  const mockBanner = buildMockBanner();

  const body = document.createElement('div');
  body.className = 'flex flex-1 flex-col md:flex-row';

  const nav = document.createElement('nav');
  nav.className = 'w-full border-b border-slate-200 bg-white p-3 md:w-56 md:border-b-0 md:border-r';
  buildNav(nav, options.navItems, options.onNavigate);

  const content = document.createElement('main');
  content.className = options.contentClassName ?? 'flex-1 p-4';
  content.id = 'main-content';
  content.tabIndex = -1;
  body.append(nav, content);

  const toastHost = document.createElement('div');
  toastHost.className = 'fixed bottom-4 right-4 z-50 flex flex-col gap-2';
  toastHost.setAttribute('aria-live', 'polite');

  // Keyboard users can jump straight past the navigation to the content.
  const skipLink = document.createElement('a');
  skipLink.href = '#main-content';
  skipLink.className =
    'sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 ' +
    'focus:rounded-md focus:bg-primary-dark focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-white';
  skipLink.textContent = 'Skip to main content';
  skipLink.addEventListener('click', (event) => {
    event.preventDefault();
    content.focus();
  });

  root.append(skipLink, header, mockBanner, body, toastHost);

  // Ask the server for its chain mode once. Until it answers the banner stays
  // hidden; if the server cannot be reached it also stays hidden.
  if (typeof fetch === 'function') {
    void fetch('/api/health')
      .then(async (response) => {
        if (!response.ok) {
          return;
        }
        const health = (await response.json()) as { mode?: unknown };
        mockBanner.hidden = !shouldShowMockBanner(
          typeof health.mode === 'string' ? health.mode : undefined,
        );
      })
      .catch(() => {
        // Leave the banner hidden when health is unavailable.
      });
  }

  const setRoleBadge = (label: string | null): void => {
    if (label === null || label === '') {
      roleBadge.hidden = true;
      roleBadge.textContent = '';
    } else {
      roleBadge.hidden = false;
      roleBadge.textContent = label;
    }
  };

  const setNav = (items: FrameNavItem[]): void => {
    buildNav(nav, items, options.onNavigate);
  };

  return { element: root, header, nav, content, toastHost, setRoleBadge, setNav };
}

export function frame(input?: FrameInput): HTMLElement {
  const created = createFrame(input ?? 'Portal');
  const element = created.element;
  (element as HTMLElement & { content: HTMLElement; toastHost: HTMLElement }).content = created.content;
  (element as HTMLElement & { content: HTMLElement; toastHost: HTMLElement }).toastHost = created.toastHost;
  return element;
}

export const renderFrame = frame;
export type { PortalFrame as Frame };
export const createPortalFrame = createFrame;

export default frame;