import type { SupportCategory } from "@autoapply/shared";
import { prisma } from "../client";

export interface NewSupportRequest {
  userId: string | null;
  email: string;
  name?: string | null;
  category: SupportCategory;
  subject: string;
  message: string;
  pagePath?: string | null;
  applicationId?: string | null;
  userAgent?: string | null;
}

/**
 * Store a "Report a problem" message. An application id is kept only when it
 * belongs to the same user, so a report can never point at someone else's data.
 */
export async function createSupportRequest(input: NewSupportRequest) {
  let applicationId: string | null = null;
  if (input.userId && input.applicationId) {
    const owned = await prisma.application.findFirst({ where: { id: input.applicationId, userId: input.userId }, select: { id: true } });
    applicationId = owned?.id ?? null;
  }
  return prisma.supportRequest.create({
    data: {
      userId: input.userId,
      email: input.email,
      name: input.name ?? null,
      category: input.category,
      subject: input.subject,
      message: input.message,
      pagePath: input.pagePath ?? null,
      applicationId,
      userAgent: input.userAgent?.slice(0, 512) ?? null,
    },
    select: { id: true, createdAt: true },
  });
}

/** A user's own reports, newest first. */
export async function listSupportRequests(userId: string, limit = 20) {
  return prisma.supportRequest.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: Math.min(limit, 100),
    select: { id: true, category: true, subject: true, status: true, createdAt: true, resolvedAt: true },
  });
}

/** Every open report, oldest first, for whoever answers support (the owner admin panel). */
export async function listOpenSupportRequests(limit = 100) {
  return prisma.supportRequest.findMany({
    where: { status: "OPEN" },
    orderBy: { createdAt: "asc" },
    take: Math.min(limit, 500),
  });
}

export async function resolveSupportRequest(id: string) {
  return prisma.supportRequest.update({ where: { id }, data: { status: "RESOLVED", resolvedAt: new Date() }, select: { id: true } });
}
