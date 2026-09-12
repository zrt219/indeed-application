import { Page } from 'playwright';

export interface FormFieldDescription {
  id?: string;
  name?: string;
  type: 'text' | 'number' | 'email' | 'tel' | 'textarea' | 'select' | 'radio' | 'checkbox' | 'file' | 'unknown';
  label: string;
  required: boolean;
  options?: { value: string; label: string }[];
  currentValue?: string;
  selector: string;
}

export interface FormInspectionReport {
  fields: FormFieldDescription[];
  hasSubmitButton: boolean;
  hasNextButton: boolean;
  submitButtonSelector?: string;
  nextButtonSelector?: string;
  stepIndicator?: string;
}

export async function inspectForm(page: Page): Promise<FormInspectionReport> {
  return await page.evaluate(() => {
    const fields: FormFieldDescription[] = [];

    // Helper to find label for an element
    function findLabel(el: HTMLElement): string {
      // 1. label element with "for" matching id
      if (el.id) {
        const lbl = document.querySelector(`label[for="${el.id}"]`);
        if (lbl && lbl.textContent) return lbl.textContent.trim();
      }

      // 2. closest enclosing label
      const parentLabel = el.closest('label');
      if (parentLabel && parentLabel.textContent) {
        return parentLabel.textContent.trim();
      }

      // 3. aria-label or aria-labelledby
      if (el.getAttribute('aria-label')) {
        return el.getAttribute('aria-label')!.trim();
      }
      const labelledBy = el.getAttribute('aria-labelledby');
      if (labelledBy) {
        const refEl = document.getElementById(labelledBy);
        if (refEl && refEl.textContent) return refEl.textContent.trim();
      }

      // 4. preceding sibling or parent header/span
      const parent = el.parentElement;
      if (parent) {
        const prev = el.previousElementSibling;
        if (prev && prev.textContent && (prev.tagName === 'LABEL' || prev.tagName === 'SPAN' || prev.tagName === 'DIV')) {
          return prev.textContent.trim();
        }
      }

      return el.getAttribute('placeholder') || el.getAttribute('name') || el.id || 'Unknown Field';
    }

    // Inspect inputs
    const inputs = Array.from(document.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"])'));
    const processedRadioNames = new Set<string>();

    for (const input of inputs) {
      const el = input as HTMLInputElement;
      const type = (el.type || 'text').toLowerCase();
      const name = el.name || '';
      const id = el.id || '';

      if (type === 'radio') {
        if (name && processedRadioNames.has(name)) continue;
        if (name) processedRadioNames.add(name);

        const radios = Array.from(document.querySelectorAll(`input[type="radio"][name="${name}"]`)) as HTMLInputElement[];
        const radioOptions = radios.map((r) => ({
          value: r.value,
          label: findLabel(r),
        }));

        fields.push({
          id,
          name,
          type: 'radio',
          label: findLabel(el),
          required: el.required,
          options: radioOptions,
          currentValue: radios.find((r) => r.checked)?.value,
          selector: `input[type="radio"][name="${name}"]`,
        });
        continue;
      }

      let fieldType: FormFieldDescription['type'] = 'text';
      if (type === 'email') fieldType = 'email';
      else if (type === 'tel') fieldType = 'tel';
      else if (type === 'number') fieldType = 'number';
      else if (type === 'file') fieldType = 'file';
      else if (type === 'checkbox') fieldType = 'checkbox';

      const selector = id ? `#${id}` : (name ? `input[name="${name}"]` : `input[type="${type}"]`);

      fields.push({
        id,
        name,
        type: fieldType,
        label: findLabel(el),
        required: el.required || el.hasAttribute('aria-required'),
        currentValue: el.value,
        selector,
      });
    }

    // Inspect textareas
    const textareas = Array.from(document.querySelectorAll('textarea'));
    for (const ta of textareas) {
      const el = ta as HTMLTextAreaElement;
      const id = el.id || '';
      const name = el.name || '';
      const selector = id ? `#${id}` : (name ? `textarea[name="${name}"]` : 'textarea');

      fields.push({
        id,
        name,
        type: 'textarea',
        label: findLabel(el),
        required: el.required || el.hasAttribute('aria-required'),
        currentValue: el.value,
        selector,
      });
    }

    // Inspect select elements
    const selects = Array.from(document.querySelectorAll('select'));
    for (const sel of selects) {
      const el = sel as HTMLSelectElement;
      const id = el.id || '';
      const name = el.name || '';
      const options = Array.from(el.options).map((opt) => ({
        value: opt.value,
        label: opt.text.trim(),
      }));
      const selector = id ? `#${id}` : (name ? `select[name="${name}"]` : 'select');

      fields.push({
        id,
        name,
        type: 'select',
        label: findLabel(el),
        required: el.required || el.hasAttribute('aria-required'),
        options,
        currentValue: el.value,
        selector,
      });
    }

    // Buttons
    const buttons = Array.from(document.querySelectorAll('button, input[type="submit"], input[type="button"], a[role="button"]'));
    let hasSubmitButton = false;
    let hasNextButton = false;
    let submitButtonSelector: string | undefined;
    let nextButtonSelector: string | undefined;

    for (const btn of buttons) {
      const text = (btn.textContent || (btn as HTMLInputElement).value || '').toLowerCase().trim();
      if (text.includes('submit') || text.includes('apply now') || text.includes('review your application')) {
        hasSubmitButton = true;
        submitButtonSelector = btn.id ? `#${btn.id}` : undefined;
      } else if (text.includes('continue') || text.includes('next') || text.includes('save and continue')) {
        hasNextButton = true;
        nextButtonSelector = btn.id ? `#${btn.id}` : undefined;
      }
    }

    return {
      fields,
      hasSubmitButton,
      hasNextButton,
      submitButtonSelector,
      nextButtonSelector,
    };
  });
}
