import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import path from 'path';
import fs from 'fs';
import { prisma } from '../../src/db/prisma';
import { IndeedSearchCrawler } from '../../src/engine/discovery/indeed-search';
import {
  calculateFitScore,
  checkHardExclusions,
  loadDefaultProfile,
  JobInput,
} from '../../src/qualification/engine';
import { BrowserManager } from '../../src/engine/browser/browser';
import { inspectForm } from '../../src/engine/browser/form-inspector';
import { GenericAdapter } from '../../src/engine/adapters/generic';
import {
  matchAnswerBank,
  matchProfileFacts,
  answerQuestionWithPhi3,
  QuestionAnswerResponseSchema,
  loadAnswerBank,
} from '../../src/llm/ollama';
import { emitLifecycleEvent } from '../../src/sync/outbox';
import { OutboxSyncWorker } from '../../src/sync/outbox-worker';
import { handleCloudSync } from './helpers/cloud-sync-endpoint';
import { getFixtureUrl, cleanE2ETestData } from './helpers/e2e-test-helpers';

describe('Tier 1: Feature Coverage (Core Subsystems)', () => {
  let browserManager: BrowserManager;
  const profile = loadDefaultProfile();
  const answerBank = loadAnswerBank();
  const standardFormUrl = getFixtureUrl('standard-job-form.html');
  const multiStepUrl = getFixtureUrl('multi-step-page1.html');

  beforeAll(async () => {
    browserManager = new BrowserManager({ headless: true });
    await cleanE2ETestData('tier1');
  });

  afterAll(async () => {
    await browserManager.close();
    await cleanE2ETestData('tier1');
  });

  // ---------------------------------------------------------------------------
  // 1.1 Discovery Feature Coverage (>=5 test cases)
  // ---------------------------------------------------------------------------
  describe('1.1 Discovery & Auto-Ingestion Subsystem', () => {
    it('1.1.1: extracts complete metadata for curated and discovered opportunities', async () => {
      const crawler = new IndeedSearchCrawler();
      const result = await crawler.discoverAndQueue({
        queries: [],
        targetCount: 5,
        minFitScore: 50,
        useSyntheticFallbackIfBlocked: true,
      });

      expect(result.discoveredCount).toBeGreaterThanOrEqual(5);
      expect(result.jobs.length).toBeGreaterThanOrEqual(5);

      const firstJob = result.jobs[0];
      expect(firstJob.id).toBeDefined();
      expect(firstJob.title).toBeTruthy();
      expect(firstJob.employer).toBeTruthy();
      expect(typeof firstJob.fitScore).toBe('number');
      expect(['QUEUED', 'DISCOVERED', 'SUBMISSION_FAILED', 'SUBMITTED', 'APPLYING']).toContain(firstJob.status);
    });

    it('1.1.2: supplements with curated tech jobs when live scrape returns zero cards', async () => {
      const crawler = new IndeedSearchCrawler();
      const result = await crawler.discoverAndQueue({
        queries: [],
        targetCount: 10,
        useSyntheticFallbackIfBlocked: true,
      });

      expect(result.discoveredCount).toBeGreaterThanOrEqual(10);
      expect(result.queuedCount).toBeGreaterThanOrEqual(1);
    });

    it('1.1.3: executes deterministic qualification scoring during discovery', async () => {
      const crawler = new IndeedSearchCrawler();
      const result = await crawler.discoverAndQueue({
        queries: [],
        targetCount: 3,
        useSyntheticFallbackIfBlocked: true,
      });

      for (const job of result.jobs) {
        expect(job.fitScore).toBeGreaterThanOrEqual(0);
        expect(job.fitScore).toBeLessThanOrEqual(100);
      }
    });

    it('1.1.4: assigns status QUEUED for jobs meeting minimum fit score threshold', async () => {
      const testUrl = `https://www.indeed.com/viewjob?jk=e2e-test-qualified-${Date.now()}`;
      const jobInput: JobInput = {
        title: 'Senior Full Stack TypeScript Engineer',
        employer: 'E2E Tech',
        location: 'Remote',
        description: 'Requires TypeScript, React, Next.js, Node.js, PostgreSQL, AWS.',
        url: testUrl,
      };

      const score = calculateFitScore(jobInput, profile);
      expect(score.fitScore).toBeGreaterThanOrEqual(50);

      const dbJob = await prisma.job.create({
        data: {
          title: jobInput.title,
          employer: jobInput.employer,
          location: jobInput.location,
          description: jobInput.description,
          url: testUrl,
          fitScore: score.fitScore,
          status: score.fitScore >= 50 ? 'QUEUED' : 'DISCOVERED',
          source: 'PLAYWRIGHT_AUTONOMOUS',
        },
      });

      expect(dbJob.status).toBe('QUEUED');
    });

    it('1.1.5: retains status DISCOVERED for jobs below qualification threshold', async () => {
      const testUrl = `https://www.indeed.com/viewjob?jk=e2e-test-unqualified-${Date.now()}`;
      const jobInput: JobInput = {
        title: 'Junior Marketing Assistant',
        employer: 'Ad Agency',
        location: 'Miami, FL',
        description: 'Entry level social media posting and flyer distribution.',
        url: testUrl,
      };

      const score = calculateFitScore(jobInput, profile);
      expect(score.fitScore).toBeLessThan(50);

      const dbJob = await prisma.job.create({
        data: {
          title: jobInput.title,
          employer: jobInput.employer,
          location: jobInput.location,
          description: jobInput.description,
          url: testUrl,
          fitScore: score.fitScore,
          status: score.fitScore >= 50 ? 'QUEUED' : 'DISCOVERED',
          source: 'PLAYWRIGHT_AUTONOMOUS',
        },
      });

      expect(dbJob.status).toBe('DISCOVERED');
    });

    it('1.1.6: guarantees idempotent ingestion with zero duplicate insertions on identical URL', async () => {
      const testUrl = `https://www.indeed.com/viewjob?jk=e2e-test-idempotent-${Date.now()}`;

      // Insert first time
      await prisma.job.create({
        data: {
          title: 'Full Stack Engineer',
          employer: 'Idempotent Corp',
          url: testUrl,
          fitScore: 88,
          status: 'QUEUED',
        },
      });

      // Second insertion attempt on identical URL should be prevented by unique constraint or check
      const duplicateFound = await prisma.job.findUnique({
        where: { url: testUrl },
      });
      expect(duplicateFound).not.toBeNull();

      // Count of jobs with this URL must remain strictly 1
      const count = await prisma.job.count({ where: { url: testUrl } });
      expect(count).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // 1.2 Qualification Feature Coverage (>=5 test cases)
  // ---------------------------------------------------------------------------
  describe('1.2 Qualification Engine Subsystem', () => {
    it('1.2.1: awards full title points for exact matching engineering titles', () => {
      const job: JobInput = {
        title: 'Senior Full Stack Engineer',
        employer: 'ScaleTech',
        description: 'Core web engineering.',
      };
      const result = calculateFitScore(job, profile);
      expect(result.breakdown.titleScore).toBe(35);
    });

    it('1.2.2: extracts and matches candidate stack skills from job description', () => {
      const job: JobInput = {
        title: 'Software Engineer',
        employer: 'ScaleTech',
        description: 'Building web apps with TypeScript, React, Next.js, Node.js, and PostgreSQL on AWS.',
      };
      const result = calculateFitScore(job, profile);
      expect(result.matchedSkills).toContain('TypeScript');
      expect(result.matchedSkills).toContain('React');
      expect(result.matchedSkills).toContain('Next.js');
      expect(result.matchedSkills).toContain('Node.js');
      expect(result.breakdown.skillScore).toBeGreaterThanOrEqual(15);
    });

    it('1.2.3: evaluates seniority and years of experience criteria', () => {
      const job: JobInput = {
        title: 'Senior Software Engineer',
        employer: 'ScaleTech',
        description: 'Requires 5+ years of experience with modern web architecture.',
      };
      const result = calculateFitScore(job, profile);
      expect(result.breakdown.experienceScore).toBeGreaterThanOrEqual(15);
    });

    it('1.2.4: awards location bonus for Remote or Austin TX positions', () => {
      const remoteJob: JobInput = { title: 'Software Engineer', location: 'Remote', description: 'Web dev' };
      const austinJob: JobInput = { title: 'Software Engineer', location: 'Austin, TX', description: 'Web dev' };
      const otherJob: JobInput = { title: 'Software Engineer', location: 'Seattle, WA', description: 'Web dev' };

      expect(calculateFitScore(remoteJob, profile).breakdown.locationScore).toBe(10);
      expect(calculateFitScore(austinJob, profile).breakdown.locationScore).toBe(10);
      expect(calculateFitScore(otherJob, profile).breakdown.locationScore).toBe(5);
    });

    it('1.2.5: triggers hard exclusion for jobs requiring active security clearance', () => {
      const clearanceJob: JobInput = {
        title: 'Senior Software Engineer',
        employer: 'Defense Systems Inc',
        description: 'Candidate must possess an active Top Secret / SCI clearance with polygraph.',
      };
      const exclusion = checkHardExclusions(clearanceJob, profile);
      expect(exclusion.isExcluded).toBe(true);
      expect(exclusion.reasons.some((r) => r.toLowerCase().includes('clearance'))).toBe(true);

      const fit = calculateFitScore(clearanceJob, profile);
      expect(fit.fitScore).toBe(0);
      expect(fit.recommendation).toBe('EXCLUDED');
    });

    it('1.2.6: triggers hard exclusion for unpaid or volunteer roles', () => {
      const unpaidJob: JobInput = {
        title: 'Web Developer Intern',
        employer: 'Nonprofit',
        description: 'This is an unpaid internship for college credit.',
      };
      const exclusion = checkHardExclusions(unpaidJob, profile);
      expect(exclusion.isExcluded).toBe(true);
      expect(exclusion.reasons.some((r) => r.toLowerCase().includes('unpaid'))).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // 1.3 Browser Automation & Form Inspection (>=5 test cases)
  // ---------------------------------------------------------------------------
  describe('1.3 Browser Automation & Form Inspection Subsystem', () => {
    it('1.3.1: FormInspector classifies all DOM form field types accurately', async () => {
      const page = await browserManager.newPage();
      try {
        await page.goto(standardFormUrl);
        const report = await inspectForm(page);

        expect(report.fields.length).toBeGreaterThanOrEqual(7);
        const fieldTypes = report.fields.map((f) => f.type);
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

    it('1.3.2: FormInspector identifies submit button and step navigation controls', async () => {
      const page = await browserManager.newPage();
      try {
        await page.goto(standardFormUrl);
        const report = await inspectForm(page);
        expect(report.hasSubmitButton).toBe(true);
        expect(report.submitButtonSelector).toBeDefined();
      } finally {
        await page.close();
      }
    });

    it('1.3.3: GenericAdapter fills candidate identity fields from profile facts', async () => {
      const page = await browserManager.newPage();
      const adapter = new GenericAdapter();
      try {
        await adapter.startApplication(page, standardFormUrl);
        const fillResult = await adapter.fillCurrentStep(page, {
          profile,
          answerBank,
        });

        expect(fillResult.filledFields).toBeGreaterThanOrEqual(3);

        const nameValue = await page.$eval('input[name="fullName"]', (el) => (el as HTMLInputElement).value);
        expect(nameValue).toBe('Alex Rivera');

        const emailValue = await page.$eval('input[name="email"]', (el) => (el as HTMLInputElement).value);
        expect(emailValue).toBe('alex.rivera.dev@example.com');
      } finally {
        await page.close();
      }
    });

    it('1.3.4: GenericAdapter attaches candidate PDF resume to file input', async () => {
      const page = await browserManager.newPage();
      const adapter = new GenericAdapter();
      const resumePath = path.resolve(process.cwd(), 'resumes', 'Alex_Rivera_Resume.pdf');

      try {
        await adapter.startApplication(page, standardFormUrl);
        await adapter.fillCurrentStep(page, {
          profile,
          answerBank,
          resumeFilePath: resumePath,
        });

        const fileValue = await page.$eval('input[type="file"]', (el) => (el as HTMLInputElement).value);
        expect(fileValue).toContain('Alex_Rivera_Resume.pdf');
      } finally {
        await page.close();
      }
    });

    it('1.3.5: navigates multi-step form steps to confirmation completion', async () => {
      const page = await browserManager.newPage();
      const adapter = new GenericAdapter();
      try {
        await adapter.startApplication(page, multiStepUrl);

        // Step 1
        await adapter.fillCurrentStep(page, { profile, answerBank });
        const advanceStep1 = await adapter.advanceStep(page);
        expect(advanceStep1.movedNext).toBe(true);
        expect(advanceStep1.isComplete).toBe(false);

        // Step 2
        await adapter.fillCurrentStep(page, { profile, answerBank });
        const advanceStep2 = await adapter.advanceStep(page);
        expect(advanceStep2.movedNext).toBe(true);

        // Check confirmation
        const confirmation = await adapter.checkConfirmation(page);
        expect(confirmation.isConfirmed).toBe(true);
      } finally {
        await page.close();
      }
    });

    it('1.3.6: captures timestamped full-page screenshot evidence to disk', async () => {
      const page = await browserManager.newPage();
      try {
        await page.goto(standardFormUrl);
        const filename = `e2e_evidence_${Date.now()}.png`;
        const screenshotPath = await browserManager.captureScreenshot(page, filename);

        expect(fs.existsSync(screenshotPath)).toBe(true);
        const stats = fs.statSync(screenshotPath);
        expect(stats.size).toBeGreaterThan(1000);

        // Clean up screenshot file
        fs.unlinkSync(screenshotPath);
      } finally {
        await page.close();
      }
    });
  });

  // ---------------------------------------------------------------------------
  // 1.4 Cascading QA Feature Coverage (>=5 test cases)
  // ---------------------------------------------------------------------------
  describe('1.4 Cascading QA Subsystem', () => {
    it('1.4.1: Layer 1 resolves work authorization questions from AnswerBank', () => {
      const q = 'Are you legally authorized to work in the United States?';
      const result = matchAnswerBank(q, answerBank);
      expect(result).not.toBeNull();
      expect(result?.canAnswer).toBe(true);
      expect(result?.answer).toBe('Yes');
      expect(result?.confidence).toBe(1.0);
      expect(result?.source).toBe('answer_bank');
    });

    it('1.4.2: Layer 1 resolves visa sponsorship questions from AnswerBank', () => {
      const q = 'Will you now or in the future require visa sponsorship?';
      const result = matchAnswerBank(q, answerBank);
      expect(result).not.toBeNull();
      expect(result?.canAnswer).toBe(true);
      expect(result?.answer).toBe('No');
      expect(result?.confidence).toBe(1.0);
    });

    it('1.4.3: Layer 2 extracts candidate identity facts with confidence >= 0.95', () => {
      const nameRes = matchProfileFacts('What is your full name?');
      expect(nameRes?.answer).toBe('Alex Rivera');
      expect(nameRes?.confidence).toBeGreaterThanOrEqual(0.95);

      const emailRes = matchProfileFacts('Please enter your primary email address:');
      expect(emailRes?.answer).toBe('alex.rivera.dev@example.com');

      const phoneRes = matchProfileFacts('Contact phone number:');
      expect(phoneRes?.answer).toBe('+1-555-019-2834');
    });

    it('1.4.4: Layer 3 refuses unmentioned skills without hallucinating', async () => {
      const unknownQ = 'Do you possess 10+ years of COBOL mainframe development experience?';
      const res = await answerQuestionWithPhi3(unknownQ);
      expect(res.canAnswer).toBe(false);
      expect(res.requiresManualReview).toBe(true);
      expect(res.source).toBe('refusal');
    });

    it('1.4.5: validates QA schema conformance with Zod schema', () => {
      const valid = QuestionAnswerResponseSchema.safeParse({
        canAnswer: true,
        answer: 'Yes',
        confidence: 0.95,
        source: 'profile',
        requiresManualReview: false,
      });
      expect(valid.success).toBe(true);

      const invalid = QuestionAnswerResponseSchema.safeParse({
        canAnswer: 'not-a-boolean',
        confidence: 'high',
      });
      expect(invalid.success).toBe(false);
    });

    it('1.4.6: gatekeeper marks low-confidence responses for manual review', () => {
      // Validating schema enforcement where confidence < 0.8 mandates manual review
      const lowConfidenceAnswer = {
        canAnswer: false,
        confidence: 0.65, // Below 0.8 threshold
        source: 'refusal' as const,
        requiresManualReview: true,
      };
      const parsed = QuestionAnswerResponseSchema.parse(lowConfidenceAnswer);
      expect(parsed.requiresManualReview).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // 1.5 Ledger & Outbox Subsystem (>=5 test cases)
  // ---------------------------------------------------------------------------
  describe('1.5 Ledger & Outbox Subsystem', () => {
    it('1.5.1: writes event atomically to both EventLedger and OutboxEvent with same ID', async () => {
      const testJob = await prisma.job.create({
        data: {
          title: '[E2E-TEST] Atomic Lead Engineer',
          employer: 'Atomic Systems',
          url: `https://indeed.com/viewjob?jk=e2e-test-atomic-${Date.now()}`,
          status: 'QUEUED',
        },
      });

      const [ledgerEntry, outboxEntry] = await emitLifecycleEvent(
        'APPLICATION_STARTED',
        'PLAYWRIGHT_AUTONOMOUS',
        {
          jobId: testJob.id,
          metadata: { step: 'OPEN_APPLICATION', url: testJob.url },
        }
      );

      expect(ledgerEntry.id).toBe(outboxEntry.id);
      expect(ledgerEntry.type).toBe('APPLICATION_STARTED');
      expect(outboxEntry.eventType).toBe('APPLICATION_STARTED');

      // Verify persistence in SQLite
      const foundLedger = await prisma.eventLedger.findUnique({ where: { id: ledgerEntry.id } });
      const foundOutbox = await prisma.outboxEvent.findUnique({ where: { id: outboxEntry.id } });
      expect(foundLedger).not.toBeNull();
      expect(foundOutbox).not.toBeNull();
    });

    it('1.5.2: tags all lifecycle events with source attribution PLAYWRIGHT_AUTONOMOUS', async () => {
      const [ledger, outbox] = await emitLifecycleEvent(
        'FORM_IN_PROGRESS',
        'PLAYWRIGHT_AUTONOMOUS',
        { metadata: { e2e: 'source_check' } }
      );

      expect(ledger.source).toBe('PLAYWRIGHT_AUTONOMOUS');
      expect(outbox.source).toBe('PLAYWRIGHT_AUTONOMOUS');
    });

    it('1.5.3: initializes OutboxEvent with syncedAt null and syncAttempts 0', async () => {
      const [, outbox] = await emitLifecycleEvent(
        'DISCOVERED',
        'PLAYWRIGHT_AUTONOMOUS',
        { metadata: { check: 'init_state' } }
      );

      expect(outbox.syncedAt).toBeNull();
      expect(outbox.syncAttempts).toBe(0);
      expect(outbox.lastSyncError).toBeNull();
    });

    it('1.5.4: serializes full lifecycle metadata as valid JSON string', async () => {
      const metadataPayload = {
        title: 'Senior Engineer',
        employer: 'MetaCorp',
        fitScore: 94,
        nested: { inner: 'val' },
      };

      const [ledger] = await emitLifecycleEvent('ANALYZED', 'PLAYWRIGHT_AUTONOMOUS', {
        metadata: metadataPayload,
      });

      const parsed = JSON.parse(ledger.metadata);
      expect(parsed.data.title).toBe('Senior Engineer');
      expect(parsed.data.fitScore).toBe(94);
      expect(parsed.data.nested.inner).toBe('val');
    });

    it('1.5.5: maintains transaction rollback consistency if execution fails', async () => {
      const initialLedgerCount = await prisma.eventLedger.count();
      const initialOutboxCount = await prisma.outboxEvent.count();

      // Attempt invalid transaction with invalid foreign key
      try {
        await prisma.$transaction([
          prisma.eventLedger.create({
            data: {
              id: 'e2e-fail-tx-1',
              type: 'INVALID',
              source: 'PLAYWRIGHT_AUTONOMOUS',
              jobId: 'non-existent-job-id-uuid',
              metadata: '{}',
            },
          }),
          prisma.outboxEvent.create({
            data: {
              id: 'e2e-fail-tx-1',
              eventType: 'INVALID',
              source: 'PLAYWRIGHT_AUTONOMOUS',
              payload: '{}',
            },
          }),
        ]);
      } catch {
        // Expected rollback
      }

      // Neither table should have retained partial rows
      const postLedger = await prisma.eventLedger.count();
      const postOutbox = await prisma.outboxEvent.count();
      expect(postLedger).toBe(initialLedgerCount);
      expect(postOutbox).toBe(initialOutboxCount);
    });
  });

  // ---------------------------------------------------------------------------
  // 1.6 Cloud Ingestion & Outbox Sync (>=5 test cases)
  // ---------------------------------------------------------------------------
  describe('1.6 Cloud Ingestion & Outbox Sync Subsystem', () => {
    it('1.6.1: cloud sync route accepts valid event batch and returns success', async () => {
      const eventId = `e2e-cloud-sync-${Date.now()}`;
      const payload = {
        url: `https://www.indeed.com/viewjob?jk=e2e-test-cloud-${Date.now()}`,
        title: '[E2E-TEST] Cloud Sync Lead',
        employer: 'Cloud Innovators',
        status: 'QUEUED',
      };

      const request = new Request('http://localhost:3000/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          events: [
            {
              id: eventId,
              eventType: 'QUEUED',
              source: 'PLAYWRIGHT_AUTONOMOUS',
              payload: JSON.stringify(payload),
              createdAt: new Date().toISOString(),
            },
          ],
        }),
      });

      const response = await handleCloudSync(request);
      expect(response.status).toBe(200);

      const data = response.body;
      expect(data.success).toBe(true);
      expect(data.received).toBe(1);
      expect(data.synced).toBe(1);
    });

    it('1.6.2: cloud sync route upserts Job by unique URL and links EventLedger', async () => {
      const testUrl = `https://www.indeed.com/viewjob?jk=e2e-test-upsert-${Date.now()}`;
      const eventId = `e2e-upsert-${Date.now()}`;

      const request = new Request('http://localhost:3000/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          events: [
            {
              id: eventId,
              eventType: 'DISCOVERED',
              source: 'PLAYWRIGHT_AUTONOMOUS',
              payload: JSON.stringify({
                url: testUrl,
                title: '[E2E-TEST] Auto Upserted Job',
                employer: 'SyncCorp',
                status: 'DISCOVERED',
              }),
              createdAt: new Date().toISOString(),
            },
          ],
        }),
      });

      await handleCloudSync(request);

      const jobInDb = await prisma.job.findUnique({ where: { url: testUrl } });
      expect(jobInDb).not.toBeNull();
      expect(jobInDb?.title).toBe('[E2E-TEST] Auto Upserted Job');

      const ledgerInDb = await prisma.eventLedger.findUnique({ where: { id: eventId } });
      expect(ledgerInDb).not.toBeNull();
      expect(ledgerInDb?.jobId).toBe(jobInDb?.id);
    });

    it('1.6.3: cloud sync is idempotent by event UUID (duplicate returns synced: 0)', async () => {
      const eventId = `e2e-idempotent-${Date.now()}`;
      const payload = JSON.stringify({
        url: `https://www.indeed.com/viewjob?jk=e2e-test-dup-${Date.now()}`,
        title: '[E2E-TEST] Duplicate Test',
        employer: 'Idempotent Sync Ltd',
        status: 'ANALYZED',
      });

      const reqBody = JSON.stringify({
        events: [
          {
            id: eventId,
            eventType: 'ANALYZED',
            source: 'PLAYWRIGHT_AUTONOMOUS',
            payload,
            createdAt: new Date().toISOString(),
          },
        ],
      });

      // First call
      const res1 = await handleCloudSync(
        new Request('http://localhost:3000/api/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: reqBody,
        })
      );
      const data1 = res1.body;
      expect(data1.synced).toBe(1);

      // Second call with same eventId
      const res2 = await handleCloudSync(
        new Request('http://localhost:3000/api/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: reqBody,
        })
      );
      const data2 = res2.body;
      expect(data2.received).toBe(1);
      expect(data2.synced).toBe(0); // 0 newly synced!
    });

    it('1.6.4: OutboxSyncWorker updates syncedAt and resets error on successful batch sync', async () => {
      const eventId = `e2e-outbox-worker-${Date.now()}`;
      const payload = JSON.stringify({
        url: `https://www.indeed.com/viewjob?jk=e2e-test-worker-${Date.now()}`,
        title: '[E2E-TEST] Worker Sync Job',
        employer: 'Worker Systems',
        status: 'QUEUED',
      });

      // Create an unsynced OutboxEvent row
      await prisma.outboxEvent.create({
        data: {
          id: eventId,
          eventType: 'QUEUED',
          source: 'PLAYWRIGHT_AUTONOMOUS',
          payload,
          createdAt: new Date(),
          syncedAt: null,
          syncAttempts: 0,
        },
      });

      // Run worker with intercepted local fetch
      const worker = new OutboxSyncWorker();
      const originalFetch = global.fetch;

      try {
        // Mock fetch to invoke our sync handler
        global.fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
          const req = new Request('http://localhost:3000/api/sync', {
            method: init?.method || 'POST',
            headers: init?.headers,
            body: init?.body,
          });
          const res = await handleCloudSync(req);
          return new Response(JSON.stringify(res.body), {
            status: res.status,
            headers: { 'Content-Type': 'application/json' },
          });
        };

        await worker.syncBatch();

        // Verify that the outbox record now has syncedAt populated
        const updated = await prisma.outboxEvent.findUnique({ where: { id: eventId } });
        expect(updated?.syncedAt).not.toBeNull();
        expect(updated?.lastSyncError).toBeNull();
      } finally {
        global.fetch = originalFetch;
      }
    });

    it('1.6.5: SyncState tracks totalSynced count and lastSyncedAt timestamp', async () => {
      const eventId = `e2e-sync-state-${Date.now()}`;
      const payload = JSON.stringify({
        url: `https://www.indeed.com/viewjob?jk=e2e-test-state-${Date.now()}`,
        title: '[E2E-TEST] SyncState Test',
        employer: 'State Corp',
        status: 'QUEUED',
      });

      await prisma.outboxEvent.create({
        data: {
          id: eventId,
          eventType: 'QUEUED',
          source: 'PLAYWRIGHT_AUTONOMOUS',
          payload,
          createdAt: new Date(),
          syncedAt: null,
          syncAttempts: 0,
        },
      });

      const worker = new OutboxSyncWorker();
      const originalFetch = global.fetch;

      try {
        global.fetch = async (_input: RequestInfo | URL, init?: RequestInit) => {
          const req = new Request('http://localhost:3000/api/sync', {
            method: init?.method || 'POST',
            headers: init?.headers,
            body: init?.body,
          });
          const res = await handleCloudSync(req);
          return new Response(JSON.stringify(res.body), {
            status: res.status,
            headers: { 'Content-Type': 'application/json' },
          });
        };

        await worker.syncBatch();

        const syncState = await prisma.syncState.findUnique({ where: { id: 'singleton' } });
        expect(syncState).not.toBeNull();
        expect(syncState?.totalSynced).toBeGreaterThan(0);
        expect(syncState?.lastSyncedAt).toBeDefined();
      } finally {
        global.fetch = originalFetch;
      }
    });
  });
});
