import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/db/prisma';
import { getWorkerStatus, processNextJob, processQueueBatch } from '@/queue/worker';

export async function GET() {
  try {
    const [queuedJobs, workerStatus, queuedCount] = await Promise.all([
      prisma.job.findMany({
        where: { status: 'QUEUED' },
        orderBy: [{ fitScore: 'desc' }, { createdAt: 'asc' }],
        take: 20,
      }),
      getWorkerStatus(),
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

    if (action === 'process-next') {
      const processed = await processNextJob();
      return NextResponse.json({
        success: true,
        processed,
        message: processed ? 'Processed 1 job' : 'No jobs in queue',
      });
    }

    if (action === 'process-batch') {
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
