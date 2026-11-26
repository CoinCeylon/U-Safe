import '../styles/app.css';
import { createFrame } from '../ui/frame';
import { createRouter } from '../lib/router';
import { renderUniversityComplaintOverview } from '../lib/complaintOverview';

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) {
  throw new Error('Missing #app root');
}

const portalFrame = createFrame({
  portalName: 'University Portal',
  roleBadge: 'university',
  navItems: [{ label: 'Complaints', path: '/' }],
});

root.append(portalFrame.element);

const router = createRouter(portalFrame.content);

router.register('/', () => {
  const section = document.createElement('section');
  section.textContent = 'Loading complaints…';
  void renderUniversityComplaintOverview(section);
  return section;
});

router.start();
