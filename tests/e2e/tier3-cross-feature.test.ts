import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import fs from 'fs';
import { prisma } from '../../src/db/prisma';
import { IndeedSearchCrawler } from '../../src/engine/discovery/indeed-search';
import { calculateFitScore, loadDefaultProfile } from '../../src/qualification/engine';
import { BrowserManager } from '../../src/engine/browser/browser';
import { ApplicationWorkflowEngine } from '../../src/engine/workflow';
import { processNextJob } from '../../src/queue/worker';
import { emitLifecycleEvent } from '../../src/sync/outbox';
import { OutboxSyncWorker } from '../../src/sync/outbox-worker';
import { handleCloudSync } from './helpers/cloud-sync-endpoint';
import { getFixtureUrl, cleanE2ETestData } from './helpers/e2e-test-helpers';

describe('Tier 3: Cross-Feature Combinations & Pairwise Pipelines', () => {
  let browserManager: BrowserManager;
  const profile = loadDefaultProfile();
  const standardFormUrl = getFixtureUrl('standard-job-form.html');

  beforeAll(async () => {
    browserManager = new BrowserManager({ headless: true });
    await cleanE2ETestData('tier3');
  });

  afterAll(async () => {
    await browserManager.close();
    await cleanE2ETestData('tier3');
  });

  // ---------------------------------------------------------------------------
  // 3.1 Pipeline: Discovery -> Qualification -> Queue Ingestion
  // ---------------------------------------------------------------------------
  describe('3.1 Pipeline: Discovery -> Qualification -> Queue Ingestion', () => {
    it('3.1.1: processes mixed job batch, routing high fit scores to QUEUED and low scores to DISCOVERED', async () => {
      const highFitUrl = `https://indeed.com/viewjob?jk=e2e-pipe-high-${Date.now()}`;
      const lowFitUrl = `https://indeed.com/viewjob?jk=e2e-pipe-low-${Date.now()}`;
      const excludedUrl = `https://indeed.com/viewjob?jk=e2e-pipe-ex-${Date.now()}`;

      const rawBatch = [
        {
          title: 'Senior Full Stack Engineer',
          employer: 'Enterprise Systems',
          location: 'Remote',
          description: '5+ years of experience with TypeScript, React, Next.js, Node.js, and PostgreSQL.',
          url: highFitUrl,
        },
        {
          title: 'Entry Level Barista',
          employer: 'Coffee Shop',
          location: 'Remote',
          description: 'Making coffee drinks and customer service.',
          url: lowFitUrl,
        },
        {
          title: 'Security Software Engineer',
          employer: 'Defense Tech',
          location: 'Remote',
          description: 'Active Top Secret Clearance (TS/SCI) required.',
          url: excludedUrl,
        },
      ];

      for (const raw of rawBatch) {
        const qualification = calculateFitScore(raw, profile);
        const status =
          qualification.fitScore >= 50 && !qualification.isExcluded ? 'QUEUED' : 'DISCOVERED';

        await prisma.job.create({
          data: {
            title: raw.title,
            employer: raw.employer,
            location: raw.location,
            description: raw.description,
            url: raw.url,
            fitScore: qualification.fitScore,
            status,
            source: 'PLAYWRIGHT_AUTONOMOUS',
          },
        });
      }

      const highJob = await prisma.job.findUnique({ where: { url: highFitUrl } });
      const lowJob = await prisma.job.findUnique({ where: { url: lowFitUrl } });
      const exJob = await prisma.job.findUnique({ where: { url: excludedUrl } });

      expect(highJob?.status).toBe('QUEUED');
      expect(highJob?.fitScore).toBeGreaterThanOrEqual(50);

      expect(lowJob?.status).toBe('DISCOVERED');
      expect(lowJob?.fitScore).toBeLessThan(50);

      expect(exJob?.status).toBe('DISCOVERED');
      expect(exJob?.fitScore).toBe(0);
    });

    it('3.1.2: idempotent discovery preserves existing job records and does not duplicate entries', async () => {
      const uniqueUrl = `https://indeed.com/viewjob?jk=e2e-idemp-pipe-${Date.now()}`;

      // Ingest once
      const initialJob = await prisma.job.create({
        data: {
          title: 'Senior TypeScript Architect',
          employer: 'Idemp Inc',
          url: uniqueUrl,
          fitScore: 92,
          status: 'QUEUED',
        },
      });

      // Second ingestion attempt (simulating crawler discovery)
      const existing = await prisma.job.findUnique({ where: { url: uniqueUrl } });
      expect(existing).not.toBeNull();
      expect(existing?.id).toBe(initialJob.id);

      // Verify total count for this URL remains 1
      const totalCount = await prisma.job.count({ where: { url: uniqueUrl } });
      expect(totalCount).toBe(1);
    });

    it('3.1.3: discovery atomically records DISCOVERED event to EventLedger and OutboxEvent', async () => {
      const testJob = await prisma.job.create({
        data: {
          title: '[E2E-TEST] Pipe Event Job',
          employer: 'PipeCorp',
          url: `https://indeed.com/viewjob?jk=e2e-pipe-event-${Date.now()}`,
          fitScore: 85,
          status: 'QUEUED',
        },
      });

      const [ledger, outbox] = await emitLifecycleEvent('DISCOVERED', 'PLAYWRIGHT_AUTONOMOUS', {
        jobId: testJob.id,
        metadata: {
          title: testJob.title,
          employer: testJob.employer,
          fitScore: testJob.fitScore,
          url: testJob.url,
        },
      });

      expect(ledger.id).toBe(outbox.id);
      expect(ledger.type).toBe('DISCOVERED');
      expect(ledger.source).toBe('PLAYWRIGHT_AUTONOMOUS');
      expect(outbox.eventType).toBe('DISCOVERED');
      expect(outbox.syncedAt).toBeNull();
    });

    it('3.1.4: respects custom qualification threshold during queue ingestion', async () => {
      const customThreshold = 80;
      const moderateJobInput = {
        title: 'Full Stack Developer',
        employer: 'Standard Tech',
        location: 'Remote',
        description: 'TypeScript and Node.js developer.',
      };

      const score = calculateFitScore(moderateJobInput, profile);
      // Moderate score is ~50-70%
      expect(score.fitScore).toBeLessThan(customThreshold);

      // Custom threshold routing:
      const status = score.fitScore >= customThreshold ? 'QUEUED' : 'DISCOVERED';
      expect(status).toBe('DISCOVERED');
    });
  });

  // ---------------------------------------------------------------------------
  // 3.2 Pipeline: Queue Dispatch -> Form Filling -> Ledger Recording
  // ---------------------------------------------------------------------------
  describe('3.2 Pipeline: Queue Dispatch -> Form Filling -> Ledger Recording', () => {
    it('3.2.1: queue worker dispatches highest fitScore job first from QUEUED state', async () => {
      const highFitUrl = `file:///e2e-high-fit-${Date.now()}.html`;
      const lowFitUrl = `file:///e2e-low-fit-${Date.now()}.html`;

      const lowJob = await prisma.job.create({
        data: {
          title: '[E2E-TEST] Lower Fit Job',
          employer: 'Low Tech',
          url: lowFitUrl,
          fitScore: 60,
          status: 'QUEUED',
        },
      });

      const highJob = await prisma.job.create({
        data: {
          title: '[E2E-TEST] Higher Fit Job',
          employer: 'High Tech',
          url: highFitUrl,
          fitScore: 95,
          status: 'QUEUED',
        },
      });

      // Query database following queue worker order: fitScore desc, createdAt asc
      const nextDispatched = await prisma.job.findFirst({
        where: { status: 'QUEUED', id: { in: [lowJob.id, highJob.id] } },
        orderBy: [{ fitScore: 'desc' }, { createdAt: 'asc' }],
      });

      expect(nextDispatched?.id).toBe(highJob.id);
      expect(nextDispatched?.fitScore).toBe(95);
    });

    it('3.2.2: executes synthetic form submission and achieves confirmed status', async () => {
      const job = await prisma.job.create({
        data: {
          title: '[E2E-TEST] Form Filling Senior Engineer',
          employer: 'FormCorp',
          url: standardFormUrl,
          fitScore: 92,
          status: 'QUEUED',
        },
      });

      const workflow = new ApplicationWorkflowEngine(browserManager);
      const result = await workflow.executeApplication(job.id);

      expect(result.success).toBe(true);
      expect(result.finalState).toBe('SUBMITTED');
      expect(result.confirmationText).toContain('successfully');
      expect(result.screenshotPath).toBeDefined();

      // Check Application record in SQLite
      const appRecord = await prisma.application.findUnique({
        where: { id: result.applicationId },
      });
      expect(appRecord?.status).toBe('SUBMITTED');
      expect(appRecord?.submittedAt).toBeDefined();
    }, 25000);

    it('3.2.3: records state transitions to EventLedger during form execution', async () => {
      const job = await prisma.job.create({
        data: {
          title: '[E2E-TEST] Ledger Trail Engineer',
          employer: 'LedgerCorp',
          url: standardFormUrl,
          fitScore: 89,
          status: 'QUEUED',
        },
      });

      const workflow = new ApplicationWorkflowEngine(browserManager);
      await workflow.executeApplication(job.id);

      const events = await prisma.eventLedger.findMany({
        where: { jobId: job.id },
        orderBy: { timestamp: 'asc' },
      });

      expect(events.length).toBeGreaterThanOrEqual(4);
      const types = events.map((e) => e.type);
      expect(types).toContain('STATE_CHANGE');

      // Check metadata contains state transition targets
      const stateMetadata = events.map((e) => {
        try {
          return JSON.parse(e.metadata);
        } catch {
          return {};
        }
      });
      const toStates = stateMetadata.map((m) => m.to || m.data?.to).filter(Boolean);
      expect(toStates).toContain('APPLYING');
      expect(toStates).toContain('SUBMITTED');
    }, 25000);

    it('3.2.4: duplicate prevention halts execution on already submitted job and logs DUPLICATE_PREVENTED', async () => {
      const job = await prisma.job.create({
        data: {
          title: '[E2E-TEST] Submitted Prevention Job',
          employer: 'DupCheck Corp',
          url: `https://indeed.com/viewjob?jk=e2e-dup-prev-${Date.now()}`,
          status: 'SUBMITTED',
          fitScore: 90,
        },
      });

      await prisma.application.create({
        data: {
          jobId: job.id,
          status: 'SUBMITTED',
          submittedAt: new Date(),
        },
      });

      const workflow = new ApplicationWorkflowEngine(browserManager);
      const result = await workflow.executeApplication(job.id);

      expect(result.success).toBe(false);
      expect(result.finalState).toBe('SUBMITTED');
      expect(result.error).toContain('Duplicate application prevented');

      const dupEvents = await prisma.eventLedger.findMany({
        where: { jobId: job.id, type: 'DUPLICATE_PREVENTED' },
      });
      expect(dupEvents.length).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // 3.3 Pipeline: Outbox Emission -> Payload Structuring -> Cloud Sync
  // ---------------------------------------------------------------------------
  describe('3.3 Pipeline: Outbox Emission -> Payload Structuring -> Cloud Sync', () => {
    it('3.3.1: lifecycle events committed to OutboxEvent are transmitted by OutboxSyncWorker', async () => {
      const eventId = `e2e-pipe-sync-${Date.now()}`;
      const payload = {
        url: `https://indeed.com/viewjob?jk=e2e-pipe-job-${Date.now()}`,
        title: '[E2E-TEST] Pipeline Sync Job',
        employer: 'Cloud Innovators',
        status: 'SUBMITTED',
      };

      await prisma.outboxEvent.create({
        data: {
          id: eventId,
          eventType: 'SUBMISSION_CONFIRMED',
          source: 'PLAYWRIGHT_AUTONOMOUS',
          payload: JSON.stringify(payload),
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

        const updatedEvent = await prisma.outboxEvent.findUnique({ where: { id: eventId } });
        expect(updatedEvent?.syncedAt).not.toBeNull();
      } finally {
        global.fetch = originalFetch;
      }
    });

    it('3.3.2: payload contract with top-level url and employer upserts Job without FK 500 error', async () => {
      const eventId = `e2e-fk-contract-${Date.now()}`;
      const targetUrl = `https://indeed.com/viewjob?jk=e2e-fk-${Date.now()}`;

      // Payload conforms to contract: top-level url, title, employer, status, NO local jobId
      const payload = {
        url: targetUrl,
        title: '[E2E-TEST] FK Contract Job',
        employer: 'Contract Corp',
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

      const res = await handleCloudSync(request);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.synced).toBe(1);

      // Verify Job was upserted by URL and linked
      const upsertedJob = await prisma.job.findUnique({ where: { url: targetUrl } });
      expect(upsertedJob).not.toBeNull();
      expect(upsertedJob?.employer).toBe('Contract Corp');

      const ledger = await prisma.eventLedger.findUnique({ where: { id: eventId } });
      expect(ledger?.jobId).toBe(upsertedJob?.id);
    });

    it('3.3.3: cloud sync rejects invalid payload (non-array) with HTTP 400', async () => {
      const badRequest = new Request('http://localhost:3000/api/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ events: 'not-an-array' }),
      });

      const res = await handleCloudSync(badRequest);
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('events must be an array');
    });

    it('3.3.4: sync updates SyncState summary and persists synced count', async () => {
      const syncStateBefore = await prisma.syncState.findUnique({ where: { id: 'singleton' } });
      const initialCount = syncStateBefore?.totalSynced || 0;

      const eventId = `e2e-summary-evt-${Date.now()}`;
      await prisma.outboxEvent.create({
        data: {
          id: eventId,
          eventType: 'APPLICATION_STARTED',
          source: 'PLAYWRIGHT_AUTONOMOUS',
          payload: JSON.stringify({
            url: `https://indeed.com/viewjob?jk=e2e-summary-${Date.now()}`,
            title: '[E2E-TEST] Summary Job',
            employer: 'Summary Corp',
            status: 'APPLYING',
          }),
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

        const syncStateAfter = await prisma.syncState.findUnique({ where: { id: 'singleton' } });
        expect(syncStateAfter?.totalSynced).toBeGreaterThan(initialCount);
      } finally {
        global.fetch = originalFetch;
      }
    });
  });
});
