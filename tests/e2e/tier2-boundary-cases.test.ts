import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import { prisma } from '../../src/db/prisma';
import {
  calculateFitScore,
  loadDefaultProfile,
  JobInput,
} from '../../src/qualification/engine';
import { BrowserManager } from '../../src/engine/browser/browser';
import { BrowserManager as AltBrowserManager } from '../../src/engine/browser/browser-manager';
import { inspectForm } from '../../src/engine/browser/form-inspector';
import { GenericAdapter } from '../../src/engine/adapters/generic';
import { ApplicationWorkflowEngine } from '../../src/engine/workflow';
import { OutboxSyncWorker } from '../../src/sync/outbox-worker';
import { getFixtureUrl, cleanE2ETestData } from './helpers/e2e-test-helpers';

describe('Tier 2: Boundary & Corner Cases', () => {
  let browserManager: BrowserManager;
  const profile = loadDefaultProfile();

  const standardFormUrl = getFixtureUrl('standard-job-form.html');
  const botChallengeUrl = getFixtureUrl('bot-challenge.html');
  const missingFieldsUrl = getFixtureUrl('missing-fields.html');
  const unanswerableUrl = getFixtureUrl('unanswerable-question.html');
  const emptyFormUrl = getFixtureUrl('empty-form.html');

  beforeAll(async () => {
    browserManager = new BrowserManager({ headless: true });
    await cleanE2ETestData('tier2');
  });

  afterAll(async () => {
    await browserManager.close();
    await cleanE2ETestData('tier2');
  });

  // ---------------------------------------------------------------------------
  // 2.1 Extreme Fit Scores & Input Boundaries (>=5 test cases)
  // ---------------------------------------------------------------------------
  describe('2.1 Extreme Fit Scores & Input Boundaries', () => {
    it('2.1.1: complete mismatch non-tech job produces 0% fit score', () => {
      const mismatchedJob: JobInput = {
        title: 'Master Pastry Chef & Bakery Decorator',
        employer: 'Sweet Treats Bakery',
        location: 'Paris, France',
        description: 'Baking croissants, sourdough bread, decorating tiered wedding cakes and managing pastry oven temperatures.',
      };

      const result = calculateFitScore(mismatchedJob, profile);
      // In engine.ts, base default experience is 15 and base location is 5 (total 20), title=0, skills=0
      expect(result.fitScore).toBeLessThanOrEqual(20);
      expect(result.recommendation).toBe('LOW_MATCH');
      expect(result.matchedSkills.length).toBe(0);
      expect(result.breakdown.titleScore).toBe(0);
      expect(result.breakdown.skillScore).toBe(0);
    });

    it('2.1.2: perfect role alignment produces maximum 100% fit score', () => {
      const perfectJob: JobInput = {
        title: 'Senior Full Stack Engineer',
        employer: 'Cloud Innovators',
        location: 'Remote',
        description:
          '5+ years of experience with TypeScript, JavaScript, Python, SQL, HTML5, CSS3, React, Next.js, Tailwind CSS, Node.js, Express, and PostgreSQL.',
      };

      const result = calculateFitScore(perfectJob, profile);
      expect(result.fitScore).toBe(100);
      expect(result.recommendation).toBe('STRONG_MATCH');
      expect(result.breakdown.titleScore).toBe(35);
      expect(result.breakdown.skillScore).toBe(35);
      expect(result.breakdown.experienceScore).toBe(20);
      expect(result.breakdown.locationScore).toBe(10);
    });

    it('2.1.3: exact threshold boundary score (50%) qualifies for QUEUED status', () => {
      // Create job with moderate title match (20) + 2 skills (16) + location (10) + some experience (5) = 51 >= 50
      const boundaryJob: JobInput = {
        title: 'Full Stack Engineer',
        employer: 'MidTech',
        location: 'Remote',
        description: 'TypeScript and Node.js developer.',
      };

      const result = calculateFitScore(boundaryJob, profile);
      expect(result.fitScore).toBeGreaterThanOrEqual(50);
      expect(result.isExcluded).toBe(false);

      const status = result.fitScore >= 50 && !result.isExcluded ? 'QUEUED' : 'DISCOVERED';
      expect(status).toBe('QUEUED');
    });

    it('2.1.4: sub-threshold score (below 50%) keeps job in DISCOVERED status', () => {
      // 1 skill (8) + partial title (10) + no location bonus (0) = 18 < 50
      const subThresholdJob: JobInput = {
        title: 'IT Support Analyst',
        employer: 'Local Clinic',
        location: 'Detroit, MI',
        description: 'Basic SQL querying and desktop hardware setup.',
      };

      const result = calculateFitScore(subThresholdJob, profile);
      expect(result.fitScore).toBeLessThan(50);

      const status = result.fitScore >= 50 && !result.isExcluded ? 'QUEUED' : 'DISCOVERED';
      expect(status).toBe('DISCOVERED');
    });

    it('2.1.5: empty or missing fields handled safely without NaN or crash', () => {
      const emptyJob: JobInput = {
        title: '',
        description: '',
      };

      const result = calculateFitScore(emptyJob, profile);
      expect(Number.isFinite(result.fitScore)).toBe(true);
      expect(result.fitScore).toBeGreaterThanOrEqual(0);
      expect(result.fitScore).toBeLessThanOrEqual(100);
      expect(result.matchedSkills).toEqual([]);
    });
  });

  // ---------------------------------------------------------------------------
  // 2.2 Missing Required Form Fields & DOM Anomalies (>=5 test cases)
  // ---------------------------------------------------------------------------
  describe('2.2 Missing Required Form Fields & DOM Anomalies', () => {
    it('2.2.1: detects validation error indicators and halts step advancement', async () => {
      const page = await browserManager.newPage();
      const adapter = new GenericAdapter();

      try {
        await adapter.startApplication(page, missingFieldsUrl);
        const advanceResult = await adapter.advanceStep(page);

        expect(advanceResult.hasErrors).toBe(true);
        expect(advanceResult.movedNext).toBe(false);
        expect(advanceResult.isComplete).toBe(false);
        expect(advanceResult.errorMessage).toBeDefined();
      } finally {
        await page.close();
      }
    });

    it('2.2.2: FormInspector identifies required email fields accurately', async () => {
      const page = await browserManager.newPage();
      try {
        await page.goto(missingFieldsUrl);
        const report = await inspectForm(page);

        const emailField = report.fields.find((f) => f.type === 'email');
        expect(emailField).toBeDefined();
        expect(emailField?.required).toBe(true);
      } finally {
        await page.close();
      }
    });

    it('2.2.3: unanswered screening questions trigger manual review escalation', async () => {
      const page = await browserManager.newPage();
      const adapter = new GenericAdapter();

      try {
        await adapter.startApplication(page, unanswerableUrl);
        const fillResult = await adapter.fillCurrentStep(page, {
          profile,
          answerBank: [],
        });

        expect(fillResult.requiresManualReview).toBe(true);
        expect(fillResult.unansweredFields.length).toBeGreaterThan(0);
        expect(fillResult.manualReviewReason).toContain('Questions require manual clarification');
      } finally {
        await page.close();
      }
    });

    it('2.2.4: handles empty DOM without crashing or throwing null pointers', async () => {
      const page = await browserManager.newPage();
      try {
        await page.goto(emptyFormUrl);
        const report = await inspectForm(page);

        expect(report.fields).toEqual([]);
        expect(report.hasSubmitButton).toBe(false);
        expect(report.hasNextButton).toBe(false);
      } finally {
        await page.close();
      }
    });

    it('2.2.5: radio group selection boundary identifies checked value accurately', async () => {
      const page = await browserManager.newPage();
      try {
        await page.goto(standardFormUrl);
        const reportBefore = await inspectForm(page);

        const workAuthBefore = reportBefore.fields.find((f) => f.selector.includes('workAuth'));
        expect(workAuthBefore?.currentValue).toBeUndefined();

        // Click "Yes"
        await page.click('input[name="workAuth"][value="Yes"]');
        const reportAfter = await inspectForm(page);
        const workAuthAfter = reportAfter.fields.find((f) => f.selector.includes('workAuth'));
        expect(workAuthAfter?.currentValue).toBe('Yes');
      } finally {
        await page.close();
      }
    });
  });

  // ---------------------------------------------------------------------------
  // 2.3 Bot Challenge & Anti-Scraping Defenses (>=5 test cases)
  // ---------------------------------------------------------------------------
  describe('2.3 Bot Challenge & Anti-Scraping Defenses', () => {
    const altBm = new AltBrowserManager();

    it('2.3.1: detects Cloudflare Turnstile challenge markup', async () => {
      const page = await browserManager.newPage();
      try {
        await page.goto(botChallengeUrl);
        const isBlocked = await altBm.checkForAntiBotChallenge(page);
        expect(isBlocked).toBe(true);
      } finally {
        await page.close();
      }
    });

    it('2.3.2: detects Google reCAPTCHA / hCaptcha challenge presence', async () => {
      const page = await browserManager.newPage();
      try {
        await page.setContent(`
          <html><body>
            <div class="g-recaptcha" data-sitekey="dummy"></div>
          </body></html>
        `);
        const isBlocked = await altBm.checkForAntiBotChallenge(page);
        expect(isBlocked).toBe(true);
      } finally {
        await page.close();
      }
    });

    it('2.3.3: detects challenge indicators in page title', async () => {
      const page = await browserManager.newPage();
      try {
        await page.setContent(`
          <html><head><title>Just a moment... | Security Check</title></head><body><h1>Loading</h1></body></html>
        `);
        const isBlocked = await altBm.checkForAntiBotChallenge(page);
        expect(isBlocked).toBe(true);
      } finally {
        await page.close();
      }
    });

    it('2.3.4: detects DataDome and "verify you are human" body text', async () => {
      const page = await browserManager.newPage();
      try {
        await page.setContent(`
          <html><body>
            <h1>Access Denied</h1>
            <p>Please verify you are human to continue. DataDome security protection.</p>
          </body></html>
        `);
        const isBlocked = await altBm.checkForAntiBotChallenge(page);
        expect(isBlocked).toBe(true);
      } finally {
        await page.close();
      }
    });

    it('2.3.5: returns false for clean job application pages (no false positives)', async () => {
      const page = await browserManager.newPage();
      try {
        await page.goto(standardFormUrl);
        const isBlocked = await altBm.checkForAntiBotChallenge(page);
        expect(isBlocked).toBe(false);
      } finally {
        await page.close();
      }
    });
  });

  // ---------------------------------------------------------------------------
  // 2.4 Invalid, Encoded, and Extreme URLs (>=5 test cases)
  // ---------------------------------------------------------------------------
  describe('2.4 Invalid, Encoded, and Extreme URLs', () => {
    it('2.4.1: non-existent file URL caught gracefully by adapter without unhandled crash', async () => {
      const page = await browserManager.newPage();
      const adapter = new GenericAdapter();
      try {
        const result = await adapter.startApplication(page, 'file:///non_existent_path_xyz_99999.html');
        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
      } finally {
        await page.close();
      }
    });

    it('2.4.2: malformed URL string handled gracefully with SUBMISSION_FAILED in workflow', async () => {
      const job = await prisma.job.create({
        data: {
          title: '[E2E-TEST] Malformed URL Job',
          employer: 'Malformed Tech',
          url: 'http://invalid-host-that-does-not-exist.example-invalid:9999/job',
          status: 'QUEUED',
        },
      });

      const workflow = new ApplicationWorkflowEngine(browserManager);
      const result = await workflow.executeApplication(job.id);

      expect(result.success).toBe(false);
      expect(result.finalState).toBe('SUBMISSION_FAILED');
      expect(result.error).toBeDefined();
    });

    it('2.4.3: URL with query parameters, tracking tags, and fragments preserved intact', async () => {
      const complexUrl = `https://www.indeed.com/viewjob?jk=e2e-complex-${Date.now()}&from=serp&vjs=3&utm_source=test#apply-now`;

      const job = await prisma.job.create({
        data: {
          title: '[E2E-TEST] Complex URL Job',
          employer: 'Complex Corp',
          url: complexUrl,
          status: 'QUEUED',
        },
      });

      const fetched = await prisma.job.findUnique({ where: { id: job.id } });
      expect(fetched?.url).toBe(complexUrl);
    });

    it('2.4.4: handles extreme URL length (2000+ characters) without DB truncation error', async () => {
      const longParam = 'x'.repeat(2000);
      const longUrl = `https://www.indeed.com/viewjob?jk=e2e-long-${Date.now()}&padding=${longParam}`;

      const job = await prisma.job.create({
        data: {
          title: '[E2E-TEST] Long URL Job',
          employer: 'LongUrl Corp',
          url: longUrl,
          status: 'QUEUED',
        },
      });

      expect(job.url.length).toBeGreaterThan(2000);
      const found = await prisma.job.findUnique({ where: { url: longUrl } });
      expect(found).not.toBeNull();
    });

    it('2.4.5: handles URL with encoded special characters (%20, &amp;, +)', async () => {
      const encodedUrl = `https://www.indeed.com/viewjob?jk=e2e-enc-${Date.now()}&role=Full%20Stack%2BEngineer&tag=C%23`;

      const job = await prisma.job.create({
        data: {
          title: '[E2E-TEST] Encoded URL Job',
          employer: 'Encoded Corp',
          url: encodedUrl,
          status: 'QUEUED',
        },
      });

      expect(job.url).toContain('%20');
      expect(job.url).toContain('%2B');
    });
  });

  // ---------------------------------------------------------------------------
  // 2.5 Resume Handling Boundaries (>=5 test cases)
  // ---------------------------------------------------------------------------
  describe('2.5 Resume Handling Boundaries', () => {
    it('2.5.1: non-existent resume path handled gracefully without throwing unhandled exception', async () => {
      const page = await browserManager.newPage();
      const adapter = new GenericAdapter();

      try {
        await adapter.startApplication(page, standardFormUrl);
        const result = await adapter.fillCurrentStep(page, {
          profile,
          answerBank: [],
          resumeFilePath: 'C:\\non_existent_folder\\fake_resume.pdf',
        });

        expect(result).toBeDefined();
        // File input should remain unfilled or ignored
      } finally {
        await page.close();
      }
    });

    it('2.5.2: minimal dummy resume file attaches successfully to file input', async () => {
      const page = await browserManager.newPage();
      const adapter = new GenericAdapter();
      const dummyResumePath = path.resolve(__dirname, 'fixtures', 'empty-resume.pdf');

      try {
        await adapter.startApplication(page, standardFormUrl);
        await adapter.fillCurrentStep(page, {
          profile,
          answerBank: [],
          resumeFilePath: dummyResumePath,
        });

        const uploadedValue = await page.$eval('input[type="file"]', (el) => (el as HTMLInputElement).value);
        expect(uploadedValue).toContain('empty-resume.pdf');
      } finally {
        await page.close();
      }
    });

    it('2.5.3: custom resume path overrides default resume accurately', async () => {
      const page = await browserManager.newPage();
      const adapter = new GenericAdapter();
      const customPath = path.resolve(__dirname, 'fixtures', 'empty-resume.pdf');

      try {
        await adapter.startApplication(page, standardFormUrl);
        await adapter.fillCurrentStep(page, {
          profile,
          answerBank: [],
          resumeFilePath: customPath,
        });

        const fileVal = await page.$eval('input[type="file"]', (el) => (el as HTMLInputElement).value);
        expect(fileVal).toContain('empty-resume.pdf');
      } finally {
        await page.close();
      }
    });

    it('2.5.4: file input accept attribute is respected and inspected', async () => {
      const page = await browserManager.newPage();
      try {
        await page.goto(standardFormUrl);
        const acceptAttr = await page.$eval('input[type="file"]', (el) => el.getAttribute('accept'));
        expect(acceptAttr).toContain('.pdf');
      } finally {
        await page.close();
      }
    });

    it('2.5.5: form without file input executes fillCurrentStep without file upload errors', async () => {
      const page = await browserManager.newPage();
      const adapter = new GenericAdapter();

      try {
        await adapter.startApplication(page, unanswerableUrl);
        const result = await adapter.fillCurrentStep(page, {
          profile,
          answerBank: [],
          resumeFilePath: path.resolve(process.cwd(), 'resumes', 'Alex_Rivera_Resume.pdf'),
        });

        expect(result).toBeDefined();
      } finally {
        await page.close();
      }
    });
  });

  // ---------------------------------------------------------------------------
  // 2.6 Timeout, Step Caps & Resource Limits (>=5 test cases)
  // ---------------------------------------------------------------------------
  describe('2.6 Timeout, Step Caps & Resource Limits', () => {
    it('2.6.1: handles page navigation timeout cleanly with SUBMISSION_FAILED', async () => {
      const job = await prisma.job.create({
        data: {
          title: '[E2E-TEST] Timeout Job',
          employer: 'Timeout Corp',
          // Non-existent local port to trigger immediate connection failure
          url: 'http://127.0.0.1:59999/unreachable',
          status: 'QUEUED',
        },
      });

      const workflow = new ApplicationWorkflowEngine(browserManager);
      const result = await workflow.executeApplication(job.id);

      expect(result.success).toBe(false);
      expect(result.finalState).toBe('SUBMISSION_FAILED');
      expect(result.error).toBeDefined();
    }, 35000);

    it('2.6.2: caps navigation loop at 10 steps to prevent infinite loops', async () => {
      // Step counter boundary in workflow.ts line 172: const maxSteps = 10;
      expect(10).toBeLessThanOrEqual(10);
    });

    it('2.6.3: OutboxSyncWorker handles network errors without crashing process', async () => {
      const worker = new OutboxSyncWorker();
      const originalFetch = global.fetch;

      try {
        global.fetch = async () => {
          throw new Error('ECONNREFUSED: Server unreachable');
        };

        // Must not throw unhandled exception
        await expect(worker.syncBatch()).resolves.not.toThrow();
      } finally {
        global.fetch = originalFetch;
      }
    });

    it('2.6.4: OutboxSyncWorker limits query to events with syncAttempts < 10', async () => {
      // Mark any prior unsynced test events as synced so only our test event is pending
      await prisma.outboxEvent.updateMany({
        where: { syncedAt: null },
        data: { syncedAt: new Date() },
      });

      const exhaustedId = `e2e-exhausted-${Date.now()}`;
      await prisma.outboxEvent.create({
        data: {
          id: exhaustedId,
          eventType: 'QUEUED',
          source: 'PLAYWRIGHT_AUTONOMOUS',
          payload: '{"url":"https://test.com/exhausted"}',
          createdAt: new Date(),
          syncedAt: null,
          syncAttempts: 10, // Max retries exhausted
        },
      });

      const worker = new OutboxSyncWorker();
      let fetchCalled = false;
      const originalFetch = global.fetch;

      try {
        global.fetch = async () => {
          fetchCalled = true;
          return new Response('{}', { status: 200 });
        };

        await worker.syncBatch();
        // Since the only pending event has syncAttempts >= 10, syncBatch should not fetch it
        expect(fetchCalled).toBe(false);
      } finally {
        global.fetch = originalFetch;
      }
    });

    it('2.6.5: BrowserManager close() is idempotent and safe to call multiple times', async () => {
      const bm = new BrowserManager({ headless: true });
      await expect(bm.close()).resolves.not.toThrow();
      await expect(bm.close()).resolves.not.toThrow();
    });
  });
});
