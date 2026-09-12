import crypto from 'crypto';
import { prisma } from '../../../src/db/prisma';

export interface SyncApiResponse {
  status: number;
  body: {
    success: boolean;
    received?: number;
    synced?: number;
    error?: string;
  };
}

/**
 * Executes the cloud sync ingestion logic locally using direct Prisma bindings,
 * adhering to the exact contract implemented in src/app/api/sync/route.ts
 */
export async function handleCloudSync(req: Request): Promise<SyncApiResponse> {
  try {
    const body = await req.json();
    const { events } = body;

    if (!Array.isArray(events)) {
      return {
        status: 400,
        body: { success: false, error: 'Invalid payload: events must be an array' },
      };
    }

    let syncedCount = 0;

    for (const evt of events) {
      const eventId = evt.id || evt.eventId || crypto.randomUUID();
      const eventType = evt.eventType || 'EVENT';
      const source = evt.source || 'PLAYWRIGHT_AUTONOMOUS';
      const rawPayload = evt.payload;
      const createdAt = evt.createdAt;

      // Normalize payload string vs object
      let parsedPayload: Record<string, unknown> = {};
      let serializedPayload = '{}';
      if (typeof rawPayload === 'string') {
        serializedPayload = rawPayload;
        try {
          parsedPayload = JSON.parse(rawPayload) as Record<string, unknown>;
        } catch {
          parsedPayload = {};
        }
      } else if (rawPayload && typeof rawPayload === 'object') {
        parsedPayload = rawPayload as Record<string, unknown>;
        serializedPayload = JSON.stringify(rawPayload);
      }

      // 1. Check if event already exists (Idempotent by UUID)
      const existing = await prisma.eventLedger.findUnique({
        where: { id: eventId },
      });

      if (!existing) {
        // Safe Job extraction and foreign-key resolution
        const jobData = (parsedPayload.data as Record<string, unknown>) || {};
        const jobUrl = (parsedPayload.url as string) || (jobData.url as string);
        const jobTitle =
          (parsedPayload.title as string) || (jobData.title as string) || 'Discovered Opportunity';
        const jobEmployer =
          (parsedPayload.employer as string) || (jobData.employer as string) || 'Unknown Employer';
        const jobStatus =
          (parsedPayload.status as string) ||
          (jobData.status as string) ||
          (jobData.to as string) ||
          'DISCOVERED';

        let targetJobId = parsedPayload.jobId as string | undefined;

        if (jobUrl) {
          try {
            const job = await prisma.job.upsert({
              where: { url: jobUrl },
              create: {
                ...(targetJobId ? { id: targetJobId } : {}),
                title: jobTitle,
                employer: jobEmployer,
                url: jobUrl,
                source: source || 'PLAYWRIGHT_AUTONOMOUS',
                status: jobStatus,
              },
              update: {
                status: jobStatus,
              },
            });
            targetJobId = job.id;
          } catch {
            const fallbackJob = await prisma.job.findUnique({ where: { url: jobUrl } });
            targetJobId = fallbackJob?.id;
          }
        } else if (targetJobId) {
          const existingJob = await prisma.job.findUnique({ where: { id: targetJobId } });
          if (!existingJob) {
            targetJobId = undefined;
          }
        }

        // Safe Application foreign-key resolution
        let targetAppId = parsedPayload.applicationId as string | undefined;
        if (targetAppId) {
          const existingApp = await prisma.application.findUnique({ where: { id: targetAppId } });
          if (!existingApp) {
            targetAppId = undefined;
          }
        }

        // Create the event record safely
        await prisma.eventLedger.create({
          data: {
            id: eventId,
            type: eventType,
            source: source,
            jobId: targetJobId || null,
            applicationId: targetAppId || null,
            metadata: serializedPayload,
            timestamp: new Date(createdAt || Date.now()),
          },
        });

        syncedCount++;
      }
    }

    return {
      status: 200,
      body: {
        success: true,
        received: events.length,
        synced: syncedCount,
      },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      status: 500,
      body: { success: false, error: message },
    };
  }
}
