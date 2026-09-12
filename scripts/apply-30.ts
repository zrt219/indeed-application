import { IndeedSearchCrawler } from '../src/engine/discovery/indeed-search';
import { ApplicationWorkflowEngine } from '../src/engine/workflow';
import { BrowserManager } from '../src/engine/browser/browser';
import { OutboxSyncWorker } from '../src/sync/outbox-worker';
import { prisma } from '../src/db/prisma';

async function main() {
  console.log('====================================================');
  console.log('🚀 STARTING 30-JOB INDEED AUTONOMOUS APPLICATION RUN');
  console.log('====================================================\n');

  // Step 1: Discover & Ingest 30 Qualified Positions
  console.log('📌 STEP 1: Discovering & Scoring 30+ Tech Positions on Indeed...');
  const crawler = new IndeedSearchCrawler();
  const discoveryResult = await crawler.discoverAndQueue({
    targetCount: 32,
    minFitScore: 50,
  });

  console.log(`\nDiscovered: ${discoveryResult.discoveredCount} jobs.`);
  console.log(`Queued: ${discoveryResult.queuedCount} jobs meeting qualification criteria.\n`);

  // Step 2: Fetch 30 Queued Jobs from Database
  const jobsToApply = await prisma.job.findMany({
    where: { status: 'QUEUED' },
    orderBy: [{ fitScore: 'desc' }, { createdAt: 'asc' }],
    take: 30,
  });

  console.log(`📌 STEP 2: Selected ${jobsToApply.length} jobs for automated application execution.\n`);

  if (jobsToApply.length === 0) {
    console.log('No queued jobs found to process.');
    return;
  }

  // Step 3: Execute Playwright Application Loop
  const browserManager = new BrowserManager({ headless: true });
  const engine = new ApplicationWorkflowEngine(browserManager);

  let successCount = 0;
  let actionNeededCount = 0;
  let failedCount = 0;

  console.log('📌 STEP 3: Executing Application Workflow State Machine...\n');

  for (let i = 0; i < jobsToApply.length; i++) {
    const job = jobsToApply[i];
    console.log(`[${i + 1}/${jobsToApply.length}] Processing: "${job.title}" @ "${job.employer}" (Fit: ${job.fitScore}%)`);

    try {
      const result = await engine.executeApplication(job.id);
      if (result.success) {
        successCount++;
        console.log(`   ✅ Status: ${result.finalState} | Confirmation: ${result.confirmationText || 'Submitted'}`);
      } else {
        if (result.finalState === 'BLOCKED_REQUIRES_MANUAL_ACTION') {
          actionNeededCount++;
          console.log(`   ⚠️ Status: ${result.finalState} | Reason: ${result.error || 'Manual action required'}`);
        } else {
          failedCount++;
          console.log(`   ❌ Status: ${result.finalState} | Error: ${result.error || 'Application halted'}`);
        }
      }
    } catch (err: unknown) {
      failedCount++;
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`   💥 Unexpected error on job ${job.id}:`, msg);
    }

    // Brief polite pause between applications
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  await browserManager.close();

  // Step 4: Synchronize All Events with Production Cloud Dashboard
  console.log('\n📌 STEP 4: Synchronizing Application Ledger with Vercel Cloud Dashboard...');
  const syncWorker = new OutboxSyncWorker();
  let syncCycles = 0;
  while (syncCycles < 10) {
    const pending = await prisma.outboxEvent.count({ where: { syncedAt: null } });
    if (pending === 0) break;
    await syncWorker.syncBatch();
    syncCycles++;
  }
  const remainingPending = await prisma.outboxEvent.count({ where: { syncedAt: null } });
  console.log(`   ☁️ Cloud Sync Completed: ${remainingPending === 0 ? 'All' : 'Batch'} outbox events transmitted to Vercel.`);

  // Step 5: Summary Report
  console.log('\n====================================================');
  console.log('📊 APPLICATION BATCH EXECUTION SUMMARY');
  console.log('====================================================');
  console.log(`Total Target Jobs:    ${jobsToApply.length}`);
  console.log(`Successfully Submitted: ${successCount}`);
  console.log(`Action Needed / Escalated: ${actionNeededCount}`);
  console.log(`Outbox Events Synced:  ${remainingPending === 0 ? 'All Synced' : remainingPending + ' pending'}`);
  console.log('====================================================\n');
}

main()
  .catch((e) => {
    console.error('Fatal error in application runner:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
