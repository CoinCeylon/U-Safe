const controlClasses =
  'w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-primary focus:ring-2 focus:ring-primary-light disabled:bg-slate-100';

export interface InputOptions {
  id: string;
  label: string;
  name?: string;
  type?: 'text' | 'email' | 'password' | 'number';
  placeholder?: string;
  value?: string;
  disabled?: boolean;
}

export const input = ({
  id,
  label,
  name = id,
  type = 'text',
  placeholder,
  value,
  disabled = false,
}: InputOptions): HTMLDivElement => {
  const wrapper = document.createElement('div');
  wrapper.className = 'flex w-full flex-col gap-1 text-sm font-medium text-slate-700';

  const labelElement = document.createElement('label');
  labelElement.htmlFor = id;
  labelElement.textContent = label;

  const control = document.createElement('input');
  control.id = id;
  control.name = name;
  control.type = type;
  control.className = controlClasses;
  control.disabled = disabled;

  if (placeholder !== undefined) {
    control.placeholder = placeholder;
  }

  if (value !== undefined) {
    control.value = value;
  }

  wrapper.append(labelElement, control);
  return wrapper;
};
