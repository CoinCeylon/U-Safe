import '../styles/app.css';

const root = document.querySelector<HTMLDivElement>('#app');
if (!root) {
  throw new Error('Missing #app root');
}

const heading = document.createElement('h1');
heading.className = 'min-h-screen bg-slate-50 p-8 text-3xl font-bold text-slate-900';
heading.textContent = 'Student Portal';
root.append(heading);
