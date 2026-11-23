import type { Status } from '@usafe/shared';

export type BadgeVariant = 'neutral' | 'primary' | 'success' | 'warning' | 'danger';

const variantClasses: Record<BadgeVariant, string> = {
  neutral: 'bg-slate-100 text-slate-700',
  primary: 'bg-primary-light text-primary-dark',
  success: 'bg-success-light text-success',
  warning: 'bg-warning-light text-warning',
  danger: 'bg-danger-light text-danger',
};

const statusVariants: Record<Status, BadgeVariant> = {
  not_started: 'warning',
  pending_investigation: 'primary',
  finished: 'success',
};

export const badge = (label: string, variant: BadgeVariant = 'neutral'): HTMLSpanElement => {
  const element = document.createElement('span');
  element.textContent = label;
  element.className = `inline-flex rounded-full px-2 py-1 text-xs font-medium ${variantClasses[variant]}`;
  return element;
};

export const statusBadge = (status: Status): HTMLSpanElement =>
  badge(status.replaceAll('_', ' '), statusVariants[status]);
