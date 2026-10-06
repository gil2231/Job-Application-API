import { prisma } from "../client";

export async function listJobSources(userId: string) {
  const sources = await prisma.jobSource.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
    include: { _count: { select: { jobs: { where: { deletedAt: null } } } } },
  });
  return sources.map((s) => ({
    id: s.id,
    type: s.type,
    name: s.name,
    enabled: s.enabled,
    lastSyncedAt: s.lastSyncedAt,
    lastError: s.lastError,
    jobCount: s._count.jobs,
  }));
}
