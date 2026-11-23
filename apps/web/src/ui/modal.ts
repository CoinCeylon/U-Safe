import { button } from './button';

export interface ModalOptions {
  id: string;
  title: string;
  content: Node | string;
}

export const modal = ({ id, title, content }: ModalOptions): HTMLDialogElement => {
  const dialog = document.createElement('dialog');
  dialog.id = id;
  dialog.className = 'w-full max-w-md rounded-lg border border-slate-200 bg-white p-0 shadow-xl';

  const wrapper = document.createElement('div');
  wrapper.className = 'flex flex-col gap-4 p-4';

  const heading = document.createElement('h2');
  heading.className = 'text-base font-semibold text-slate-900';
  heading.textContent = title;

  const body = document.createElement('div');
  body.className = 'text-sm text-slate-600';
  body.append(content);

  const footer = document.createElement('div');
  footer.className = 'flex justify-end';
  footer.append(
    button({
      label: 'Close',
      variant: 'secondary',
      onClick: () => {
        dialog.close();
      },
    }),
  );

  wrapper.append(heading, body, footer);
  dialog.append(wrapper);
  return dialog;
};
