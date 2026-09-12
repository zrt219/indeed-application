import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/db/prisma';
export async function GET() {
  try {
    const isCloud = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
    let workerStatus = {
      isRunning: false,
      activeJobsCount: 0,
      mode: isCloud ? 'cloud-dashboard' : 'local-node',
      message: isCloud
        ? 'Playwright worker runs on local host machine'
        : 'Worker idle. Run `npm run worker` to start processing.',
    };

    if (!isCloud) {
      try {
        const { getWorkerStatus } = await import('@/queue/worker');
        workerStatus = { ...workerStatus, ...getWorkerStatus() };
      } catch {
        // Fall back to default status if worker module unavailable
      }
    }

    const [queuedJobs, queuedCount] = await Promise.all([
      prisma.job.findMany({
        where: { status: 'QUEUED' },
        orderBy: [{ fitScore: 'desc' }, { createdAt: 'asc' }],
        take: 20,
      }),
      prisma.job.count({ where: { status: 'QUEUED' } }),
    ]);

    return NextResponse.json({
      success: true,
      data: {
        worker: workerStatus,
        queuedCount,
        jobs: queuedJobs,
      },
    });
  } catch (error) {
    console.error('Error fetching queue:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch queue status' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, jobId, batchSize = 3 } = body;
    const isCloud = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);

    if (action === 'process-next') {
      if (isCloud) {
        return NextResponse.json(
          {
            success: false,
            error: 'Playwright browser automation runs locally. Run `npm run worker` on your local machine.',
          },
          { status: 400 }
        );
      }
      const { processNextJob } = await import('@/queue/worker');
      const processed = await processNextJob();
      return NextResponse.json({
        success: true,
        processed,
        message: processed ? 'Processed 1 job' : 'No jobs in queue',
      });
    }

    if (action === 'process-batch') {
      if (isCloud) {
        return NextResponse.json(
          {
            success: false,
            error: 'Playwright browser automation runs locally. Run `npm run worker` on your local machine.',
          },
          { status: 400 }
        );
      }
      const { processQueueBatch } = await import('@/queue/worker');
      const result = await processQueueBatch(batchSize);
      return NextResponse.json({
        success: true,
        ...result,
        message: `Processed ${result.processed} jobs. ${result.remaining} remaining.`,
      });
    }

    if (action === 'requeue' && jobId) {
      const job = await prisma.job.update({
        where: { id: jobId },
        data: { status: 'QUEUED' },
      });

      await prisma.eventLedger.create({
        data: {
          jobId: job.id,
          type: 'STATE_CHANGE',
          metadata: JSON.stringify({ action: 'manual_requeue', newStatus: 'QUEUED' }),
        },
      });

      return NextResponse.json({
        success: true,
        message: 'Job requeued successfully',
        data: job,
      });
    }

    return NextResponse.json(
      { success: false, error: 'Invalid queue action' },
      { status: 400 }
    );
  } catch (error) {
    console.error('Error in queue action:', error);
    return NextResponse.json(
      { success: false, error: 'Queue action failed' },
      { status: 500 }
    );
  }
}
