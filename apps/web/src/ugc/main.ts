import '../styles/app.css';
import { createFrame } from '../ui/frame';
import { createRouter } from '../lib/router';
import { renderUgcComplaintOverview } from '../lib/complaintOverview';

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) {
  throw new Error('Missing #app root');
}

const portalFrame = createFrame({
  portalName: 'UGC Portal',
  roleBadge: 'ugc',
  navItems: [
    { label: 'Complaints', path: '/' },
    { label: 'About', path: '/about' },
  ],
});

root.append(portalFrame.element);

const router = createRouter(portalFrame.content);

router.register('/', () => {
  const section = document.createElement('section');
  section.textContent = 'Loading complaints…';
  void renderUgcComplaintOverview(section);
  return section;
});

router.register('/about', () => {
  const section = document.createElement('section');
  section.className = 'flex flex-col gap-2 max-w-2xl mx-auto';
  const heading = document.createElement('h2');
  heading.className = 'text-xl font-semibold text-slate-900';
  heading.textContent = 'UGC overview';
  const text = document.createElement('p');
  text.className = 'text-sm text-slate-600';
  text.textContent =
    'This portal shows complaints across registered universities. The full UGC dashboard arrives in a later milestone.';
  section.append(heading, text);
  return section;
});

router.start();
