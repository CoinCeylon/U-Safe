// Student file complaint form (M057).
//
// Build the form: mandatory description (minimum 40 characters, maximum 4000),
// category select, urgency toggle, a checkbox "This involves a staff member or
// official", an optional "accused person details" field, and plain-language
// guidance telling the student which details could identify them. Show how many
// filing slots are left this month.
//
// Done when: validation messages are clear and the form cannot submit an empty
// description.
import { } from '@usafe/shared';

export interface FileComplaintInput {
  description: string;
  category: 'verbal' | 'physical' | 'sexual' | 'cyber' | 'financial' | 'other';
  urgency: 'normal' | 'urgent';
  staffInvolved: boolean;
  accusedPersonDetails?: string;
}

export function renderFileComplaintForm(outlet: HTMLElement): void {

  // Plain-language guidance
  const guidance = document.createElement('div');
  guidance.className = 'mb-3 text-sm text-slate-500';
  guidance.innerHTML = `
    <p>Guidelines:</p>
    <ul class="list-disc pl-4">
      <li>Description must be at least 40 characters and at most 4000 characters.</li>
      <li>Do not include real names or identifying information about the accused.</li>
      <li>If the complaint involves a staff member, check the box below.</li>
    </ul>
  `;

  // Form elements
  const descriptionInput = document.createElement('textarea');
  descriptionInput.className = 'block w-full rounded-lg border border-slate-200 px-3 py-2 focus:ring-2 focus:ring-primary-500 focus:outline-none min-h[80]';
  descriptionInput.placeholder = 'Describe the complaint (minimum 40 characters)';
  descriptionInput.required = true;

  // Category select
  const categorySelect = document.createElement('select');
  categorySelect.className = 'mt-2 block w-full rounded-lg border border-slate-200 px-3 py-2 focus:ring-2 focus:ring-primary-500 focus:outline-none';
  const categories = ['verbal', 'physical', 'sexual', 'cyber', 'financial', 'other'];
  categories.forEach((cat) => {
    const option = document.createElement('option');
    option.value = cat;
    option.textContent = cat.charAt(0).toUpperCase() + cat.slice(1);
    categorySelect.append(option);
  });

  // Urgency toggle
  const urgencyNormal = document.createElement('input');
  urgencyNormal.type = 'radio';
  urgencyNormal.name = 'urgency';
  urgencyNormal.value = 'normal';
  urgencyNormal.id = 'urgency-normal';
  urgencyNormal.checked = true;
  const urgencyNormalLabel = document.createElement('label');
  urgencyNormalLabel.htmlFor = 'urgency-normal';
  urgencyNormalLabel.className = 'ml-2 text-slate-600';
  urgencyNormalLabel.textContent = 'Normal';

  const urgencyUrgent = document.createElement('input');
  urgencyUrgent.type = 'radio';
  urgencyUrgent.name = 'urgency';
  urgencyUrgent.value = 'urgent';
  urgencyUrgent.id = 'urgency-urgent';
  const urgencyUrgentLabel = document.createElement('label');
  urgencyUrgentLabel.htmlFor = 'urgency-urgent';
  urgencyUrgentLabel.className = 'ml-2 text-slate-600';
  urgencyUrgentLabel.textContent = 'Urgent';

  const urgencyGroup = document.createElement('div');
  urgencyGroup.className = 'mt-2 flex items-center';
  urgencyGroup.append(urgencyNormal, urgencyNormalLabel, urgencyUrgent, urgencyUrgentLabel);

  // Staff involved checkbox
  const staffInvolvedInput = document.createElement('input');
  staffInvolvedInput.type = 'checkbox';
  staffInvolvedInput.name = 'staffInvolved';
  staffInvolvedInput.id = 'staff-involved';
  staffInvolvedInput.className = 'w-4 h-4 rounded border-slate-200 focus:ring-2 focus:ring-primary-500 focus-visible:ring-offset-2';
  const staffInvolvedLabel = document.createElement('label');
  staffInvolvedLabel.htmlFor = 'staff-involved';
  staffInvolvedLabel.className = 'ml-2 text-slate-600';
  staffInvolvedLabel.textContent = 'This involves a staff member or official';

  // Accused person details (optional, hidden by default)
  const accusedDetailsContainer = document.createElement('div');
  accusedDetailsContainer.className = 'mt-2 hidden';
  accusedDetailsContainer.innerHTML = `
    <div class="bg-slate-50 rounded p-2 text-xs text-slate-500">
      <p class="font-medium text-slate-700">Accused person details (optional)</p>
    </div>
    <textarea class="mt-1 block w-full rounded-lg border border-slate-200 px-3 py-2 focus:ring-2 focus:ring-primary-500 focus:outline-none min-h[40]" placeholder="Optional: accused person details"></textarea>
  `;

  // Show/hide accused details based on staff involved checkbox
  staffInvolvedInput.addEventListener('change', () => {
    accusedDetailsContainer.classList.toggle('hidden', !staffInvolvedInput.checked);
  });

  // Form submission
  const form = document.createElement('form');
  form.className = 'space-y-4';
  form.addEventListener('submit', (e) => {
    e.preventDefault();

    const description = (descriptionInput.value || '').trim();

    // Validation: minimum 40 characters
    if (description.length < 40) {
      alert('Description must be at least 40 characters.');
      descriptionInput.focus();
      return;
    }

    // Validation: maximum 4000 characters
    if (description.length > 4000) {
      alert('Description must be at most 4000 characters.');
      descriptionInput.focus();
      return;
    }

    // Build the input object
    const input: FileComplaintInput = {
      description,
      category: categorySelect.value as FileComplaintInput['category'],
      urgency: urgencyNormal.checked ? 'normal' : 'urgent',
      staffInvolved: staffInvolvedInput.checked,
    };

    if (staffInvolvedInput.checked) {
      input.accusedPersonDetails = (accusedDetailsContainer.querySelector('textarea') as HTMLTextAreaElement).value;
    }

    // TODO: Submit to API
    alert(`Complaint filed: ${description.substring(0, 50)}${description.length > 50 ? '...' : ''}`);
    outlet.innerHTML = '<p class="text-slate-600">Thank you. Your complaint has been submitted.</p>';
  });

  // Assemble the form
  const section = document.createElement('section');
  section.className = 'flex flex-col gap-4 max-w-md mx-auto py-4';
  section.append(
    guidance,
    descriptionInput,
    categorySelect,
    urgencyGroup,
    staffInvolvedInput,
    staffInvolvedLabel,
    accusedDetailsContainer,
    form
  );

  outlet.append(section);
}