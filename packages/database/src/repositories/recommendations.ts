import { prisma } from "../client";

export async function getRecommendationKeywords(userId: string): Promise<string[]> {
  const profile = await prisma.masterProfile.findUnique({ where: { userId }, select: { recommendationKeywords: true } });
  return profile?.recommendationKeywords ?? [];
}

export async function saveRecommendationKeywords(userId: string, keywords: string[]) {
  await prisma.masterProfile.upsert({
    where: { userId },
    update: { recommendationKeywords: keywords },
    create: { userId, recommendationKeywords: keywords },
  });
}

/**
 * Jobs that could be recommended: saved, not applied to or skipped. Which
 * Not Qualified jobs stay in is decided from their qualification checks.
 * The newest 1,000 are considered; ranking happens in @autoapply/matching.
 */
export async function listRecommendationCandidates(userId: string) {
  return prisma.job.findMany({
    where: { userId, deletedAt: null, application: null, status: { in: ["IMPORTED", "ANALYZING", "NEEDS_DETAILS", "QUALIFIED", "NOT_QUALIFIED"] } },
    orderBy: { savedAt: "desc" },
    take: 1000,
    select: {
      id: true,
      title: true,
      company: true,
      location: true,
      description: true,
      matchScore: true,
      status: true,
      qualification: true,
      savedAt: true,
      platform: true,
      workArrangement: true,
      salaryMin: true,
      salaryMax: true,
      salaryCurrency: true,
      salaryPeriod: true,
      sourceType: true,
    },
  });
}
export type RecommendationCandidateRow = Awaited<ReturnType<typeof listRecommendationCandidates>>[number];
