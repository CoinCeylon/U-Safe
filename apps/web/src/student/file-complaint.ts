// Student file complaint form (M057/M058).
//
// M057: mandatory description (40-4000 characters), category, urgency, staff
// involvement, optional accused details and plain-language guidance.
// M058: evidence picker with up to 5 files of 25 MB each. Images are stripped
// with stripImage; videos, audio and documents keep their metadata, so the
// form asks for an acknowledgement before those can be attached.
//
// Submission is still a placeholder: the submission pipeline is M060.

import { MAX_EVIDENCE_FILES } from '@usafe/shared';
import { button } from '../ui/button';
import {
  evidenceKind,
  formatBytes,
  needsMetadataWarning,
  prepareEvidenceFile,
  validateEvidenceFiles,
  type EvidenceKind,
  type EvidenceRejection,
} from './evidence';

export interface FileComplaintInput {
  description: string;
  category: 'verbal' | 'physical' | 'sexual' | 'cyber' | 'financial' | 'other';
  urgency: 'normal' | 'urgent';
  staffInvolved: boolean;
  accusedPersonDetails?: string;
  evidenceFiles: File[];
}

export interface EvidenceFile {
  name: string;
  size: number;
  type: string;
}

interface EvidenceItem {
  file: File;
  kind: EvidenceKind;
  warning: boolean;
  previewUrl: string | null;
  entry: HTMLElement;
  detail: HTMLElement;
}

const CATEGORIES: FileComplaintInput['category'][] = [
  'verbal',
  'physical',
  'sexual',
  'cyber',
  'financial',
  'other',
];

function previewFor(file: File, kind: EvidenceKind): {
  element: HTMLElement;
  url: string | null;
} {
  if (kind === 'image') {
    const url = URL.createObjectURL(file);
    const image = document.createElement('img');
    image.src = url;
    image.alt = `Preview of ${file.name}`;
    image.className = 'h-10 w-10 rounded border border-slate-200 object-cover';
    return { element: image, url };
  }
  const icon = document.createElement('div');
  icon.className =
    'flex h-10 w-10 shrink-0 items-center justify-center rounded border border-slate-200 bg-slate-50 text-xs font-medium text-slate-500';
  icon.textContent =
    kind === 'video' ? 'VIDEO' : kind === 'audio' ? 'AUDIO' : kind === 'pdf' ? 'PDF' : 'DOC';
  return { element: icon, url: null };
}

