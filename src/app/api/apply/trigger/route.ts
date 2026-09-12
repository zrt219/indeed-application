import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/db/prisma';
import { validateApiKey } from '../../middleware';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const authError = validateApiKey(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    const { jobId } = body;

    if (!jobId) {
      return NextResponse.json({ error: 'jobId is required' }, { status: 400 });
    }

    const job = await prisma.job.findUnique({ where: { id: jobId } });
    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 });
    }

    if (job.status === 'SUBMITTED') {
      return NextResponse.json({ error: 'Job already submitted', job }, { status: 409 });
    }

    // Update status to APPLYING to signal the local worker
    await prisma.job.update({
      where: { id: jobId },
      data: { status: 'APPLYING' },
    });

    return NextResponse.json({
      message: 'Application triggered. The local Playwright worker will process this job.',
      job: { ...job, status: 'APPLYING' },
    });
  } catch (error) {
    console.error('[API /apply/trigger] Error:', error);
    return NextResponse.json({ error: 'Failed to trigger application' }, { status: 500 });
  }
}
