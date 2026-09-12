import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/db/prisma';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const jobId = searchParams.get('jobId');
    const applicationId = searchParams.get('applicationId');
    const type = searchParams.get('type');
    const limit = parseInt(searchParams.get('limit') || '100', 10);

    const where: Record<string, unknown> = {};
    if (jobId) where.jobId = jobId;
    if (applicationId) where.applicationId = applicationId;
    if (type) where.type = type;

    const [events, totalCount, typeCounts] = await Promise.all([
      prisma.eventLedger.findMany({
        where,
        orderBy: { timestamp: 'desc' },
        take: limit,
        include: {
          job: { select: { title: true, employer: true, url: true } },
          application: { select: { status: true, submittedAt: true } },
        },
      }),
      prisma.eventLedger.count({ where }),
      prisma.eventLedger.groupBy({
        by: ['type'],
        _count: { _all: true },
      }),
    ]);

    const parsedEvents = events.map((e) => {
      let parsedMetadata: Record<string, unknown> = {};
      try {
        parsedMetadata = JSON.parse(e.metadata);
      } catch {
        parsedMetadata = { raw: e.metadata };
      }
      return {
        ...e,
        metadata: parsedMetadata,
      };
    });

    const breakdown: Record<string, number> = {};
    typeCounts.forEach((tc) => {
      breakdown[tc.type] = tc._count._all;
    });

    return NextResponse.json({
      success: true,
      data: parsedEvents,
      total: totalCount,
      typeBreakdown: breakdown,
    });
  } catch (error) {
    console.error('Error fetching ledger events:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch ledger events' },
      { status: 500 }
    );
  }
}
