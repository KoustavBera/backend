import { prisma } from "../db/prisma";

export type AuditParams = {
  userId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown> | null;
  ip?: string | null;
};

export async function recordAuditLog(params: AuditParams): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId: params.userId ?? null,
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId ?? null,
        metadata: (params.metadata as any) ?? undefined,
        ip: params.ip ?? null,
      },
    });
  } catch (error) {
    // Non-blocking log write failure so it doesn't break primary transactions unless necessary
    console.error("⚠️ Failed to record audit log:", (error as Error).message);
  }
}

