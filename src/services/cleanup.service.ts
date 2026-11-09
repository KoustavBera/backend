import { prisma } from "../db/prisma";
import { StorageService } from "./storage.service";
import { recordAuditLog } from "./audit.service";
import { DeletionStatus } from "@prisma/client";

export class CleanupService {
  // ── 1. Drain Pending Deletions Queue (Exponential Backoff) ───────────────────
  static async drainPendingDeletions(): Promise<number> {
    const now = new Date();

    const pendingTasks = await prisma.pendingDeletion.findMany({
      where: {
        status: { in: [DeletionStatus.pending, DeletionStatus.failed] },
        nextAttemptAt: { lte: now },
        attemptCount: { lt: 5 },
      },
      take: 25,
      orderBy: { nextAttemptAt: "asc" },
    });

    let successCount = 0;

    for (const task of pendingTasks) {
      try {
        await StorageService.deleteObject(task.objectKey);

        await prisma.pendingDeletion.update({
          where: { id: task.id },
          data: {
            status: DeletionStatus.completed,
            updatedAt: new Date(),
          },
        });
        successCount++;
      } catch (err) {
        const nextAttemptCount = task.attemptCount + 1;
        const isPermanentFailure = nextAttemptCount >= task.maxAttempts;

        // Exponential backoff: 2^attempt minutes (1m, 2m, 4m, 8m, 16m)
        const backoffMinutes = Math.pow(2, task.attemptCount);
        const nextAttemptAt = new Date(Date.now() + backoffMinutes * 60 * 1000);

        await prisma.pendingDeletion.update({
          where: { id: task.id },
          data: {
            attemptCount: nextAttemptCount,
            status: isPermanentFailure ? DeletionStatus.failed : DeletionStatus.pending,
            nextAttemptAt,
            lastError: (err as Error).message,
            updatedAt: new Date(),
          },
        });

        if (isPermanentFailure) {
          console.error(
            `💥 Permanent R2 deletion failure for object ${task.objectKey} after ${nextAttemptCount} attempts`
          );
          await recordAuditLog({
            action: "system.r2_deletion_permanent_failure",
            entityType: "PendingDeletion",
            entityId: task.id,
            metadata: {
              objectKey: task.objectKey,
              attempts: nextAttemptCount,
              error: (err as Error).message,
            },
          });
        }
      }
    }

    return successCount;
  }

  // ── 2. Purge Abandoned Upload Intents ────────────────────────────────────────
  static async purgeExpiredIntents(): Promise<number> {
    // Purge intents unfinalized after 24 hours past expiry
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const result = await prisma.uploadIntent.deleteMany({
      where: {
        finalizedAt: null,
        expiresAt: { lt: cutoff },
      },
    });

    return result.count;
  }

  // ── 3. Start In-Process Background Worker Interval ───────────────────────────
  static startWorker(intervalMs = 10 * 60 * 1000): NodeJS.Timeout {
    console.log("🧹 Cleanup service background worker initialized (10m interval)");

    const timer = setInterval(async () => {
      try {
        const deleted = await CleanupService.drainPendingDeletions();
        const purged = await CleanupService.purgeExpiredIntents();
        if (deleted > 0 || purged > 0) {
          console.log(
            `🧹 Cleanup run: ${deleted} file deletions processed, ${purged} expired upload intents purged.`
          );
        }
      } catch (err) {
        console.error("⚠️ Cleanup worker iteration failed:", (err as Error).message);
      }
    }, intervalMs);

    // Don't prevent process from exiting cleanly
    if (timer.unref) timer.unref();
    return timer;
  }
}

