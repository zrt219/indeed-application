import { prisma } from "../db/prisma";

export class OutboxSyncWorker {
  private isRunning: boolean = false;
  private syncEndpoint: string;
  private authToken: string;

  constructor() {
    this.syncEndpoint =
      process.env.TURSO_SYNC_ENDPOINT ||
      "https://job-application-agent-kohl.vercel.app/api/sync";
    this.authToken = process.env.SYNC_SECRET_TOKEN || "default-local-sync-token";
  }

  async start() {
    this.isRunning = true;
    console.log(`[OutboxSyncWorker] Started. Syncing outbox events to ${this.syncEndpoint}`);

    while (this.isRunning) {
      try {
        await this.syncBatch();
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`[OutboxSyncWorker] Error during sync cycle:`, message);
      }

      // Idle sleep 5 seconds between checks
      await new Promise((res) => setTimeout(res, 5000));
    }
  }

  stop() {
    this.isRunning = false;
    console.log(`[OutboxSyncWorker] Stopping gracefully...`);
  }

  async syncBatch() {
    // 1. Find unsynced events (limit 25 per batch)
    const pendingEvents = await prisma.outboxEvent.findMany({
      where: {
        syncedAt: null,
        syncAttempts: { lt: 10 } // Cap maximum retries before cooling off
      },
      orderBy: { createdAt: "asc" },
      take: 25
    });

    if (pendingEvents.length === 0) return;

    console.log(`[OutboxSyncWorker] Found ${pendingEvents.length} pending events to sync.`);

    // 2. Transmit batch to cloud endpoint
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);

      const response = await fetch(this.syncEndpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${this.authToken}`
        },
        body: JSON.stringify({
          events: pendingEvents.map((evt) => ({
            id: evt.id,
            eventType: evt.eventType,
            source: evt.source,
            payload: evt.payload,
            createdAt: evt.createdAt.toISOString()
          }))
        }),
        signal: controller.signal
      });

      clearTimeout(timeout);

      if (response.ok) {
        const now = new Date();
        const eventIds = pendingEvents.map((e) => e.id);

        // 3. Mark as synchronized
        await prisma.outboxEvent.updateMany({
          where: { id: { in: eventIds } },
          data: {
            syncedAt: now,
            lastSyncError: null
          }
        });

        // Update sync state summary
        await prisma.syncState.upsert({
          where: { id: "singleton" },
          create: {
            id: "singleton",
            lastSyncedAt: now,
            totalSynced: pendingEvents.length,
            lastError: null
          },
          update: {
            lastSyncedAt: now,
            totalSynced: { increment: pendingEvents.length },
            lastError: null
          }
        });

        console.log(`[OutboxSyncWorker] Successfully synced ${pendingEvents.length} events.`);
      } else {
        const errorText = await response.text().catch(() => "Unknown response error");
        throw new Error(`Cloud server returned HTTP ${response.status}: ${errorText}`);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[OutboxSyncWorker] Cloud sync failed (will retry): ${message}`);

      // Exponential backoff attempt increment
      for (const event of pendingEvents) {
        await prisma.outboxEvent.update({
          where: { id: event.id },
          data: {
            syncAttempts: { increment: 1 },
            lastSyncError: message
          }
        });
      }
    }
  }
}

// Standalone execution if run directly
if (require.main === module) {
  const worker = new OutboxSyncWorker();
  process.on("SIGINT", () => worker.stop());
  process.on("SIGTERM", () => worker.stop());
  worker.start();
}