export function renderFileComplaintForm(outlet: HTMLElement): void {
  // Filing slots remaining (mock value: there is no usage endpoint yet).
  const slotsLeft = 3;

  const section = document.createElement('section');
  section.className = 'flex flex-col gap-4 max-w-md mx-auto py-4';

  const heading = document.createElement('h2');
  heading.className = 'text-lg font-semibold text-slate-900';
  heading.textContent = 'File a complaint';
  section.append(heading);

  const guidance = document.createElement('div');
  guidance.className = 'rounded-md bg-slate-50 p-3 text-sm text-slate-600';
  guidance.innerHTML = `
    <p>Take your time. You do not need to include names or other details that could identify you.</p>
    <ul class="mt-2 list-disc pl-4">
      <li>Write at least 40 characters and at most 4000 characters.</li>
      <li>Avoid real names, hostel rooms, dates or other details that could identify you.</li>
      <li>Attachments may contain metadata. Images are cleaned; videos and documents may not be.</li>
    </ul>
  `;
  section.append(guidance);

  const form = document.createElement('form');
  form.className = 'flex flex-col gap-3';
  section.append(form);

  const descriptionLabel = document.createElement('label');
  descriptionLabel.htmlFor = 'complaint-description';
  descriptionLabel.className = 'text-sm font-medium text-slate-700';
  descriptionLabel.textContent = 'What happened?';
  const descriptionInput = document.createElement('textarea');
  descriptionInput.id = 'complaint-description';
  descriptionInput.rows = 5;
  descriptionInput.required = true;
  descriptionInput.className =
    'w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary-light';
  descriptionInput.placeholder = 'Describe what happened (minimum 40 characters)';
  form.append(descriptionLabel, descriptionInput);

  const categoryLabel = document.createElement('label');
  categoryLabel.htmlFor = 'complaint-category';
  categoryLabel.className = 'text-sm font-medium text-slate-700';
  categoryLabel.textContent = 'Category';
  const categorySelect = document.createElement('select');
  categorySelect.id = 'complaint-category';
  categorySelect.className =
    'w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm outline-none focus:border-primary';
  for (const category of CATEGORIES) {
    const option = document.createElement('option');
    option.value = category;
    option.textContent = category.charAt(0).toUpperCase() + category.slice(1);
    categorySelect.append(option);
  }
  form.append(categoryLabel, categorySelect);

  const urgencyGroup = document.createElement('div');
  urgencyGroup.className = 'flex items-center gap-2 text-sm text-slate-700';
  const urgencyNormal = document.createElement('input');
  urgencyNormal.type = 'radio';
  urgencyNormal.name = 'urgency';
  urgencyNormal.id = 'urgency-normal';
  urgencyNormal.value = 'normal';
  urgencyNormal.checked = true;
  const urgencyNormalLabel = document.createElement('label');
  urgencyNormalLabel.htmlFor = 'urgency-normal';
  urgencyNormalLabel.textContent = 'Normal';
  const urgencyUrgent = document.createElement('input');
  urgencyUrgent.type = 'radio';
  urgencyUrgent.name = 'urgency';
  urgencyUrgent.id = 'urgency-urgent';
  urgencyUrgent.value = 'urgent';
  const urgencyUrgentLabel = document.createElement('label');
  urgencyUrgentLabel.htmlFor = 'urgency-urgent';
  urgencyUrgentLabel.textContent = 'Urgent';
  urgencyGroup.append(
    urgencyNormal, urgencyNormalLabel, urgencyUrgent, urgencyUrgentLabel,
  );
  form.append(urgencyGroup);

  const staffRow = document.createElement('div');
  staffRow.className = 'flex items-center text-sm text-slate-700';
  const staffInvolvedInput = document.createElement('input');
  staffInvolvedInput.type = 'checkbox';
  staffInvolvedInput.id = 'staff-involved';
  const staffInvolvedLabel = document.createElement('label');
  staffInvolvedLabel.htmlFor = 'staff-involved';
  staffInvolvedLabel.className = 'ml-2';
  staffInvolvedLabel.textContent = 'This involves a staff member or official';
  staffRow.append(staffInvolvedInput, staffInvolvedLabel);
  form.append(staffRow);

  const accusedDetails = document.createElement('div');
  accusedDetails.className = 'hidden flex-col gap-1 text-sm';
  const accusedLabel = document.createElement('label');
  accusedLabel.htmlFor = 'accused-details';
  accusedLabel.className = 'font-medium text-slate-700';
  accusedLabel.textContent = 'Accused person details (optional)';
  const accusedInput = document.createElement('textarea');
  accusedInput.id = 'accused-details';
  accusedInput.rows = 2;
  accusedInput.className =
    'w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-primary';
  accusedInput.placeholder = 'Only include details you are comfortable sharing';
  accusedDetails.append(accusedLabel, accusedInput);
  staffInvolvedInput.addEventListener('change', () => {
    accusedDetails.classList.toggle('hidden', !staffInvolvedInput.checked);
  });
  form.append(accusedDetails);

  // ---- Evidence picker (M058) ----
  const evidenceFieldset = document.createElement('fieldset');
  evidenceFieldset.className = 'flex flex-col gap-2';
  const evidenceLegend = document.createElement('legend');
  evidenceLegend.className = 'text-sm font-medium text-slate-700';
  evidenceLegend.textContent = `Evidence (optional, up to ${MAX_EVIDENCE_FILES} files)`;
  evidenceFieldset.append(evidenceLegend);

  const evidenceInput = document.createElement('input');
  evidenceInput.type = 'file';
  evidenceInput.multiple = true;
  evidenceInput.className = 'hidden';
  evidenceInput.accept =
    'image/*,video/*,audio/*,application/pdf,.doc,.docx,.odt,.rtf,.txt,.csv';

  const pickButton = button({
    label: 'Choose files',
    variant: 'secondary',
    onClick: () => evidenceInput.click(),
  });
  const evidenceCount = document.createElement('p');
  evidenceCount.className = 'text-xs text-slate-500';

  const errors = document.createElement('ul');
  errors.className = 'list-disc pl-5 text-xs text-danger';
  errors.setAttribute('role', 'alert');

  const evidenceList = document.createElement('div');
  evidenceList.className = 'flex flex-col';

  const acknowledgeRow = document.createElement('div');
  acknowledgeRow.className = 'hidden items-start text-xs text-slate-600';
  const acknowledge = document.createElement('input');
  acknowledge.type = 'checkbox';
  acknowledge.id = 'evidence-acknowledge';
  const acknowledgeLabel = document.createElement('label');
  acknowledgeLabel.htmlFor = 'evidence-acknowledge';
  acknowledgeLabel.className = 'ml-2';
  acknowledgeLabel.textContent =
    'I understand that metadata could not be removed from some of these files.';
  acknowledgeRow.append(acknowledge, acknowledgeLabel);

  const items: EvidenceItem[] = [];

  function showErrors(rejections: EvidenceRejection[]): void {
    errors.replaceChildren();
    for (const rejection of rejections) {
      const item = document.createElement('li');
      item.textContent = `${rejection.name}: ${rejection.reason}`;
      errors.append(item);
    }
  }

  function updateEvidenceState(): void {
    evidenceCount.textContent = `${items.length} of ${MAX_EVIDENCE_FILES} files attached`;
    pickButton.disabled = items.length >= MAX_EVIDENCE_FILES;
    const hasWarnings = items.some((item) => item.warning);
    acknowledgeRow.classList.toggle('hidden', !hasWarnings);
    acknowledgeRow.classList.toggle('flex', hasWarnings);
  }

  function removeItem(item: EvidenceItem): void {
    const index = items.indexOf(item);
    if (index >= 0) {
      items.splice(index, 1);
    }
    item.entry.remove();
    if (item.previewUrl !== null) {
      URL.revokeObjectURL(item.previewUrl);
    }
    updateEvidenceState();
  }

  function addItem(file: File): void {
    const kind = evidenceKind(file);
    if (kind === null) {
      return;
    }
    const preview = previewFor(file, kind);
    const name = document.createElement('p');
    name.className = 'truncate text-sm font-medium text-slate-900';
    name.textContent = file.name;
    const detail = document.createElement('p');
    detail.className = 'text-xs text-slate-500';
    detail.textContent = formatBytes(file.size);
    const info = document.createElement('div');
    info.className = 'min-w-0 flex-1';
    info.append(name, detail);

    const item: EvidenceItem = {
      file,
      kind,
      warning: needsMetadataWarning(file),
      previewUrl: preview.url,
      entry: document.createElement('div'),
      detail,
    };
    if (item.warning) {
      const note = document.createElement('p');
      note.className = 'text-xs text-warning';
      note.textContent = 'Metadata could not be removed from this file.';
      info.append(note);
    }

    const remove = button({
      label: 'Remove',
      variant: 'secondary',
      onClick: () => removeItem(item),
    });
    item.entry.className = 'mb-2 flex items-start gap-2';
    item.entry.append(preview.element, info, remove);
    items.push(item);
    evidenceList.append(item.entry);
    updateEvidenceState();

    if (kind === 'image') {
      void prepareEvidenceFile(file).then(({ file: strippedFile, stripped }) => {
        if (!items.includes(item)) {
          return;
        }
        item.file = strippedFile;
        if (stripped && item.previewUrl !== null && preview.element instanceof HTMLImageElement) {
          URL.revokeObjectURL(item.previewUrl);
          item.previewUrl = URL.createObjectURL(strippedFile);
          preview.element.src = item.previewUrl;
        } else if (!stripped && !item.warning) {
          // stripImage can fail for a corrupt image. It stays attached, but the
          // student must acknowledge that its metadata was not removed.
          item.warning = true;
          const note = document.createElement('p');
          note.className = 'text-xs text-warning';
          note.textContent = 'Metadata could not be removed from this file.';
          info.append(note);
          updateEvidenceState();
        }
        detail.textContent = stripped
          ? `${formatBytes(strippedFile.size)} · metadata stripped`
          : formatBytes(strippedFile.size);
      });
    }
  }

  evidenceInput.addEventListener('change', () => {
    const selected = Array.from(evidenceInput.files ?? []);
    // Clear the input so the same file can be chosen again after removal.
    evidenceInput.value = '';
    const result = validateEvidenceFiles(selected, items.length);
    showErrors(result.rejected);
    for (const accepted of result.accepted) {
      addItem(accepted);
    }
  });

  evidenceFieldset.append(
    evidenceInput, pickButton, evidenceCount, errors, evidenceList, acknowledgeRow,
  );
  form.append(evidenceFieldset);

  const slotsInfo = document.createElement('p');
  slotsInfo.className = 'text-xs text-slate-500';
  slotsInfo.textContent = `Filing slots left this month: ${slotsLeft}`;
  form.append(slotsInfo);

  const submit = button({ label: 'Submit complaint', type: 'submit' });
  form.append(submit);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const description = descriptionInput.value.trim();
    if (description.length < 40) {
      showErrors([{ name: 'Description', reason: 'Write at least 40 characters.' }]);
      descriptionInput.focus();
      return;
    }
    if (description.length > 4000) {
      showErrors([{ name: 'Description', reason: 'Write at most 4000 characters.' }]);
      descriptionInput.focus();
      return;
    }
    if (items.some((item) => item.warning) && !acknowledge.checked) {
      showErrors([
        {
          name: 'Evidence',
          reason: 'Acknowledge that metadata could not be removed from some files.',
        },
      ]);
      return;
    }
    showErrors([]);

    // Handed to the submission pipeline in M060. Kept here so M057 validation
    // still produces the complete input object.
    const input: FileComplaintInput = {
      description,
      category: categorySelect.value as FileComplaintInput['category'],
      urgency: urgencyNormal.checked ? 'normal' : 'urgent',
      staffInvolved: staffInvolvedInput.checked,
      evidenceFiles: items.map((item) => item.file),
    };
    if (staffInvolvedInput.checked && accusedInput.value.trim() !== '') {
      input.accusedPersonDetails = accusedInput.value.trim();
    }

    form.replaceChildren();
    const success = document.createElement('p');
    success.className = 'text-sm text-slate-600';
    success.textContent =
      `Thank you. Your ${input.urgency} complaint was submitted with ` +
      `${input.evidenceFiles.length} evidence file(s).`;
    form.append(success);
  });

  updateEvidenceState();
  outlet.append(section);
}

export function formatFileSize(bytes: number): string {
  return `(${formatBytes(bytes)})`;
}
