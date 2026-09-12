import { NextResponse } from "next/server";
import { prisma } from "@/db/prisma";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { events } = body;

    if (!Array.isArray(events)) {
      return NextResponse.json({ success: false, error: "Invalid payload: events must be an array" }, { status: 400 });
    }

    let syncedCount = 0;

    for (const evt of events) {
      const eventId = evt.id || evt.eventId || crypto.randomUUID();
      const eventType = evt.eventType || "EVENT";
      const source = evt.source || "PLAYWRIGHT_AUTONOMOUS";
      const rawPayload = evt.payload;
      const createdAt = evt.createdAt;

      // Normalize payload string vs object
      let parsedPayload: Record<string, unknown> = {};
      let serializedPayload = "{}";
      if (typeof rawPayload === "string") {
        serializedPayload = rawPayload;
        try {
          parsedPayload = JSON.parse(rawPayload) as Record<string, unknown>;
        } catch {
          parsedPayload = {};
        }
      } else if (rawPayload && typeof rawPayload === "object") {
        parsedPayload = rawPayload as Record<string, unknown>;
        serializedPayload = JSON.stringify(rawPayload);
      }

      // 1. Check if event already exists (Idempotent by UUID)
      const existing = await prisma.eventLedger.findUnique({
        where: { id: eventId }
      });

      if (!existing) {
        // Upsert Job if URL present
        let targetJobId = parsedPayload.jobId as string | undefined;
        if (!targetJobId && parsedPayload.url) {
          const job = await prisma.job.upsert({
            where: { url: parsedPayload.url as string },
            create: {
              title: (parsedPayload.title as string) || "Discovered Opportunity",
              employer: (parsedPayload.employer as string) || "Unknown Employer",
              url: parsedPayload.url as string,
              source: source || "IMPORT",
              status: (parsedPayload.status as string) || "DISCOVERED"
            },
            update: {
              status: (parsedPayload.status as string) || undefined
            }
          });
          targetJobId = job.id;
        }

        // Create the event record
        await prisma.eventLedger.create({
          data: {
            id: eventId,
            type: eventType,
            source: source,
            jobId: targetJobId,
            applicationId: parsedPayload.applicationId as string | undefined,
            metadata: serializedPayload,
            timestamp: new Date(createdAt || Date.now())
          }
        });

        syncedCount++;
      }
    }

    return NextResponse.json({
      success: true,
      received: events.length,
      synced: syncedCount
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
