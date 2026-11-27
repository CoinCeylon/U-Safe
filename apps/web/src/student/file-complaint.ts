// Student file complaint form (M057/M058/M059/M060).
//
// M057: mandatory description (40-4000 characters), category, urgency, staff
// involvement, optional accused details and plain-language guidance.
// M058: evidence picker with up to 5 files of 25 MB each. Images are stripped
// with stripImage; videos, audio and documents keep their metadata, so the
// form asks for an acknowledgement before those can be attached.
// M059: while the description is typed (and once more before submit), the
// form compares it with the open complaints of the same university in the
// browser. Close matches above the token-overlap threshold are shown with a
// "Support this one instead" link so support is not split across duplicates.
// M060: the submit handler runs the encrypted submission pipeline with a
// visible progress list. A failure shows the failed step and a retry button;
// retrying reuses the cached encrypted blobs, so nothing is uploaded twice.

import { FILING_LIMIT_PER_MONTH, MAX_EVIDENCE_FILES } from '@usafe/shared';
import { button } from '../ui/button';
import { toast } from '../ui/toast';
import { friendlyError, isOfflineError, OFFLINE_MESSAGE } from '../lib/offline';
import {
  evidenceKind,
  formatBytes,
  needsMetadataWarning,
  prepareEvidenceFile,
  validateEvidenceFiles,
  type EvidenceKind,
  type EvidenceRejection,
} from './evidence';
import { getRememberedUniversity, ensureUnlocked } from './session';
import { loadOpenComplaintTexts, type OpenComplaintText } from './complaint-text';
import { findSimilarComplaints, MAX_DUPLICATE_SUGGESTIONS } from './similar';
import { getCachedCredential, refreshCredential } from './credential';
import { getStudentSecret } from './unlock';
import {
  countFilingsInMonth,
  loadFilingReceipts,
  saveFilingReceipt,
} from './filings';
import {
  FilingLimitError,
  SUBMIT_STEPS,
  StepError,
  SubmissionPipeline,
  type StepProgress,
  type SubmissionInput,
  type SubmitStepId,
} from './submit';

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
  // Filing slots remaining, derived from this browser's receipts for the
  // current year-month (M057). The locked limit is FILING_LIMIT_PER_MONTH.
  let slotsLeft = FILING_LIMIT_PER_MONTH;

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

  // ---- Duplicate suggestions (M059) ----
  // Surfaced while the student types, and refreshed before the final submit
  // step. The comparison runs entirely in the browser against descriptions
  // the portal has cached locally; nothing typed here is sent anywhere.
  const suggestionsBox = document.createElement('div');
  suggestionsBox.className = 'hidden flex-col gap-2 rounded-md border border-warning bg-warning-light p-3';
  form.append(suggestionsBox);

  let openTexts: OpenComplaintText[] = [];
  const rememberedUniversity = getRememberedUniversity();
  if (rememberedUniversity !== null) {
    void loadOpenComplaintTexts(rememberedUniversity).then((texts) => {
      openTexts = texts;
      updateSuggestions();
    });
  }

  function updateSuggestions(): void {
    const description = descriptionInput.value.trim();
    if (description.length < 40 || openTexts.length === 0) {
      suggestionsBox.replaceChildren();
      suggestionsBox.classList.add('hidden');
      return;
    }

    const similar = findSimilarComplaints(description, openTexts);
    if (similar.length === 0) {
      suggestionsBox.replaceChildren();
      suggestionsBox.classList.add('hidden');
      return;
    }

    suggestionsBox.replaceChildren();
    const intro = document.createElement('p');
    intro.className = 'text-sm font-medium text-slate-800';
    intro.textContent =
      'This sounds similar to an open complaint. Supporting the existing one keeps support together instead of splitting it.';
    suggestionsBox.append(intro);

    for (const complaint of similar.slice(0, MAX_DUPLICATE_SUGGESTIONS)) {
      const row = document.createElement('div');
      row.className = 'flex flex-wrap items-center justify-between gap-2 text-sm';
      const info = document.createElement('p');
      info.className = 'text-slate-700';
      info.textContent =
        `Complaint ${complaint.id} · ${titleCase(complaint.category)} · ` +
        `${complaint.supportCount} ${complaint.supportCount === 1 ? 'support' : 'supports'}`;
      const instead = document.createElement('a');
      instead.href = `#/complaint/${encodeURIComponent(complaint.id)}`;
      instead.className =
        'rounded-md border border-primary bg-white px-3 py-2 text-sm font-medium text-primary hover:bg-primary-light';
      instead.textContent = 'Support this one instead';
      row.append(info, instead);
      suggestionsBox.append(row);
    }
    suggestionsBox.classList.remove('hidden');
  }

  let suggestionTimer: ReturnType<typeof setTimeout> | undefined;
  descriptionInput.addEventListener('input', () => {
    if (suggestionTimer !== undefined) {
      clearTimeout(suggestionTimer);
    }
    suggestionTimer = setTimeout(updateSuggestions, 600);
  });

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
  // Image stripping is asynchronous. Track every in-flight strip so submit
  // can wait for it instead of uploading the original file with metadata.
  const pendingStrips = new Set<Promise<void>>();

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
      const stripTask = prepareEvidenceFile(file)
        .then(({ file: strippedFile, stripped }) => {
          if (!items.includes(item)) {
            return;
          }
          item.file = strippedFile;
          if (
            stripped &&
            item.previewUrl !== null &&
            preview.element instanceof HTMLImageElement
          ) {
            URL.revokeObjectURL(item.previewUrl);
            item.previewUrl = URL.createObjectURL(strippedFile);
            preview.element.src = item.previewUrl;
          } else if (!stripped && !item.warning) {
            // stripImage can fail for a corrupt image. It stays attached, but
            // the student must acknowledge that its metadata was not removed.
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
        })
        .catch(() => {
          if (!items.includes(item)) {
            return;
          }
          if (!item.warning) {
            item.warning = true;
            const note = document.createElement('p');
            note.className = 'text-xs text-warning';
            note.textContent = 'Metadata could not be removed from this file.';
            info.append(note);
            updateEvidenceState();
          }
          detail.textContent = formatBytes(file.size);
        })
        .finally(() => {
          pendingStrips.delete(stripTask);
        });
      pendingStrips.add(stripTask);
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

  // Receipts are encrypted with the student secret, so this only succeeds
  // once the secret is unlocked; the form is still usable before that and the
  // server enforces the limit regardless.
  if (getStudentSecret() !== null) {
    void loadFilingReceipts()
      .then((receipts) => {
        const used = countFilingsInMonth(receipts);
        slotsLeft = Math.max(0, FILING_LIMIT_PER_MONTH - used);
        slotsInfo.textContent = `Filing slots left this month: ${slotsLeft}`;
        if (slotsLeft === 0) {
          submit.disabled = true;
          const limitNote = document.createElement('p');
          limitNote.className = 'text-xs text-warning';
          limitNote.textContent =
            'You have used both filing slots this month. You can support existing complaints instead.';
          form.append(limitNote);
        }
      })
      .catch(() => {
        // A storage failure must not block the form.
      });
  }

  const handleSubmit = async (): Promise<void> => {
    // A disabled submit button also blocks a second Enter-key submission while
    // image stripping is still running.
    if (submit.disabled) {
      return;
    }
    if (pendingStrips.size > 0) {
      submit.disabled = true;
      submit.textContent = 'Preparing images…';
      await Promise.all([...pendingStrips]);
      submit.textContent = 'Submit complaint';
      submit.disabled = slotsLeft === 0;
    }
    // One final comparison before the submit step continues (M059), so a
    // suggestion that arrived with the corpus load is never missed.
    updateSuggestions();
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

    // The pipeline takes over the screen; the form values are already
    // captured, so the form itself can go.
    form.remove();
    renderSubmissionFlow(section, input);
  };

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void handleSubmit();
  });

  updateEvidenceState();
  outlet.append(section);
}

