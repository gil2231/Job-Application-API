import { beforeEach, describe, expect, it } from "vitest";
import { manualJobSchema, publicSupportRequestSchema, supportRequestSchema } from "@autoapply/shared";
import { prisma } from "../src/client";
import { createManualJob } from "../src/repositories/jobs";
import { queueApplications } from "../src/repositories/applications";
import { countOpenSupportRequests, createSupportRequest, listAdminSupportRequests, listSupportRequests, setSupportRequestStatus } from "../src/repositories/support";
import { makeUser, resetDatabase } from "./helpers";

beforeEach(resetDatabase);

async function makeApp(userId: string) {
  const job = await createManualJob(userId, manualJobSchema.parse({ url: `https://example.com/jobs/${Date.now()}`, title: "Analyst", company: "Acme" }), "GENERIC");
  await queueApplications(userId, [job.id]);
  return prisma.application.findUniqueOrThrow({ where: { jobId: job.id } });
}

const base = { category: "BUG" as const, subject: "Upload fails", message: "The resume upload spins forever." };

describe("support requests", () => {
  it("stores a signed-in report with its application", async () => {
    const user = await makeUser();
    const app = await makeApp(user.id);
    await createSupportRequest({ ...base, userId: user.id, email: user.email, applicationId: app.id, pagePath: "/applications/x" });
    const [saved] = await listSupportRequests(user.id);
    expect(saved).toMatchObject({ subject: "Upload fails", status: "OPEN" });
    const row = await prisma.supportRequest.findFirstOrThrow({ where: { userId: user.id } });
    expect(row.applicationId).toBe(app.id);
  });

  it("drops an application id that belongs to someone else", async () => {
    const owner = await makeUser("Owner");
    const other = await makeUser("Other");
    const app = await makeApp(owner.id);
    await createSupportRequest({ ...base, userId: other.id, email: other.email, applicationId: app.id });
    const row = await prisma.supportRequest.findFirstOrThrow({ where: { userId: other.id } });
    expect(row.applicationId).toBeNull();
  });

  it("accepts signed-out reports and lists them for admins until resolved", async () => {
    const admin = await makeUser("Admin");
    const older = await createSupportRequest({ ...base, category: "ACCOUNT", userId: null, email: "locked@example.com", name: "Locked Out" });
    const newer = await createSupportRequest({ ...base, category: "BILLING", userId: null, email: "pay@example.com" });
    expect((await listAdminSupportRequests()).items.map((r) => r.id)).toEqual([older.id, newer.id]);
    expect((await listAdminSupportRequests({ category: "BILLING" })).items.map((r) => r.id)).toEqual([newer.id]);
    expect(await countOpenSupportRequests()).toBe(2);

    await setSupportRequestStatus(admin.id, older.id, "RESOLVED");
    expect((await listAdminSupportRequests()).items.map((r) => r.id)).toEqual([newer.id]);
    const resolved = await listAdminSupportRequests({ status: "resolved" });
    expect(resolved.items[0]).toMatchObject({ id: older.id, status: "RESOLVED" });
    expect(resolved.items[0]!.resolvedAt).toBeInstanceOf(Date);
    expect(await prisma.auditLog.count({ where: { userId: admin.id, action: "admin.support_resolved" } })).toBe(1);

    await setSupportRequestStatus(admin.id, older.id, "OPEN");
    expect(await countOpenSupportRequests()).toBe(2);
    await expect(setSupportRequestStatus(admin.id, "missingid000000000000", "RESOLVED")).rejects.toThrow("Report not found");
  });

  it("deletes a user's reports with the account", async () => {
    const user = await makeUser();
    await createSupportRequest({ ...base, userId: user.id, email: user.email });
    await prisma.user.delete({ where: { id: user.id } });
    expect(await prisma.supportRequest.count()).toBe(0);
  });
});

describe("support request validation", () => {
  it("keeps only the path of the page a report came from", () => {
    const parsed = supportRequestSchema.parse({ ...base, pagePath: "/jobs?q=secret#x" });
    expect(parsed.pagePath).toBe("/jobs");
    expect(supportRequestSchema.parse({ ...base, pagePath: "https://evil.example/" }).pagePath).toBeUndefined();
  });

  it("asks for enough detail and a reply address", () => {
    expect(supportRequestSchema.safeParse({ ...base, message: "broken" }).success).toBe(false);
    expect(publicSupportRequestSchema.safeParse({ ...base, email: "nope" }).success).toBe(false);
    expect(publicSupportRequestSchema.parse({ ...base, email: " Me@Example.com ", name: "" })).toMatchObject({ email: "me@example.com", name: undefined });
  });
});
