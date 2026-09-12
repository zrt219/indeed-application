import { Page } from 'playwright';
import { SiteAdapter, FillStepOptions, StepFillResult, StepAdvanceResult, ConfirmationResult } from './adapter.interface';
import { inspectForm } from '../browser/form-inspector';
import { matchAnswerBank, matchProfileFacts, answerQuestionWithPhi3 } from '../../llm/ollama';

export class GenericAdapter implements SiteAdapter {
  name = 'Generic ATS';

  canHandle(): boolean {
    return true; // Fallback for all other URLs
  }

  async startApplication(page: Page, jobUrl: string): Promise<{ success: boolean; error?: string }> {
    try {
      await page.goto(jobUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(1000);
      return { success: true };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return { success: false, error: `Failed to load page: ${errorMsg}` };
    }
  }

  async fillCurrentStep(page: Page, options: FillStepOptions): Promise<StepFillResult> {
    const inspection = await inspectForm(page);
    let filledFields = 0;
    const unansweredFields: { label: string; selector: string; reason?: string }[] = [];

    for (const field of inspection.fields) {
      if (field.currentValue && field.currentValue.length > 0 && field.type !== 'radio' && field.type !== 'checkbox') {
        continue;
      }

      // Resume upload
      if (field.type === 'file' && options.resumeFilePath) {
        try {
          const fileInput = await page.$(field.selector);
          if (fileInput) {
            await fileInput.setInputFiles(options.resumeFilePath);
            filledFields++;
            continue;
          }
        } catch {
          // Ignore
        }
      }

      // Answer bank
      const bankMatch = matchAnswerBank(field.label, options.answerBank);
      if (bankMatch && bankMatch.canAnswer && bankMatch.answer) {
        await this.fillFieldValue(page, field.selector, field.type, bankMatch.answer);
        filledFields++;
        continue;
      }

      // Profile facts
      const profileMatch = matchProfileFacts(field.label, options.profile);
      if (profileMatch && profileMatch.canAnswer && profileMatch.answer) {
        await this.fillFieldValue(page, field.selector, field.type, profileMatch.answer);
        filledFields++;
        continue;
      }

      // LLM fallback
      if (field.required) {
        const optionLabels = field.options?.map((o) => o.label || o.value) || [];
        const llmResult = await answerQuestionWithPhi3(field.label, optionLabels);

        if (llmResult.canAnswer && !llmResult.requiresManualReview && llmResult.answer) {
          await this.fillFieldValue(page, field.selector, field.type, llmResult.answer);
          filledFields++;
        } else {
          unansweredFields.push({
            label: field.label,
            selector: field.selector,
            reason: llmResult.refusalReason || 'Missing profile facts or confidence too low',
          });
        }
      }
    }

    const requiresManualReview = unansweredFields.length > 0;
    return {
      filledFields,
      unansweredFields,
      requiresManualReview,
      manualReviewReason: requiresManualReview
        ? `Questions require manual clarification: ${unansweredFields.map((f) => f.label).join(', ')}`
        : undefined,
    };
  }

  private async fillFieldValue(page: Page, selector: string, type: string, value: string): Promise<void> {
    try {
      const el = await page.$(selector);
      if (!el) return;

      if (type === 'select') {
        await el.selectOption({ label: value }).catch(async () => {
          await el.selectOption({ value: value });
        });
      } else if (type === 'radio') {
        const option = await page.$(`input[type="radio"][value="${value}"], label:has-text("${value}")`);
        if (option) await option.click();
      } else if (type === 'checkbox') {
        if (value.toLowerCase() === 'true' || value.toLowerCase() === 'yes') {
          await el.check();
        }
      } else {
        await el.fill('');
        await el.fill(value);
      }
    } catch {
      // Ignore
    }
  }

  async advanceStep(page: Page): Promise<StepAdvanceResult> {
    try {
      // Check for errors
      const errorEl = await page.$('[aria-invalid="true"], .field-error, .error');
      if (errorEl && (await errorEl.isVisible())) {
        const text = await errorEl.textContent();
        return { movedNext: false, isComplete: false, hasErrors: true, errorMessage: text || 'Validation error' };
      }

      // Check submit button
      const submitSelectors = [
        'button[type="submit"]',
        'input[type="submit"]',
        'button:has-text("Submit")',
        'button:has-text("Apply")',
      ];
      for (const sel of submitSelectors) {
        const btn = await page.$(sel);
        if (btn && (await btn.isVisible())) {
          await btn.click();
          await page.waitForTimeout(2500);
          return { movedNext: true, isComplete: true, hasErrors: false };
        }
      }

      // Check next button
      const nextSelectors = [
        'button:has-text("Next")',
        'button:has-text("Continue")',
        'button:has-text("Save and continue")',
      ];
      for (const sel of nextSelectors) {
        const btn = await page.$(sel);
        if (btn && (await btn.isVisible())) {
          await btn.click();
          await page.waitForTimeout(2000);
          return { movedNext: true, isComplete: false, hasErrors: false };
        }
      }

      return { movedNext: false, isComplete: false, hasErrors: false };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return { movedNext: false, isComplete: false, hasErrors: true, errorMessage: errorMsg };
    }
  }

  async checkConfirmation(page: Page): Promise<ConfirmationResult> {
    const confirmationTexts = [
      'thank you for your application',
      'application submitted',
      'we have received your application',
      'your application was successfully submitted',
      'successfully applied',
    ];

    try {
      const bodyText = (await page.textContent('body') || '').toLowerCase();
      for (const phrase of confirmationTexts) {
        if (bodyText.includes(phrase)) {
          return {
            isConfirmed: true,
            confirmationText: `Detected confirmation phrase: "${phrase}"`,
          };
        }
      }
    } catch {
      // Ignore
    }

    return { isConfirmed: false };
  }
}
