const controlClasses =
  'w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-primary focus:ring-2 focus:ring-primary-light disabled:bg-slate-100';

export interface TextareaOptions {
  id: string;
  label: string;
  name?: string;
  placeholder?: string;
  rows?: number;
  value?: string;
  disabled?: boolean;
}

export const textarea = ({
  id,
  label,
  name = id,
  placeholder,
  rows = 3,
  value,
  disabled = false,
}: TextareaOptions): HTMLDivElement => {
  const wrapper = document.createElement('div');
  wrapper.className = 'flex w-full flex-col gap-1 text-sm font-medium text-slate-700';

  const labelElement = document.createElement('label');
  labelElement.htmlFor = id;
  labelElement.textContent = label;

  const control = document.createElement('textarea');
  control.id = id;
  control.name = name;
  control.rows = rows;
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