// ---------------------------------------------------------------------------
// Submission flow (M060)
// ---------------------------------------------------------------------------

function createProgressList(): {
  element: HTMLElement;
  update: (progress: StepProgress) => void;
  reset: () => void;
} {
  const list = document.createElement('ol');
  list.className = 'flex flex-col gap-2';
  const statusLabels = new Map<SubmitStepId, HTMLElement>();
  const detailLabels = new Map<SubmitStepId, HTMLElement>();

  for (const step of SUBMIT_STEPS) {
    const row = document.createElement('li');
    row.className = 'flex items-baseline justify-between gap-3 text-sm';
    const label = document.createElement('span');
    label.className = 'text-slate-700';
    label.textContent = step.label;
    const detail = document.createElement('span');
    detail.className = 'text-xs text-slate-400';
    detail.textContent = '';
    const status = document.createElement('span');
    status.className = 'text-xs text-slate-400';
    status.textContent = 'waiting';
    row.append(label, detail, status);
    list.append(row);
    statusLabels.set(step.id, status);
    detailLabels.set(step.id, detail);
  }

  const apply = (progress: StepProgress): void => {
    const status = statusLabels.get(progress.id);
    const detail = detailLabels.get(progress.id);
    if (status === undefined || detail === undefined) {
      return;
    }
    if (progress.detail !== '') {
      detail.textContent = progress.detail;
    }
    if (progress.phase === 'active') {
      status.textContent = 'working…';
      status.className = 'text-xs text-primary';
    } else if (progress.phase === 'done') {
      status.textContent = 'done';
      status.className = 'text-xs text-success';
    } else if (progress.phase === 'failed') {
      status.textContent = 'failed';
      status.className = 'text-xs text-danger';
    } else {
      status.textContent = 'waiting';
      status.className = 'text-xs text-slate-400';
    }
  };

  return {
    element: list,
    update: apply,
    reset: () => {
      for (const step of SUBMIT_STEPS) {
        apply({ id: step.id, phase: 'pending', detail: '' });
        detailLabels.get(step.id)!.textContent = '';
      }
    },
  };
}

