import { prisma } from "../db/prisma";
import crypto from "crypto";

export interface OutboxPayload {
  jobId?: string;
  applicationId?: string;
  url?: string;
  title?: string;
  employer?: string;
  status?: string;
  source: "PLAYWRIGHT_AUTONOMOUS" | "CHROME_EXTENSION" | "MANUAL" | "IMPORT";
  eventType: string;
  data: Record<string, unknown>;
  timestamp: string;
}

/**
 * Commits an application lifecycle event to the local EventLedger
 * AND an OutboxEvent row in the same transaction for reliable background sync.
 */
export async function emitLifecycleEvent(
  eventType: string,
  source: "PLAYWRIGHT_AUTONOMOUS" | "CHROME_EXTENSION" | "MANUAL" | "IMPORT",
  payload: {
    jobId?: string;
    applicationId?: string;
    metadata?: Record<string, unknown>;
  }
) {
  const eventId = crypto.randomUUID();
  const timestamp = new Date();

  const fullPayload: OutboxPayload = {
    jobId: payload.jobId,
    applicationId: payload.applicationId,
    source,
    eventType,
    data: payload.metadata || {},
    timestamp: timestamp.toISOString()
  };

  const payloadString = JSON.stringify(fullPayload);

  // Write both in transaction
  return await prisma.$transaction([
    prisma.eventLedger.create({
      data: {
        id: eventId,
        type: eventType,
        source,
        jobId: payload.jobId,
        applicationId: payload.applicationId,
        metadata: payloadString,
        timestamp
      }
    }),
    prisma.outboxEvent.create({
      data: {
        id: eventId,
        eventType,
        source,
        payload: payloadString,
        createdAt: timestamp,
        syncedAt: null,
        syncAttempts: 0
      }
    })
  ]);
}
