import { NextRequest, NextResponse } from 'next/server';
import { calculateFitScore, checkHardExclusions, loadDefaultProfile } from '@/qualification/engine';
import { validateApiKey } from '../middleware';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const authError = validateApiKey(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    const { title, employer, location, description } = body;

    if (!title && !description) {
      return NextResponse.json(
        { error: 'At least one of title or description is required' },
        { status: 400 }
      );
    }

    const profile = loadDefaultProfile();
    const jobInput = {
      title: title || 'Unknown Position',
      employer: employer || undefined,
      location: location || undefined,
      description: description || '',
    };

    const result = calculateFitScore(jobInput, profile);
    const exclusion = checkHardExclusions(jobInput, profile);

    return NextResponse.json({
      fitScore: result.fitScore,
      recommendation: result.recommendation,
      matchedSkills: result.matchedSkills,
      missingSkills: result.missingSkills,
      isExcluded: exclusion.isExcluded,
      exclusionReasons: exclusion.reasons,
      breakdown: result.breakdown,
    });
  } catch (error) {
    console.error('[API /score] Error:', error);
    return NextResponse.json({ error: 'Failed to score job' }, { status: 500 });
  }
}
