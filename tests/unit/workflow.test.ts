import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '../../src/db/prisma';
import { ApplicationWorkflowEngine } from '../../src/engine/workflow';

describe('Application Workflow Engine & State Machine', () => {
  const workflow = new ApplicationWorkflowEngine();

  beforeEach(async () => {
    // Clean up test jobs from SQLite test db
    await prisma.eventLedger.deleteMany({});
    await prisma.manualReview.deleteMany({});
    await prisma.application.deleteMany({});
    await prisma.job.deleteMany({});
  });

  describe('Duplicate Prevention', () => {
    it('should strictly prevent duplicate application to an already submitted job', async () => {
      // 1. Create a job that is already SUBMITTED
      const testJob = await prisma.job.create({
        data: {
          title: 'Senior TypeScript Engineer',
          employer: 'Acme Test Corp',
          url: 'https://www.indeed.com/viewjob?jk=test123456',
          status: 'SUBMITTED',
          fitScore: 92,
        },
      });

      // 2. Create existing submitted application
      await prisma.application.create({
        data: {
          jobId: testJob.id,
          status: 'SUBMITTED',
          submittedAt: new Date(),
          confirmationText: 'Your application has been submitted',
        },
      });

      // 3. Attempt to execute application again
      const result = await workflow.executeApplication(testJob.id);

      expect(result.success).toBe(false);
      expect(result.finalState).toBe('SUBMITTED');
      expect(result.error).toContain('Duplicate application prevented');

      // Verify duplicate event was logged to ledger
      const ledgerEvents = await prisma.eventLedger.findMany({
        where: { jobId: testJob.id, type: 'DUPLICATE_PREVENTED' },
      });
      expect(ledgerEvents.length).toBe(1);
    });
  });

  describe('Ledger Audit Trail', () => {
    it('should record state changes to EventLedger', async () => {
      const path = await import('path');
      const formUrl = `file://${path.resolve(__dirname, '../synthetic/form.html').replace(/\\/g, '/')}`;

      const job = await prisma.job.create({
        data: {
          title: 'Full Stack Engineer',
          employer: 'Beta Systems',
          url: formUrl,
          status: 'QUEUED',
          fitScore: 85,
        },
      });

      // Execute application
      const result = await workflow.executeApplication(job.id);
      expect(result.applicationId).toBeDefined();
      expect(result.finalState).toBe('SUBMITTED');

      const events = await prisma.eventLedger.findMany({
        where: { jobId: job.id },
        orderBy: { timestamp: 'asc' },
      });

      expect(events.length).toBeGreaterThan(0);
      const types = events.map((e) => e.type);
      expect(types).toContain('STATE_CHANGE');
    }, 20000);
  });
});