function renderSubmissionFlow(
  section: HTMLElement,
  input: FileComplaintInput,
): void {
  const area = document.createElement('div');
  area.className = 'flex flex-col gap-3';
  section.append(area);

  const heading = document.createElement('h3');
  heading.className = 'text-base font-semibold text-slate-900';
  heading.textContent = 'Submitting your complaint';
  const note = document.createElement('p');
  note.className = 'text-xs text-slate-500';
  note.textContent =
    'Your files are encrypted in this browser before anything is uploaded. The last step waits a random few seconds so the moment you press submit cannot be linked to your complaint.';
  const progress = createProgressList();
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  status.className = 'text-sm text-slate-600';
  area.append(heading, note, progress.element, status);

  let pipeline: SubmissionPipeline | null = null;
  let busy = false;

  const fail = (message: string, failedStep?: SubmitStepId): void => {
    status.className = 'text-sm text-danger';
    status.textContent = message;
    if (failedStep !== undefined) {
      progress.update({ id: failedStep, phase: 'failed', detail: '' });
    }
    const retry = button({
      label: 'Retry from the failed step',
      onClick: () => void attempt(),
    });
    area.append(retry);
    retry.focus();
  };  const attempt = async (): Promise<void> => {
    if (busy) {
      return;
    }
    busy = true;
    // Remove any retry button from a previous failed attempt.
    for (const child of Array.from(area.children)) {
      if (child instanceof HTMLButtonElement) {
        child.remove();
      }
    }
    progress.reset();
    status.className = 'text-sm text-slate-600';
    status.textContent = 'Working… you can leave this page open.';

    const universityId = getRememberedUniversity();
    if (universityId === null) {
      busy = false;
      fail('Enrol before filing a complaint.');
      return;
    }

    try {
      await ensureUnlocked(universityId);
    } catch (error) {
      busy = false;
      fail(
        error instanceof Error
          ? `Could not unlock your student secret: ${error.message}`
          : 'Could not unlock your student secret.',
      );
      return;
    }

    const secret = getStudentSecret();
    if (secret === null) {
      busy = false;
      fail('Student secret is not available.');
      return;
    }

    const getCredential = async () =>
      getCachedCredential() ?? (await refreshCredential(universityId));

    if (pipeline === null) {
      const submissionInput: SubmissionInput = {
        universityId,
        ...input,
      };
      pipeline = new SubmissionPipeline(
        submissionInput,
        secret,
        getCredential,
        { saveReceipt: (receipt) => saveFilingReceipt(receipt) },
      );
    }

    try {
      const { complaintId } = await pipeline.run(progress.update);
      progress.update({ id: 'receipt', phase: 'done', detail: '' });
      status.className = 'text-sm text-success';
      status.textContent = 'Submitted. Your complaint is now on record.';
      const success = document.createElement('div');
      success.className = 'rounded-md bg-success-light p-3 text-sm text-slate-700';
      const line = document.createElement('p');
      line.textContent =
        `Thank you. Your complaint ${complaintId} was filed with ` +
        `${input.evidenceFiles.length} evidence file(s) and starts at 0 supports. ` +
        'A receipt was saved in this browser only; clearing site data removes it.';
      const links = document.createElement('p');
      links.className = 'mt-1 flex flex-wrap gap-3';
      const link = document.createElement('a');
      link.href = `#/complaint/${encodeURIComponent(complaintId)}`;
      link.className = 'text-primary underline';
      link.textContent = 'View your complaint';
      const mine = document.createElement('a');
      mine.href = '#/my-complaints';
      mine.className = 'text-primary underline';
      mine.textContent = 'Open My complaints';
      links.append(link, mine);
      success.append(line, links);
      area.append(success);
      toast('Your complaint was submitted.', 'success');
    } catch (error) {
      if (error instanceof StepError) {
        // An offline failure gets the friendly offline wording; the retry
        // button then resumes without re-uploading anything.
        const message = isOfflineError(error.stepCause)
          ? OFFLINE_MESSAGE
          : `Step "${labelForStep(error.step)}" failed: ${error.message}`;
        fail(message, error.step);
      } else if (error instanceof FilingLimitError) {
        status.className = 'text-sm text-warning';
        status.textContent = error.message;
      } else {
        fail(friendlyError(error, 'Submission failed.'));
      }
    } finally {
      busy = false;
    }
  };

  void attempt();
}

function labelForStep(id: SubmitStepId): string {
  return SUBMIT_STEPS.find((step) => step.id === id)?.label ?? id;
}

export function formatFileSize(bytes: number): string {
  return `(${formatBytes(bytes)})`;
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1).replace('_', ' ');
}
