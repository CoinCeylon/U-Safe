import '../styles/app.css';
import { createFrame } from '../ui/frame';
import { createRouter } from '../lib/router';

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
router.register('/', () => {
  const section = document.createElement('section');
  section.className = 'flex flex-col gap-2';
  const heading = document.createElement('h2');
  heading.className = 'text-xl font-semibold text-slate-900';
  heading.textContent = 'Home';
  const text = document.createElement('p');
  text.className = 'text-sm text-slate-600';
  text.textContent = 'Landing home placeholder.';
  const health = document.createElement('p');
  health.className = 'text-sm text-slate-600';
  health.textContent = 'Checking server health...';
  section.append(heading, text, health);

  const checkHealth = (attempt: number): void => {
    fetch('/api/health')
      .then((response) => response.json() as Promise<{ ok: boolean; mode: string }>)
      .then((data) => {
        health.textContent = `Server health: ok=${String(data.ok)}, mode=${data.mode}`;
      })
      .catch(() => {
        if (attempt < 10) {
          window.setTimeout(() => checkHealth(attempt + 1), 500);
        } else {
          health.textContent = 'Server health: unavailable';
        }
      });
  };
  checkHealth(0);

  return section;
});
router.register('/about', () => {
  const section = document.createElement('section');
  section.className = 'flex flex-col gap-2';
  const heading = document.createElement('h2');
  heading.className = 'text-xl font-semibold text-slate-900';
  heading.textContent = 'About';
  const text = document.createElement('p');
  text.className = 'text-sm text-slate-600';
  text.textContent = 'Landing about placeholder.';
  section.append(heading, text);
  return section;
});
router.start();