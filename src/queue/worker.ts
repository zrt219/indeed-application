import { prisma } from '../db/prisma';
import { ApplicationWorkflowEngine } from '../engine/workflow';

export interface WorkerStatus {
  isRunning: boolean;
  activeJobsCount: number;
  lastProcessedAt?: Date;
  processedCount: number;
  failedCount: number;
  currentJobId?: string;
}

let isWorkerActive = false;
let shouldStop = false;
let processedCount = 0;
let failedCount = 0;
let currentJobId: string | undefined;
let lastProcessedAt: Date | undefined;

export function getWorkerStatus(): WorkerStatus {
  return {
    isRunning: isWorkerActive,
    activeJobsCount: isWorkerActive ? 1 : 0,
    lastProcessedAt,
    processedCount,
    failedCount,
    currentJobId,
  };
}

/**
 * Process a single queued job
 */
export async function processNextJob(workflowEngine?: ApplicationWorkflowEngine): Promise<boolean> {
  const engine = workflowEngine || new ApplicationWorkflowEngine();

  // Find next queued job with highest fitScore first
  const nextJob = await prisma.job.findFirst({
    where: { status: 'QUEUED' },
    orderBy: [{ fitScore: 'desc' }, { createdAt: 'asc' }],
  });

  if (!nextJob) {
    return false;
  }

  currentJobId = nextJob.id;
  lastProcessedAt = new Date();

  console.log(`[Worker] Processing Job: "${nextJob.title}" at "${nextJob.employer}" (Fit: ${nextJob.fitScore})`);

  try {
    const result = await engine.executeApplication(nextJob.id);
    if (result.success) {
      processedCount++;
      console.log(`[Worker] Job ${nextJob.id} successfully completed with status ${result.finalState}`);
    } else {
      failedCount++;
      console.warn(`[Worker] Job ${nextJob.id} finished with status ${result.finalState}: ${result.error}`);
    }
  } catch (err) {
    failedCount++;
    console.error(`[Worker] Unhandled error processing job ${nextJob.id}:`, err);
  } finally {
    currentJobId = undefined;
    if (!workflowEngine) {
      await engine.close();
    }
  }

  return true;
}

/**
 * Process all currently queued jobs until queue is empty
 */
export async function processQueueBatch(maxBatch = 10): Promise<{ processed: number; remaining: number }> {
  const engine = new ApplicationWorkflowEngine();
  let count = 0;

  try {
    while (count < maxBatch) {
      const hasJob = await processNextJob(engine);
      if (!hasJob) break;
      count++;
    }
  } finally {
    await engine.close();
  }

  const remaining = await prisma.job.count({ where: { status: 'QUEUED' } });
  return { processed: count, remaining };
}

/**
 * Continuous polling worker loop
 */
export async function runWorkerLoop(pollIntervalMs = 5000): Promise<void> {
  if (isWorkerActive) {
    console.log('[Worker] Worker loop already running.');
    return;
  }

  isWorkerActive = true;
  shouldStop = false;
  console.log(`[Worker] Starting background worker loop (interval: ${pollIntervalMs}ms)...`);

  const engine = new ApplicationWorkflowEngine();

  const handleShutdown = async () => {
    console.log('\n[Worker] Gracefully shutting down worker...');
    shouldStop = true;
    await engine.close();
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on('SIGINT', handleShutdown);
  process.on('SIGTERM', handleShutdown);

  try {
    while (!shouldStop) {
      const processed = await processNextJob(engine);
      if (!processed) {
        // Sleep before polling again
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      }
    }
  } catch (err) {
    console.error('[Worker] Fatal error in worker loop:', err);
  } finally {
    isWorkerActive = false;
    await engine.close();
  }
}

// Allow direct CLI execution
if (require.main === module) {
  runWorkerLoop().catch((err) => {
    console.error('[Worker] Failed to start:', err);
    process.exit(1);
  });
}
