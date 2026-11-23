export type ToastTone = 'info' | 'success' | 'warning' | 'danger';

const toneClasses: Record<ToastTone, string> = {
  info: 'border-primary bg-primary-light text-primary-dark',
  success: 'border-success bg-success-light text-success',
  warning: 'border-warning bg-warning-light text-warning',
  danger: 'border-danger bg-danger-light text-danger',
};

export const toast = (message: string, tone: ToastTone = 'info'): HTMLDivElement => {
  const element = document.createElement('div');
  element.setAttribute('role', 'status');
  element.textContent = message;
  element.className = `w-full max-w-sm rounded-md border px-3 py-2 text-sm ${toneClasses[tone]}`;
  return element;
};
