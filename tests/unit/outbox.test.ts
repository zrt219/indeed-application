import { describe, it, expect } from "vitest";
import { prisma } from "../../src/db/prisma";
import { emitLifecycleEvent } from "../../src/sync/outbox";

describe("Outbox Event-Queue Sync Subsystem", () => {
  it("should write event atomically to both EventLedger and OutboxEvent", async () => {
    const testJob = await prisma.job.create({
      data: {
        title: "Staff Platform Engineer",
        employer: "Cloud Innovations",
        url: `https://indeed.com/test-outbox-${Date.now()}`,
        source: "IMPORT",
        status: "QUEUED"
      }
    });

    const [ledgerEntry, outboxEntry] = await emitLifecycleEvent(
      "APPLICATION_STARTED",
      "PLAYWRIGHT_AUTONOMOUS",
      {
        jobId: testJob.id,
        metadata: {
          browser: "chromium",
          step: "INITIAL_DISCOVERY"
        }
      }
    );

    expect(ledgerEntry.id).toBe(outboxEntry.id);
    expect(ledgerEntry.type).toBe("APPLICATION_STARTED");
    expect(outboxEntry.source).toBe("PLAYWRIGHT_AUTONOMOUS");
    expect(outboxEntry.syncedAt).toBeNull();
    expect(outboxEntry.syncAttempts).toBe(0);

    // Verify stored in DB
    const foundOutbox = await prisma.outboxEvent.findUnique({
      where: { id: outboxEntry.id }
    });
    expect(foundOutbox).not.toBeNull();
  });
});
