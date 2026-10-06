import type { SupportCategory, SupportStatus } from "@autoapply/shared";
import type { Prisma } from "@prisma/client";
import { prisma } from "../client";
import { audit, type AuditContext } from "./audit";
import { NotFoundError } from "./errors";

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

export const SUPPORT_PAGE_SIZE = 25;

export interface AdminSupportFilters {
  status?: "open" | "resolved" | "all";
  category?: SupportCategory;
  page?: number;
}

/**
 * Reports from every user for the owner admin panel. Open reports list oldest
 * first (answer in order); resolved ones newest first.
 */
export async function listAdminSupportRequests(filters: AdminSupportFilters = {}, take = SUPPORT_PAGE_SIZE) {
  const status = filters.status ?? "open";
  const page = Math.max(1, Math.floor(filters.page ?? 1));
  const where: Prisma.SupportRequestWhereInput = {
    ...(status === "open" ? { status: "OPEN" } : status === "resolved" ? { status: "RESOLVED" } : {}),
    ...(filters.category && { category: filters.category }),
  };
  const [total, items] = await Promise.all([
    prisma.supportRequest.count({ where }),
    prisma.supportRequest.findMany({
      where,
      orderBy: [{ createdAt: status === "open" ? "asc" : "desc" }, { id: "asc" }],
      skip: (page - 1) * take,
      take,
      select: {
        id: true,
        email: true,
        name: true,
        category: true,
        subject: true,
        message: true,
        pagePath: true,
        applicationId: true,
        userAgent: true,
        status: true,
        resolvedAt: true,
        createdAt: true,
        user: { select: { id: true, name: true } },
      },
    }),
  ]);
  return { total, page, pageCount: Math.max(1, Math.ceil(total / take)), items };
}

export async function countOpenSupportRequests() {
  return prisma.supportRequest.count({ where: { status: "OPEN" } });
}

/** Mark a report resolved, or reopen it. Audited as the admin who did it. */
export async function setSupportRequestStatus(adminId: string, id: string, status: SupportStatus, context?: AuditContext) {
  const existing = await prisma.supportRequest.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw new NotFoundError("Report not found");
  await prisma.supportRequest.update({ where: { id }, data: { status, resolvedAt: status === "RESOLVED" ? new Date() : null } });
  await audit(adminId, status === "RESOLVED" ? "admin.support_resolved" : "admin.support_reopened", { entityType: "SupportRequest", entityId: id, context });
}
