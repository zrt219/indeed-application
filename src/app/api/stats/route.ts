import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/db/prisma';
import { validateApiKey } from '../middleware';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const authError = validateApiKey(request);
  if (authError) return authError;

  try {
    const [totalJobs, queued, submitted, actionNeeded, totalEvents] = await Promise.all([
      prisma.job.count(),
      prisma.job.count({ where: { status: 'QUEUED' } }),
      prisma.job.count({ where: { status: 'SUBMITTED' } }),
      prisma.job.count({ where: { status: 'REQUIRES_MANUAL_ACTION' } }),
      prisma.eventLedger.count(),
    ]);

    return NextResponse.json({
      totalJobs,
      queued,
      submitted,
      actionNeeded,
      totalEvents,
    });
  } catch (error) {
    console.error('[API /stats] Error:', error);
    return NextResponse.json({ error: 'Failed to fetch stats' }, { status: 500 });
  }
}
