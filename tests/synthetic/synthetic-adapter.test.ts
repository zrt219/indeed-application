import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import { BrowserManager } from '../../src/engine/browser/browser';
import { GenericAdapter } from '../../src/engine/adapters/generic';
import { inspectForm } from '../../src/engine/browser/form-inspector';
import { loadDefaultProfile } from '../../src/qualification/engine';
import { loadAnswerBank } from '../../src/llm/ollama';

describe('Synthetic Form Automation (Playwright + Generic Adapter)', () => {
  let browserManager: BrowserManager;
  const formUrl = `file://${path.resolve(__dirname, 'form.html').replace(/\\/g, '/')}`;

  beforeAll(async () => {
    browserManager = new BrowserManager({ headless: true });
  });

  afterAll(async () => {
    await browserManager.close();
  });

  it('should inspect and classify all synthetic form fields', async () => {
    const page = await browserManager.newPage();
    try {
      await page.goto(formUrl);
      const inspection = await inspectForm(page);

      expect(inspection.fields.length).toBeGreaterThanOrEqual(6);
      expect(inspection.hasSubmitButton).toBe(true);

      const fieldTypes = inspection.fields.map((f) => f.type);
      expect(fieldTypes).toContain('text');
      expect(fieldTypes).toContain('email');
      expect(fieldTypes).toContain('tel');
      expect(fieldTypes).toContain('number');
      expect(fieldTypes).toContain('select');
      expect(fieldTypes).toContain('radio');
      expect(fieldTypes).toContain('file');
    } finally {
      await page.close();
    }
  });

  it('should fill form using GenericAdapter and achieve confirmed submission', async () => {
    const page = await browserManager.newPage();
    const adapter = new GenericAdapter();
    const profile = loadDefaultProfile();
    const answerBank = loadAnswerBank();
    const resumePath = path.resolve(process.cwd(), 'resumes', 'Alex_Rivera_Resume.pdf');

    try {
      await adapter.startApplication(page, formUrl);

      const fillResult = await adapter.fillCurrentStep(page, {
        profile,
        answerBank,
        resumeFilePath: resumePath,
      });

      expect(fillResult.filledFields).toBeGreaterThanOrEqual(4);

      const advanceResult = await adapter.advanceStep(page);
      expect(advanceResult.movedNext).toBe(true);

      const confirmation = await adapter.checkConfirmation(page);
      expect(confirmation.isConfirmed).toBe(true);
      expect(confirmation.confirmationText).toContain('application submitted');
    } finally {
      await page.close();
    }
  });
});
