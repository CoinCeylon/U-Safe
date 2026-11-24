import '../styles/app.css';
import { createFrame } from '../ui/frame';
import { createRouter } from '../lib/router';
import { fetchUniversities, renderWizard } from './wizard';

// Universities are resolved before the router starts so the onboarding wizard
// can render synchronously. fetchUniversities falls back to a demo list when
// the server is unavailable, so this never rejects.
const universities = await fetchUniversities();

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) {
  throw new Error('Missing #app root');
}

const portalFrame = createFrame({
  portalName: 'Student Portal',
  roleBadge: 'student',
  navItems: [
    { label: 'Home', path: '/' },
  ],
});

root.append(portalFrame.element);

const router = createRouter(portalFrame.content);

router.register('/', () => {
  const section = document.createElement('section');
  section.className = 'flex flex-col gap-4 max-w-md mx-auto py-4';
  const wizard = renderWizard(section, universities);
  section.append(wizard.element);
  return section;
});

router.start();
