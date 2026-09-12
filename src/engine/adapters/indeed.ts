import { Page } from 'playwright';
import { SiteAdapter, FillStepOptions, StepFillResult, StepAdvanceResult, ConfirmationResult } from './adapter.interface';
import { inspectForm } from '../browser/form-inspector';
import { matchAnswerBank, matchProfileFacts, answerQuestionWithPhi3 } from '../../llm/ollama';

export class IndeedAdapter implements SiteAdapter {
  name = 'Indeed';

  canHandle(url: string): boolean {
    return url.includes('indeed.com') || url.includes('indeed.apply');
  }

  async startApplication(page: Page, jobUrl: string): Promise<{ success: boolean; error?: string }> {
    try {
      await page.goto(jobUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(1500);

      // Check for Indeed Apply button selectors
      const applySelectors = [
        '#indeedApplyButton',
        'button[id*="indeedApply"]',
        'button:has-text("Apply now")',
        'button:has-text("Apply on company site")',
        'a:has-text("Apply now")',
        '[aria-label*="Apply now"]',
      ];

      for (const selector of applySelectors) {
        const button = await page.$(selector);
        if (button && (await button.isVisible())) {
          await button.click();
          await page.waitForTimeout(2000);
          return { success: true };
        }
      }

      // If no apply button found, maybe we are already on application page
      const currentUrl = page.url();
      if (currentUrl.includes('apply') || currentUrl.includes('post-apply')) {
        return { success: true };
      }

      return { success: false, error: 'Could not find Indeed Apply button on job page' };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return { success: false, error: `Failed to start Indeed application: ${errorMsg}` };
    }
  }

  async fillCurrentStep(page: Page, options: FillStepOptions): Promise<StepFillResult> {
    const inspection = await inspectForm(page);
    let filledFields = 0;
    const unansweredFields: { label: string; selector: string; reason?: string }[] = [];

    for (const field of inspection.fields) {
      if (field.currentValue && field.currentValue.length > 0 && field.type !== 'radio' && field.type !== 'checkbox') {
        // Field already populated
        continue;
      }

      // 1. File Upload (Resume)
      if (field.type === 'file' && options.resumeFilePath) {
        try {
          const fileInput = await page.$(field.selector);
          if (fileInput) {
            await fileInput.setInputFiles(options.resumeFilePath);
            filledFields++;
            continue;
          }
        } catch {
          // File input could be hidden/custom
        }
      }

      // 2. Check Answer Bank
      const bankMatch = matchAnswerBank(field.label, options.answerBank);
      if (bankMatch && bankMatch.canAnswer && bankMatch.answer) {
        await this.fillFieldValue(page, field.selector, field.type, bankMatch.answer);
        filledFields++;
        continue;
      }

      // 3. Check Candidate Profile Facts
      const profileMatch = matchProfileFacts(field.label, options.profile);
      if (profileMatch && profileMatch.canAnswer && profileMatch.answer) {
        await this.fillFieldValue(page, field.selector, field.type, profileMatch.answer);
        filledFields++;
        continue;
      }

      // 4. Try Ollama Phi-3 with strict guardrails
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
      // Ignore fill error gracefully
    }
  }

  async advanceStep(page: Page): Promise<StepAdvanceResult> {
    try {
      // Check for any field validation errors first
      const hasErrorElements = await page.$('.ia-FieldError, [aria-invalid="true"], .error-message');
      if (hasErrorElements && (await hasErrorElements.isVisible())) {
        const errorText = await hasErrorElements.textContent();
        return {
          movedNext: false,
          isComplete: false,
          hasErrors: true,
          errorMessage: errorText || 'Validation error present on form',
        };
      }

      // Check for submit buttons
      const submitSelectors = [
        'button:has-text("Submit your application")',
        'button:has-text("Submit application")',
        'button:has-text("Submit")',
        '#submit-button',
      ];

      for (const sel of submitSelectors) {
        const btn = await page.$(sel);
        if (btn && (await btn.isVisible())) {
          await btn.click();
          await page.waitForTimeout(3000);
          return { movedNext: true, isComplete: true, hasErrors: false };
        }
      }

      // Next / Continue buttons
      const nextSelectors = [
        'button:has-text("Continue")',
        'button:has-text("Next")',
        'button:has-text("Review your application")',
        'button:has-text("Save and continue")',
        'button.ia-continueButton',
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
      'application submitted',
      'your application has been submitted',
      'your application has been sent',
      'thank you for applying',
      'application received',
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
