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
  navItems: [{ label: 'Complaints', path: '/' }],
});

root.append(portalFrame.element);

const router = createRouter(portalFrame.content);

router.register('/', () => {
  const section = document.createElement('section');
  section.textContent = 'Loading complaints…';
  void renderUgcComplaintOverview(section);
  return section;
});

router.start();
