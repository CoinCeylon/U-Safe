import '../styles/app.css';
import { createFrame } from '../ui/frame';
import { createRouter } from '../lib/router';
import { button } from '../ui/button';

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) {
  throw new Error('Missing #app root');
}

const portalFrame = createFrame({
  portalName: 'U-Safe',
  navItems: [
    { label: 'Home', path: '/' },
    { label: 'About', path: '/about' },
  ],
});

root.append(portalFrame.element);

const router = createRouter(portalFrame.content);

// ---------------------------------------------------------------------------
// Mock-mode banner
// ---------------------------------------------------------------------------
// The shared portal frame renders the banner from `/api/health`, so the
// landing page gets the same live element as the student, university and UGC
// portals (M048 / AGENT.md section 6). No cloned, never-updated node here.

// ---------------------------------------------------------------------------
// Home route: the landing page
// ---------------------------------------------------------------------------
router.register('/', () => {
  const section = document.createElement('section');
  section.className = 'flex flex-col gap-5 max-w-2xl mx-auto';

  const heading = document.createElement('h1');
  heading.className = 'text-2xl font-semibold text-slate-900';
  heading.textContent = 'U-Safe';
  section.append(heading);

  const intro = document.createElement('p');
  intro.className = 'text-slate-600 leading-relaxed';
  intro.textContent =
    'U-Safe helps students file anonymous ragging complaints at their university. Your identity is never stored together with your complaint. Choose a portal below to get started.';
  section.append(intro);

  const portals = [
    {
      label: 'Student Portal',
      path: '/student/index.html',
      description:
        'File a complaint, support other students, and track your own cases.',
    },
    {
      label: 'University Portal',
      path: '/university/index.html',
      description:
        'Manage complaints, update case status, and review evidence.',
    },
    {
      label: 'UGC Portal',
      path: '/ugc/index.html',
      description:
        'National overview, reopen cases, and add notes across universities.',
    },
  ];

  const heading2 = document.createElement('h2');
  heading2.className = 'text-lg font-semibold text-slate-900 mt-6';
  heading2.textContent = 'Choose a portal';
  section.append(heading2);

  const grid = document.createElement('div');
  grid.className = 'grid gap-3 sm:grid-cols-1 md:grid-cols-3';

  for (const p of portals) {
    const card = document.createElement('div');
    card.className =
      'rounded-lg border border-slate-200 bg-white p-5 hover:border-primary hover:shadow-sm transition';

    const link = document.createElement('a');
    link.href = p.path;
    link.className = 'block w-full';
    link.addEventListener('click', () => {
      // Full-page navigation to the portal entry page.
      window.location.href = p.path;
    });

    const btn = button({
      label: p.label,
      variant: 'primary',
    });
    btn.className = 'w-full justify-start text-base';

    const desc = document.createElement('p');
    desc.className = 'mt-3 text-sm text-slate-600';
    desc.textContent = p.description;

    link.append(btn, desc);
    card.append(link);
    grid.append(card);
  }

  section.append(grid);
  return section;
});

// ---------------------------------------------------------------------------
// About route
// ---------------------------------------------------------------------------
router.register('/about', () => {
  const section = document.createElement('section');
  section.className = 'flex flex-col gap-2 max-w-2xl mx-auto';

  const heading = document.createElement('h2');
  heading.className = 'text-xl font-semibold text-slate-900';
  heading.textContent = 'About';
  section.append(heading);

  const text = document.createElement('p');
  text.className = 'text-sm text-slate-600 leading-relaxed';
  text.textContent =
    'U-Safe is an anonymous ragging complaint system for universities. Complaints, evidence and identities are protected. The server never sees your email together with your commitment.';
  section.append(heading, text);
  return section;
});

router.start();
