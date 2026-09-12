import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/db/prisma';
import { calculateFitScore, loadDefaultProfile } from '@/qualification/engine';
import { emitLifecycleEvent } from '@/sync/outbox';
import { resolveJobMetadata } from '@/engine/discovery/job-resolver';
import { validateApiKey } from '../../middleware';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const authError = validateApiKey(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    let { url, title, employer, location, description } = body;

    if (!url) {
      return NextResponse.json({ error: 'url is required' }, { status: 400 });
    }

    // If title or description is missing/generic, resolve real metadata from the link
    if (!title || title === 'Unknown Position' || title.length < 3 || !description) {
      console.log(`[API /queue/add] Resolving real job metadata from URL: ${url}`);
      const resolved = await resolveJobMetadata(url, { title, employer, location, description });
      title = resolved.title;
      employer = resolved.employer || employer || 'Unknown';
      location = resolved.location || location;
      description = resolved.description || description;
    }

    // Check for duplicate
    const existing = await prisma.job.findUnique({ where: { url } });
    if (existing) {
      // If existing job has a generic title but we found a real one, update it!
      const isGeneric = !existing.title || existing.title === 'Unknown Position' || existing.title.startsWith('Indeed Position');
      if (isGeneric && title && title !== 'Unknown Position') {
        const profile = loadDefaultProfile();
        const qualification = calculateFitScore(
          { title, employer: employer || existing.employer, location: location || existing.location || undefined, description: description || existing.description || undefined, url },
          profile
        );

        const updated = await prisma.job.update({
          where: { url },
          data: {
            title,
            employer: employer || existing.employer,
            location: location || existing.location,
            description: description || existing.description,
            fitScore: qualification.fitScore,
          },
        });

        await emitLifecycleEvent('ANALYZED', 'CHROME_EXTENSION', {
          jobId: updated.id,
          metadata: { title, employer: updated.employer, fitScore: qualification.fitScore, updatedFromUrl: true },
        });

        return NextResponse.json({
          message: 'Job updated with real title and metadata from URL',
          job: updated,
          isNew: false,
          updated: true,
        });
      }

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
