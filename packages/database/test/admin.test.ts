import { beforeEach, describe, expect, it } from "vitest";
import { manualJobSchema } from "@autoapply/shared";
import { prisma } from "../src/client";
import { getAdminOverview, getAdminUserDetail, listAdminFailures, listAdminUsers, setUserRole } from "../src/repositories/admin";
import { authenticate, validateSessionToken, createSession } from "../src/repositories/auth";
import { queueApplications } from "../src/repositories/applications";
import { NotFoundError } from "../src/repositories/errors";
import { createManualJob } from "../src/repositories/jobs";
import { makeUser, resetDatabase } from "./helpers";

beforeEach(resetDatabase);

let n = 0;
async function makeApp(
  userId: string,
  data: { status?: "SUBMITTED" | "FAILED" | "WAITING_FOR_USER"; failureType?: "SITE_CHANGED" | "TIMEOUT"; lastError?: string; daysAgo?: number; url?: string } = {},
) {
  n += 1;
  const job = await createManualJob(
    userId,
    manualJobSchema.parse({ url: data.url ?? `https://www.boards.example.com/jobs/${n}`, title: `Engineer ${n}`, company: `Company ${n}` }),
    "GENERIC",
  );
  await queueApplications(userId, [job.id]);
  const app = await prisma.application.findUniqueOrThrow({ where: { jobId: job.id } });
  if (data.status) {
    await prisma.application.update({
      where: { id: app.id },
      data: {
        status: data.status,
        failureType: data.failureType,
        lastError: data.lastError,
        attentionReason: data.status === "WAITING_FOR_USER" ? "CAPTCHA" : undefined,
        submittedAt: data.status === "SUBMITTED" ? new Date() : undefined,
      },
    });
  }
  if (data.daysAgo) {
    const at = new Date(Date.now() - data.daysAgo * 24 * 3600 * 1000);
    await prisma.$executeRaw`UPDATE "Application" SET "updatedAt" = ${at} WHERE id = ${app.id}`;
  }
  return app;
}

