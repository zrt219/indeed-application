import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/db/prisma';
import { calculateFitScore, loadDefaultProfile } from '@/qualification/engine';
import { emitLifecycleEvent } from '@/sync/outbox';
import { validateApiKey } from '../../middleware';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const authError = validateApiKey(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    const { url, title, employer, location, description } = body;

    if (!url) {
      return NextResponse.json({ error: 'url is required' }, { status: 400 });
    }

    // Check for duplicate
    const existing = await prisma.job.findUnique({ where: { url } });
    if (existing) {
      return NextResponse.json({
        message: 'Job already exists',
        job: existing,
        isNew: false,
      });
    }

    // Score against profile
    const profile = loadDefaultProfile();
    const qualification = calculateFitScore(
      { title: title || 'Unknown Position', employer, location, description, url },
      profile
    );

    // Create job in QUEUED state
    const job = await prisma.job.create({
      data: {
        title: title || 'Unknown Position',
        employer: employer || 'Unknown',
        location: location || undefined,
        description: description || undefined,
        url,
        fitScore: qualification.fitScore,
        status: 'QUEUED',
        source: 'CHROME_EXTENSION',
      },
    });

    // Emit lifecycle events
    await emitLifecycleEvent('DISCOVERED', 'CHROME_EXTENSION', {
      jobId: job.id,
      metadata: { title: job.title, employer: job.employer, fitScore: qualification.fitScore, url },
    });
    await emitLifecycleEvent('QUEUED', 'CHROME_EXTENSION', {
      jobId: job.id,
      metadata: { status: 'QUEUED', fitScore: qualification.fitScore, reason: 'Manually queued via Chrome extension' },
    });

    return NextResponse.json({
      message: 'Job queued successfully',
      job,
      qualification: {
        fitScore: qualification.fitScore,
        recommendation: qualification.recommendation,
        matchedSkills: qualification.matchedSkills,
      },
      isNew: true,
    });
  } catch (error) {
    console.error('[API /queue/add] Error:', error);
    return NextResponse.json({ error: 'Failed to queue job' }, { status: 500 });
  }
}
