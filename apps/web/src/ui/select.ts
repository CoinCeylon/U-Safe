const controlClasses =
  'w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-primary focus:ring-2 focus:ring-primary-light disabled:bg-slate-100';

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectOptions {
  id: string;
  label: string;
  name?: string;
  options: readonly SelectOption[];
  value?: string;
  disabled?: boolean;
}

export const select = ({
  id,
  label,
  name = id,
  options,
  value,
  disabled = false,
}: SelectOptions): HTMLDivElement => {
  const wrapper = document.createElement('div');
  wrapper.className = 'flex w-full flex-col gap-1 text-sm font-medium text-slate-700';

  const labelElement = document.createElement('label');
  labelElement.htmlFor = id;
  labelElement.textContent = label;

  const control = document.createElement('select');
  control.id = id;
  control.name = name;
  control.className = controlClasses;
  control.disabled = disabled;

  for (const option of options) {
    const element = document.createElement('option');
    element.value = option.value;
    element.textContent = option.label;
    control.append(element);
  }

  if (value !== undefined) {
    control.value = value;
  }

  wrapper.append(labelElement, control);
  return wrapper;
};
