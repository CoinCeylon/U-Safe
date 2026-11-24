export type ToastTone = 'info' | 'success' | 'warning' | 'danger';

const toneClasses: Record<ToastTone, string> = {
  info: 'border-primary bg-primary-light text-primary-dark',
  success: 'border-success bg-success-light text-success',
  warning: 'border-warning bg-warning-light text-warning',
  danger: 'border-danger bg-danger-light text-danger',
};

const TOAST_HOST_ID = 'usafe-toast-host';
const TOAST_LIFETIME_MS = 6000;

function toastHost(): HTMLElement {
  const existing = document.getElementById(TOAST_HOST_ID);
  if (existing) {
    return existing;
  }
  const host = document.createElement('div');
  host.id = TOAST_HOST_ID;
  host.className = 'fixed bottom-4 right-4 z-50 flex flex-col gap-2';
  host.setAttribute('aria-live', 'polite');
  document.body.append(host);
  return host;
}

// Mounts the toast itself so callers that ignore the return value still show it.
export const toast = (message: string, tone: ToastTone = 'info'): HTMLDivElement => {
  const element = document.createElement('div');
  element.setAttribute('role', 'status');
  element.textContent = message;
  element.className = `w-full max-w-sm rounded-md border px-3 py-2 text-sm ${toneClasses[tone]}`;
  const host = toastHost();
  host.append(element);
  window.setTimeout(() => {
    if (element.parentElement === host) {
      element.remove();
    }
  }, TOAST_LIFETIME_MS);
  return element;
};