describe("admin role", () => {
  it("is USER for new accounts and is granted and revoked by email", async () => {
    const user = await makeUser();
    const { token } = await createSession(user.id, {});
    expect((await validateSessionToken(token))?.user.role).toBe("USER");

    const granted = await setUserRole(`  ${user.email.toUpperCase()} `, "ADMIN");
    expect(granted.role).toBe("ADMIN");
    // The role is read from the database on every request, so no new sign-in is needed.
    expect((await validateSessionToken(token))?.user.role).toBe("ADMIN");
    expect(await prisma.auditLog.count({ where: { userId: user.id, action: "admin.role_granted" } })).toBe(1);

    await setUserRole(user.email, "USER");
    const signedIn = await authenticate(user.email, "correct-horse-1");
    expect(signedIn.ok && signedIn.user.role).toBe("USER");
  });

  it("refuses an email with no account", async () => {
    await expect(setUserRole("nobody@example.com", "ADMIN")).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("admin overview", () => {
  it("counts users, sent, failed and stuck applications across all users", async () => {
    const a = await makeUser("Ada");
    const b = await makeUser("Ben");
    await prisma.user.update({ where: { id: a.id }, data: { lastLoginAt: new Date() } });
    await makeApp(a.id, { status: "SUBMITTED" });
    await makeApp(a.id, { status: "FAILED", failureType: "SITE_CHANGED", url: "https://www.acme.example/apply/1" });
    await makeApp(b.id, { status: "FAILED", failureType: "SITE_CHANGED", url: "https://acme.example/apply/2" });
    await makeApp(b.id, { status: "FAILED", failureType: "TIMEOUT" });
    await makeApp(b.id, { status: "WAITING_FOR_USER", daysAgo: 4 });
    await makeApp(b.id, { status: "WAITING_FOR_USER" });

    const overview = await getAdminOverview();
    expect(overview.users).toEqual({ total: 2, new7d: 2, new30d: 2, active7d: 1 });
    await createSession(b.id, {});
    expect((await getAdminOverview()).users.active7d).toBe(2);
    expect(overview.applications).toEqual({ total: 6, submitted7d: 1, failed7d: 3, failedTotal: 3, stuck: 1 });
    expect(overview.failuresByType).toEqual([
      { failureType: "SITE_CHANGED", count: 2 },
      { failureType: "TIMEOUT", count: 1 },
    ]);
    expect(overview.failingSites[0]).toEqual({ host: "acme.example", count: 2 });
    expect(overview.recentUsers.map((u) => u.name).sort()).toEqual(["Ada", "Ben"]);
  });
});

describe("admin users list", () => {
  it("searches by name or email and counts each user's applications", async () => {
    const a = await makeUser("Ada Lovelace");
    await makeUser("Ben Franklin");
    await makeApp(a.id, { status: "SUBMITTED" });
    await makeApp(a.id, { status: "FAILED", failureType: "TIMEOUT" });
    await makeApp(a.id);

    const all = await listAdminUsers();
    expect(all.total).toBe(2);

    const found = await listAdminUsers({ q: "lovelace" });
    expect(found.total).toBe(1);
    expect(found.users[0]).toMatchObject({ id: a.id, jobs: 3, applications: 3, submitted: 1, failed: 1, role: "USER", locked: false, lastActiveAt: null });
    await createSession(a.id, {});
    expect((await listAdminUsers({ q: "lovelace" })).users[0]?.lastActiveAt).toBeInstanceOf(Date);
    expect((await listAdminUsers({ q: a.email.toUpperCase() })).users[0]?.id).toBe(a.id);
  });

  it("never returns password hashes or profile data", async () => {
    await makeUser();
    const { users } = await listAdminUsers();
    expect(Object.keys(users[0]!).sort()).toEqual(
      ["applications", "createdAt", "email", "failed", "id", "jobs", "lastActiveAt", "lastLoginAt", "locked", "lockedUntil", "name", "plan", "role", "submitted"].sort(),
    );
  });
});

describe("admin failing applications", () => {
  it("lists failed, stuck or both, with filters and a shortened error", async () => {
    const a = await makeUser();
    const b = await makeUser();
    const failed = await makeApp(a.id, { status: "FAILED", failureType: "SITE_CHANGED", lastError: "x".repeat(1000) });
    await makeApp(b.id, { status: "FAILED", failureType: "TIMEOUT" });
    const stuck = await makeApp(b.id, { status: "WAITING_FOR_USER", daysAgo: 5 });
    await makeApp(b.id, { status: "WAITING_FOR_USER" });
    await makeApp(a.id, { status: "SUBMITTED" });

    expect((await listAdminFailures()).total).toBe(2);
    expect((await listAdminFailures({ scope: "stuck" })).items.map((i) => i.id)).toEqual([stuck.id]);
    expect((await listAdminFailures({ scope: "all" })).total).toBe(3);

    const siteChanged = await listAdminFailures({ failureType: "SITE_CHANGED" });
    expect(siteChanged.items).toHaveLength(1);
    const item = siteChanged.items[0]!;
    expect(item).toMatchObject({ id: failed.id, user: { id: a.id, email: a.email }, job: { host: "boards.example.com" } });
    expect(item.lastError!.length).toBeLessThanOrEqual(401);
    expect((await listAdminFailures({ userId: b.id, scope: "all" })).total).toBe(2);
  });
});

describe("admin user detail", () => {
  it("summarises one account and records that the admin viewed it", async () => {
    const admin = await makeUser("Owner");
    const user = await makeUser("Customer");
    await makeApp(user.id, { status: "SUBMITTED" });
    await makeApp(user.id, { status: "FAILED", failureType: "TIMEOUT" });
    await createSession(user.id, {});

    const detail = await getAdminUserDetail(admin.id, user.id, { ipAddress: "203.0.113.9" });
    expect(detail.account).toMatchObject({ id: user.id, email: user.email, role: "USER", locked: false });
    expect(detail.account).not.toHaveProperty("passwordHash");
    expect(detail.statusCounts).toEqual({ SUBMITTED: 1, FAILED: 1 });
    expect(detail.activeSessions).toBe(1);
    expect(detail.failures).toHaveLength(1);
    expect(detail.signIns.map((s) => s.action)).toEqual([]);

    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: "admin.view_user" } });
    expect(log).toMatchObject({ userId: admin.id, entityId: user.id, ipAddress: "203.0.113.9" });
  });

  it("throws NotFoundError for an unknown user", async () => {
    const admin = await makeUser();
    await expect(getAdminUserDetail(admin.id, "ckunknownunknownunknown0")).rejects.toBeInstanceOf(NotFoundError);
  });
});
