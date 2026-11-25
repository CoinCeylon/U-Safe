import '../styles/app.css';
import { createFrame } from '../ui/frame';
import { createRouter } from '../lib/router';
import { fetchUniversities, renderWizard } from './wizard';
import { renderFileComplaintForm } from './file-complaint';
import { renderFeed } from './feed';
import { renderDetail } from './detail';
import { renderMyComplaints } from './my-complaints';
import { getStudentSecret } from './unlock';
import { getRememberedUniversity } from './session';
import { ensureUnlocked } from './session';
import { refreshCredential } from './credential';

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) {
  throw new Error('Missing #app root');
}

const portalFrame = createFrame({
  portalName: 'Student Portal',
  roleBadge: 'student',
  navItems: [
    { label: 'Home', path: '/' },
    { label: 'Community feed', path: '/feed' },
    { label: 'File a complaint', path: '/file-complaint' },
    { label: 'My complaints', path: '/my-complaints' },
  ],
});

root.append(portalFrame.element);

const router = createRouter(portalFrame.content);

// One shared request for the university list. The router renders a first visit
// twice (it sets the hash); two identical requests in flight left one stuck,
// so the wizard never appeared.
const universitiesReady = fetchUniversities();

router.register('/', () => {
  const section = document.createElement('section');
  section.className = 'flex flex-col gap-4 max-w-md mx-auto py-4';

  const universityId = getRememberedUniversity();
  if (universityId !== null && getStudentSecret() !== null) {
    void renderFeed(section);
    return section;
  }

  if (universityId !== null) {
    const message = document.createElement('p');
    message.className = 'text-sm text-slate-600';
    message.textContent =
      'Welcome back. Unlock your student secret to open your community feed.';
    const button = document.createElement('button');
    button.type = 'button';
    button.className =
      'rounded-md border border-primary bg-primary px-4 py-2 text-sm font-medium text-white';
    button.textContent = 'Unlock student secret';
    button.addEventListener('click', () => {
      void (async () => {
        try {
          await ensureUnlocked(universityId);
          await refreshCredential(universityId);
          await renderFeed(section);
        } catch {
          section.innerHTML =
            '<p class="text-danger">Could not unlock your secret. Please try again.</p>';
        }
      })();
    });
    section.append(message, button);
    return section;
  }

  const loading = document.createElement('p');
  loading.className = 'text-sm text-slate-600';
  loading.textContent = 'Loading universities…';
  section.append(loading);
  void universitiesReady.then((universities) => {
    section.replaceChildren();
    renderWizard(section, universities);
  });
  return section;
});

router.register('/feed', () => {
  const section = document.createElement('section');
  void renderFeed(section);
  return section;
});

router.register('/complaint/:id', (params) => {
  const section = document.createElement('section');
  void renderDetail(section, params.id ?? '');
  return section;
});

router.register('/file-complaint', () => {
  const section = document.createElement('section');
  renderFileComplaintForm(section);
  return section;
});

router.register('/my-complaints', () => {
  const section = document.createElement('section');
  void renderMyComplaints(section);
  return section;
});

router.start();
