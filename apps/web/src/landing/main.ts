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
  section.append(heading, text);
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