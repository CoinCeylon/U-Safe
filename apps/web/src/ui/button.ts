export type ButtonVariant = 'primary' | 'secondary' | 'danger';

export interface ButtonOptions {
  label: string;
  variant?: ButtonVariant;
  onClick?: () => void;
  disabled?: boolean;
  type?: 'button' | 'submit';
}

const variantClasses: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-white hover:bg-primary-dark',
  secondary: 'border border-primary bg-white text-primary hover:bg-primary-light',
  danger: 'bg-danger text-white hover:bg-danger/90',
};

export const button = ({
  label,
  variant = 'primary',
  onClick,
  disabled = false,
  type = 'button',
}: ButtonOptions): HTMLButtonElement => {
  const element = document.createElement('button');
  element.type = type;
  element.disabled = disabled;
  element.textContent = label;
  element.className = `rounded-md px-3 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${variantClasses[variant]}`;

  if (onClick) {
    element.addEventListener('click', onClick);
  }

  return element;
};
