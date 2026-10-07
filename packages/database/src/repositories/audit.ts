import type { Prisma } from "@prisma/client";
import { prisma } from "../client";
import { createLogger } from "@autoapply/shared";

const log = createLogger("audit");

export interface AuditContext {
  ipAddress?: string | null;
  userAgent?: string | null;
}

/**
 * Append an audit log entry. Never put secrets or sensitive answer values in
 * metadata. Failures are swallowed so auditing never breaks the user's action.
 */
export async function audit(
  userId: string | null,
  action: string,
  options: { entityType?: string; entityId?: string; metadata?: Prisma.InputJsonValue; context?: AuditContext } = {},
): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId,
        action,
        entityType: options.entityType,
        entityId: options.entityId,
        metadata: options.metadata,
        ipAddress: options.context?.ipAddress?.slice(0, 64),
        userAgent: options.context?.userAgent?.slice(0, 512),
      },
    });
  } catch (error) {
    log.error("Failed to write an audit log entry", { action, error });
  }
}

export async function listAuditLogs(userId: string, limit = 50) {
  return prisma.auditLog.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: Math.min(limit, 200),
    select: { id: true, action: true, entityType: true, entityId: true, ipAddress: true, createdAt: true, metadata: true },
  });
}
