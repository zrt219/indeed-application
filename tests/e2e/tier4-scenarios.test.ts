import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import fs from 'fs';
import { prisma } from '../../src/db/prisma';
import { BrowserManager } from '../../src/engine/browser/browser';
import { ApplicationWorkflowEngine } from '../../src/engine/workflow';
import { OutboxSyncWorker } from '../../src/sync/outbox-worker';
import { handleCloudSync } from './helpers/cloud-sync-endpoint';
import { getFixtureUrl, cleanE2ETestData } from './helpers/e2e-test-helpers';

describe('Tier 4: Real-World Application Scenarios', () => {
  let browserManager: BrowserManager;
  const standardFormUrl = getFixtureUrl('standard-job-form.html');
  const unanswerableUrl = getFixtureUrl('unanswerable-question.html');

  beforeAll(async () => {
    browserManager = new BrowserManager({ headless: true });
    await cleanE2ETestData('tier4');
  });

  afterAll(async () => {
    await browserManager.close();
    await cleanE2ETestData('tier4');
  });

  // ---------------------------------------------------------------------------
  // 4.1 End-to-End Multi-Job Autonomous Execution
  // ---------------------------------------------------------------------------
  describe('4.1 Multi-Job Autonomous Execution Loop', () => {
    it('executes batch of multiple queued jobs in priority order with confirmation screenshots', async () => {
      const job1 = await prisma.job.create({
        data: {
          title: '[E2E-TEST] Staff Platform Architect',
          employer: 'Titan Cloud',
          url: `${standardFormUrl}?job=1`,
          fitScore: 96,
          status: 'QUEUED',
        },
      });

      const job2 = await prisma.job.create({
        data: {
          title: '[E2E-TEST] Senior Full Stack Engineer',
          employer: 'Starlight Media',
          url: `${standardFormUrl}?job=2`,
          fitScore: 88,
          status: 'QUEUED',
        },
      });

      // Fetch queued jobs in worker priority order (fitScore desc)
      const queuedJobs = await prisma.job.findMany({
        where: { id: { in: [job1.id, job2.id] } },
        orderBy: [{ fitScore: 'desc' }, { createdAt: 'asc' }],
      });

      expect(queuedJobs[0].id).toBe(job1.id);
      expect(queuedJobs[1].id).toBe(job2.id);

      const workflow = new ApplicationWorkflowEngine(browserManager);
      const executionResults = [];

      for (const job of queuedJobs) {
        const result = await workflow.executeApplication(job.id);
        executionResults.push(result);
      }

      // Both should succeed
      expect(executionResults.length).toBe(2);
      for (const res of executionResults) {
        expect(res.success).toBe(true);
        expect(res.finalState).toBe('SUBMITTED');
        expect(res.screenshotPath).toBeDefined();
        expect(fs.existsSync(res.screenshotPath!)).toBe(true);
      }

      // Check database state
      const updatedJob1 = await prisma.job.findUnique({ where: { id: job1.id } });
      const updatedJob2 = await prisma.job.findUnique({ where: { id: job2.id } });
      expect(updatedJob1?.status).toBe('SUBMITTED');
      expect(updatedJob2?.status).toBe('SUBMITTED');
    }, 45000);
  });

  // ---------------------------------------------------------------------------
  // 4.2 Session Resumption & Stalled Application Recovery
  // ---------------------------------------------------------------------------
  describe('4.2 Session Resumption & Stalled Application Recovery', () => {
    it('resumes existing PENDING or APPLYING application without creating orphaned duplicates', async () => {
      const job = await prisma.job.create({
        data: {
          title: '[E2E-TEST] Resumption Candidate',
          employer: 'ResumeCorp',
          url: standardFormUrl,
          fitScore: 87,
          status: 'QUEUED',
        },
      });

      // Pre-create an application record stuck in PENDING from an interrupted run
      const priorApplication = await prisma.application.create({
        data: {
          jobId: job.id,
          status: 'PENDING',
        },
      });

      const workflow = new ApplicationWorkflowEngine(browserManager);
      const result = await workflow.executeApplication(job.id);

      expect(result.success).toBe(true);
      expect(result.finalState).toBe('SUBMITTED');
      // Must reuse prior application ID
      expect(result.applicationId).toBe(priorApplication.id);

      // Verify no duplicate applications were created for this job
      const applications = await prisma.application.findMany({ where: { jobId: job.id } });
      expect(applications.length).toBe(1);
      expect(applications[0].status).toBe('SUBMITTED');
    }, 25000);
  });

  // ---------------------------------------------------------------------------
  // 4.3 Manual Review Escalation with Uninterrupted Pipeline
  // ---------------------------------------------------------------------------
  describe('4.3 Manual Review Escalation with Pipeline Continuity', () => {
    it('escalates job with unanswerable questions to BLOCKED_REQUIRES_MANUAL_ACTION while subsequent jobs succeed', async () => {
      // Job A has unanswerable question (triggers manual review)
      const jobA = await prisma.job.create({
        data: {
          title: '[E2E-TEST] Needs Manual Clarification',
          employer: 'AeroCorp',
          url: unanswerableUrl,
          fitScore: 90,
          status: 'QUEUED',
        },
      });

      // Job B has standard answerable form
      const jobB = await prisma.job.create({
        data: {
          title: '[E2E-TEST] Standard Answerable Job',
          employer: 'StandardCorp',
          url: standardFormUrl,
          fitScore: 85,
          status: 'QUEUED',
        },
      });

      const workflow = new ApplicationWorkflowEngine(browserManager);

      // Execute Job A: should escalate cleanly
      const resultA = await workflow.executeApplication(jobA.id);
      expect(resultA.success).toBe(false);
      expect(resultA.finalState).toBe('BLOCKED_REQUIRES_MANUAL_ACTION');
      expect(resultA.screenshotPath).toBeDefined();

      // Verify ManualReview row created
      const manualReviews = await prisma.manualReview.findMany({ where: { jobId: jobA.id } });
      expect(manualReviews.length).toBeGreaterThan(0);
      expect(manualReviews[0].status).toBe('PENDING');

      const updatedJobA = await prisma.job.findUnique({ where: { id: jobA.id } });
      expect(updatedJobA?.status).toBe('BLOCKED_REQUIRES_MANUAL_ACTION');

      // Execute Job B: pipeline must not be stalled by Job A's escalation!
      const resultB = await workflow.executeApplication(jobB.id);
      expect(resultB.success).toBe(true);
      expect(resultB.finalState).toBe('SUBMITTED');

      const updatedJobB = await prisma.job.findUnique({ where: { id: jobB.id } });
      expect(updatedJobB?.status).toBe('SUBMITTED');
    }, 35000);
  });

  // ---------------------------------------------------------------------------
  // 4.4 Cloud Sync Batching & Dashboard Metric Reflection
  // ---------------------------------------------------------------------------
  describe('4.4 Cloud Sync Batching & Dashboard Metrics', () => {
    it('streams batch of 10+ application lifecycle events and accurately updates sync state', async () => {
      const eventTypes = [
        'DISCOVERED',
        'QUEUED',
        'APPLICATION_STARTED',
        'FORM_IN_PROGRESS',
        'SUBMISSION_CONFIRMED',
      ];

      const batchIds: string[] = [];
      const batchSize = 10;

      for (let i = 0; i < batchSize; i++) {
        const eventId = `e2e-batch-${Date.now()}-${i}`;
        batchIds.push(eventId);
        const type = eventTypes[i % eventTypes.length];
        const jobUrl = `https://indeed.com/viewjob?jk=e2e-batch-job-${Date.now()}-${i}`;

        await prisma.outboxEvent.create({
          data: {
            id: eventId,
            eventType: type,
            source: 'PLAYWRIGHT_AUTONOMOUS',
            payload: JSON.stringify({
              url: jobUrl,
              title: `[E2E-TEST] Batch Job ${i + 1}`,
              employer: `Batch Employer ${i + 1}`,
              status: type === 'SUBMISSION_CONFIRMED' ? 'SUBMITTED' : 'QUEUED',
              fitScore: 70 + i,
            }),
            createdAt: new Date(),
            syncedAt: null,
            syncAttempts: 0,
          },
        });
      }

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

        // Sync batch
        await worker.syncBatch();

        // Verify all 10 events now marked as synced
        const syncedEvents = await prisma.outboxEvent.findMany({
          where: { id: { in: batchIds }, syncedAt: { not: null } },
        });
        expect(syncedEvents.length).toBe(batchSize);

        // Verify cloud EventLedger entries exist for all 10
        const ledgerEntries = await prisma.eventLedger.findMany({
          where: { id: { in: batchIds } },
        });
        expect(ledgerEntries.length).toBe(batchSize);
      } finally {
        global.fetch = originalFetch;
      }
    });
  });
});
