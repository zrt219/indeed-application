import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import { prisma } from '@/db/prisma';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') || 'PENDING';

    const reviews = await prisma.manualReview.findMany({
      where: status === 'ALL' ? undefined : { status },
      orderBy: { createdAt: 'desc' },
      include: {
        job: { select: { id: true, title: true, employer: true, url: true } },
        application: { select: { id: true, status: true } },
      },
    });

    const pendingCount = await prisma.manualReview.count({ where: { status: 'PENDING' } });

    return NextResponse.json({
      success: true,
      pendingCount,
      data: reviews,
    });
  } catch (error) {
    console.error('Error fetching manual reviews:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch manual reviews' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { reviewId, resolvedAnswer, addToAnswerBank = true, category = 'CUSTOM' } = body;

    if (!reviewId || resolvedAnswer === undefined) {
      return NextResponse.json(
        { success: false, error: 'reviewId and resolvedAnswer are required' },
        { status: 400 }
      );
    }

    const review = await prisma.manualReview.findUnique({
      where: { id: reviewId },
      include: { job: true },
    });

    if (!review) {
      return NextResponse.json(
        { success: false, error: 'Manual review item not found' },
        { status: 404 }
      );
    }

    // 1. Update review record
    const updatedReview = await prisma.manualReview.update({
      where: { id: reviewId },
      data: {
        status: 'RESOLVED',
        resolvedAnswer: String(resolvedAnswer),
      },
    });

    // 2. Optionally add to answer-bank.json & AnswerBank table
    if (addToAnswerBank) {
      try {
        await prisma.answerBank.create({
          data: {
            category,
            question: review.question,
            answer: String(resolvedAnswer),
            confidence: 1.0,
            verified: true,
          },
        });

        const bankPath = path.resolve(process.cwd(), 'data', 'answer-bank.json');
        if (fs.existsSync(bankPath)) {
          const raw = fs.readFileSync(bankPath, 'utf-8');
          const bank = JSON.parse(raw);
          bank.push({
            id: `ans-manual-${Date.now()}`,
            category,
            patterns: [review.question.toLowerCase().trim()],
            answer: String(resolvedAnswer),
            confidence: 1.0,
            notes: 'Saved from manual review resolution',
          });
          fs.writeFileSync(bankPath, JSON.stringify(bank, null, 2), 'utf-8');
        }
      } catch (err) {
        console.warn('Failed to persist to answer bank:', err);
      }
    }

    // 3. If the job was blocked, check if there are remaining pending reviews for this job
    if (review.jobId) {
      const remainingForJob = await prisma.manualReview.count({
        where: { jobId: review.jobId, status: 'PENDING' },
      });

      if (remainingForJob === 0) {
        // Re-queue the job!
        await prisma.job.update({
          where: { id: review.jobId },
          data: { status: 'QUEUED' },
        });

        if (review.applicationId) {
          await prisma.application.update({
            where: { id: review.applicationId },
            data: { status: 'PENDING' },
          });
        }

        await prisma.eventLedger.create({
          data: {
            jobId: review.jobId,
            applicationId: review.applicationId,
            type: 'STATE_CHANGE',
            metadata: JSON.stringify({
              from: 'BLOCKED_REQUIRES_MANUAL_ACTION',
              to: 'QUEUED',
              reason: 'All pending manual reviews resolved',
            }),
          },
        });
      }
    }

    return NextResponse.json({
      success: true,
      data: updatedReview,
      message: 'Manual review resolved and job re-queued if ready.',
    });
  } catch (error) {
    console.error('Error resolving manual review:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to resolve manual review' },
      { status: 500 }
    );
  }
}
