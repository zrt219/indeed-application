import { NextResponse } from "next/server";
import { prisma } from "@/db/prisma";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status");
    const source = searchParams.get("source");

    const whereClause: { status?: string; source?: string } = {};
    if (status) whereClause.status = status;
    if (source) whereClause.source = source;

    const applications = await prisma.application.findMany({
      where: whereClause,
      orderBy: { updatedAt: "desc" },
      include: {
        job: true,
        events: {
          orderBy: { timestamp: "desc" },
          take: 5
        }
      }
    });

    return NextResponse.json({ success: true, data: applications });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      jobId,
      url,
      title,
      employer,
      status = "APPLICATION_STARTED",
      source = "MANUAL",
      notes,
      confirmationText,
      followUpDate
    } = body;

    let targetJobId = jobId;

    // 1. If jobId not provided directly, find or create job by URL
    if (!targetJobId && url) {
      let job = await prisma.job.findUnique({ where: { url } });
      if (!job) {
        job = await prisma.job.create({
          data: {
            title: title || "Job Listing",
            employer: employer || "Unknown Employer",
            url,
            source: source,
            status: status === "SUBMISSION_CONFIRMED" ? "SUBMITTED" : "QUEUED"
          }
        });
      }
      targetJobId = job.id;
    }

    if (!targetJobId) {
      return NextResponse.json({ success: false, error: "Missing jobId or url" }, { status: 400 });
    }

    // 2. Find existing application or create new
    let application = await prisma.application.findFirst({
      where: { jobId: targetJobId }
    });

    if (application) {
      // Update existing application
      application = await prisma.application.update({
        where: { id: application.id },
        data: {
          status,
          source,
          submittedAt: status === "SUBMISSION_CONFIRMED" ? new Date() : application.submittedAt,
          confirmationText: confirmationText || application.confirmationText,
          followUpDate: followUpDate ? new Date(followUpDate) : application.followUpDate
        }
      });
    } else {
      // Create new application
      application = await prisma.application.create({
        data: {
          jobId: targetJobId,
          status,
          source,
          submittedAt: status === "SUBMISSION_CONFIRMED" ? new Date() : undefined,
          confirmationText,
          followUpDate: followUpDate ? new Date(followUpDate) : undefined
        }
      });
    }

    // Update job status to match
    await prisma.job.update({
      where: { id: targetJobId },
      data: {
        status: status === "SUBMISSION_CONFIRMED" ? "SUBMITTED" : status
      }
    });

    // 3. Create Immutable EventLedger Record
    await prisma.eventLedger.create({
      data: {
        jobId: targetJobId,
        applicationId: application.id,
        source,
        type: status,
        metadata: JSON.stringify({
          notes,
          source,
          status,
          timestamp: new Date().toISOString()
        })
      }
    });

    return NextResponse.json({ success: true, data: application }, { status: 200 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
