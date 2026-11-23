import '../styles/app.css';
import { createFrame } from '../ui/frame';
import { createRouter } from '../lib/router';

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) {
  throw new Error('Missing #app root');
}

const portalFrame = createFrame({
  portalName: 'Student Portal',
  roleBadge: 'student',
  navItems: [
    { label: 'Home', path: '/' },
    { label: 'Second', path: '/second' },
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
  text.textContent = 'Student home placeholder.';
  section.append(heading, text);
  return section;
});
router.register('/second', () => {
  const section = document.createElement('section');
  section.className = 'flex flex-col gap-2';
  const heading = document.createElement('h2');
  heading.className = 'text-xl font-semibold text-slate-900';
  heading.textContent = 'Second';
  const text = document.createElement('p');
  text.className = 'text-sm text-slate-600';
  text.textContent = 'Student second placeholder.';
  section.append(heading, text);
  return section;
});
router.start();