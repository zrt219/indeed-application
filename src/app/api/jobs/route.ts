import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/db/prisma';
import { calculateFitScore } from '@/qualification/engine';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status');
    const minFit = searchParams.get('minFit');
    const limit = parseInt(searchParams.get('limit') || '50', 10);

    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (minFit) where.fitScore = { gte: parseInt(minFit, 10) };

    const [jobs, totalCount, stats] = await Promise.all([
      prisma.job.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        include: {
          applications: true,
          manualReviews: { where: { status: 'PENDING' } },
        },
      }),
      prisma.job.count({ where }),
      prisma.job.groupBy({
        by: ['status'],
        _count: { _all: true },
      }),
    ]);

    const statusCounts: Record<string, number> = {};
    stats.forEach((s) => {
      statusCounts[s.status] = s._count._all;
    });

    return NextResponse.json({
      success: true,
      data: jobs,
      total: totalCount,
      summary: statusCounts,
    });
  } catch (error) {
    console.error('Error fetching jobs:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch jobs' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { url, title, employer, location, description, autoQueue = true } = body;

    if (!url) {
      return NextResponse.json(
        { success: false, error: 'Job URL is required' },
        { status: 400 }
      );
    }

    // Check duplicate
    const existing = await prisma.job.findUnique({
      where: { url },
      include: { applications: true },
    });

    if (existing) {
      return NextResponse.json(
        {
          success: true,
          message: 'Job already exists in database',
          data: existing,
          isDuplicate: true,
        },
        { status: 200 }
      );
    }

    // Derive title / employer fallback if not provided
    const jobTitle = title || 'Software Engineer';
    const jobEmployer = employer || 'Tech Company';

    // Qualification Engine
    const evalResult = calculateFitScore({
      title: jobTitle,
      employer: jobEmployer,
      location,
      description,
      url,
    });

    let initialStatus = 'ANALYZED';
    if (evalResult.isExcluded) {
      initialStatus = 'REJECTED';
    } else if (autoQueue && evalResult.fitScore >= 50) {
      initialStatus = 'QUEUED';
    }

    const job = await prisma.job.create({
      data: {
        url,
        title: jobTitle,
        employer: jobEmployer,
        location: location || 'Remote / Unspecified',
        description: description || '',
        fitScore: evalResult.fitScore,
        status: initialStatus,
      },
    });

    // Immutable Event Ledger
    await prisma.eventLedger.create({
      data: {
        jobId: job.id,
        type: 'FIT_EVALUATED',
        metadata: JSON.stringify({
          fitScore: evalResult.fitScore,
          isExcluded: evalResult.isExcluded,
          breakdown: evalResult.breakdown,
          recommendation: evalResult.recommendation,
          matchedSkills: evalResult.matchedSkills,
        }),
      },
    });

    if (initialStatus === 'QUEUED') {
      await prisma.eventLedger.create({
        data: {
          jobId: job.id,
          type: 'STATE_CHANGE',
          metadata: JSON.stringify({ from: 'NEW', to: 'QUEUED', autoQueued: true }),
        },
      });
    }

    return NextResponse.json(
      {
        success: true,
        data: job,
        qualification: evalResult,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Error creating job:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to create job' },
      { status: 500 }
    );
  }
}
