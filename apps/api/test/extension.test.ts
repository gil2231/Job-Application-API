import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createExtensionPairingCode, createSession, createUser, loadBrowserSession, prisma, revokeExtensionConnection } from "@autoapply/database";
import { buildServer } from "../src/server";

let app: FastifyInstance;
let userA: string;
let userB: string;
let tokenB: string;

beforeAll(async () => {
  app = await buildServer({ logger: false });
  const stamp = Date.now();
  userA = (await createUser({ name: "Ext A", email: `ext-a-${stamp}@example.com`, password: "correct-horse-1" })).id;
  userB = (await createUser({ name: "Ext B", email: `ext-b-${stamp}@example.com`, password: "correct-horse-1" })).id;
  tokenB = (await createSession(userB)).token;
  await prisma.masterProfile.update({ where: { userId: userA }, data: { firstName: "Ada", lastName: "Lovelace", phone: "555-0100" } });
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

async function connect(userId: string) {
  const { code } = await createExtensionPairingCode(userId);
  const res = await app.inject({ method: "POST", url: "/v1/extension/connect", payload: { code: code.toLowerCase(), browser: "Chrome on macOS" } });
  expect(res.statusCode).toBe(200);
  return res.json() as { token: string; user: { email: string }; appUrl: string };
}

async function waitingApplication(userId: string, url: string, attention: { status?: "WAITING_FOR_USER" | "READY"; reason: "CAPTCHA" | "AUTH_REQUIRED" | "MFA" | "FINAL_REVIEW" | "UNSUPPORTED_SITE"; platform?: "GREENHOUSE" | "GENERIC" }) {
  const job = await prisma.job.create({ data: { userId, url, canonicalUrl: `${url}#${Math.random()}`, title: "Account Executive", company: "Acme", status: "QUALIFIED", sourceType: "MANUAL" } });
  return prisma.application.create({
    data: { userId, jobId: job.id, status: attention.status ?? "WAITING_FOR_USER", attentionReason: attention.reason, attentionDetail: "Stopped for you", platform: attention.platform ?? "GENERIC" },
  });
}

const field = (over: Record<string, unknown>) => ({
  kind: "text", widget: "native", label: "", labelVia: "label", required: false, multiple: false,
  name: "", id: "", placeholder: "", autocomplete: "", inputType: "text", accept: "", ariaLabel: "", domPath: "form > input", ...over,
});

describe("browser extension API", () => {
  it("connects with a one-time pairing code and can be disconnected", async () => {
    expect((await app.inject({ method: "POST", url: "/v1/extension/connect", payload: { code: "AAAA-BBBB" } })).statusCode).toBe(400);
    const { code } = await createExtensionPairingCode(userA);
    expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    const first = await app.inject({ method: "POST", url: "/v1/extension/connect", payload: { code } });
    expect(first.statusCode).toBe(200);
    const { token, user } = first.json();
    expect(token).toMatch(/^apx_/);
    expect(user.email).toContain("ext-a-");
    // A code works once.
    expect((await app.inject({ method: "POST", url: "/v1/extension/connect", payload: { code } })).statusCode).toBe(400);

    expect((await app.inject({ method: "GET", url: "/v1/extension/me", headers: auth(token) })).json().user.email).toContain("ext-a-");
    // The extension's token only opens the extension's routes.
    expect((await app.inject({ method: "GET", url: "/v1/jobs", headers: auth(token) })).statusCode).toBe(401);
    // Cookies are not accepted on extension routes.
    expect((await app.inject({ method: "GET", url: "/v1/extension/me", cookies: { autoapply_session: token } })).statusCode).toBe(401);

    const row = await prisma.extensionConnection.findFirstOrThrow({ where: { userId: userA, revokedAt: null, tokenHash: { not: null } } });
    expect(row.browser).toBeNull();
    await revokeExtensionConnection(userA, row.id);
    expect((await app.inject({ method: "GET", url: "/v1/extension/me", headers: auth(token) })).statusCode).toBe(401);
  });

  it("disconnects itself", async () => {
    const { token } = await connect(userA);
    expect((await app.inject({ method: "DELETE", url: "/v1/extension/connection", headers: auth(token) })).statusCode).toBe(204);
    expect((await app.inject({ method: "GET", url: "/v1/extension/me", headers: auth(token) })).statusCode).toBe(401);
  });

  it("saves the page's job, and only the link on LinkedIn", async () => {
    const { token } = await connect(userA);
    const posting = { "@context": "https://schema.org", "@type": "JobPosting", title: "Enterprise AE", hiringOrganization: { name: "Globex" }, description: "<p>Sell things.</p>".repeat(30) };
    const saved = await app.inject({ method: "POST", url: "/v1/extension/jobs", headers: auth(token), payload: { url: "https://careers.globex.example/jobs/77", title: "Careers", jsonLd: [JSON.stringify(posting)] } });
    expect(saved.json()).toMatchObject({ result: "saved", job: { title: "Enterprise AE", company: "Globex", needsDetails: false } });
    expect(saved.json().job.link).toMatch(/\/jobs\/[a-z0-9]+$/);
    const again = await app.inject({ method: "POST", url: "/v1/extension/jobs", headers: auth(token), payload: { url: "https://careers.globex.example/jobs/77?utm_source=x", jsonLd: [JSON.stringify(posting)] } });
    expect(again.json().result).toBe("already_saved");

    const linkedIn = await app.inject({
      method: "POST",
      url: "/v1/extension/jobs",
      headers: auth(token),
      payload: { url: "https://www.linkedin.com/jobs/view/3912345678/", title: "Should be ignored", text: "LinkedIn page text that must never be stored. ".repeat(20) },
    });
    expect(linkedIn.json()).toMatchObject({ result: "saved", job: { title: "LinkedIn job 3912345678", needsDetails: true } });
    expect(linkedIn.json().message).toMatch(/doesn't read LinkedIn pages/);
    const stored = await prisma.job.findUniqueOrThrow({ where: { id: linkedIn.json().job.id } });
    expect(stored.description).toBeNull();
    expect(stored.externalId).toBe("3912345678");

    const feed = await app.inject({ method: "POST", url: "/v1/extension/jobs", headers: auth(token), payload: { url: "https://www.linkedin.com/feed/" } });
    expect(feed.json().result).toBe("not_saved");

    // No posting data and an address that can't be fetched: the page's own heading and text are used.
    const plain = await app.inject({
      method: "POST",
      url: "/v1/extension/jobs",
      headers: auth(token),
      payload: { url: "http://127.0.0.1:9/careers/sdr", title: "SDR | Initech", siteName: "Initech", heading: "Sales Development Rep", text: "We are hiring a sales development rep to book meetings. ".repeat(10) },
    });
    expect(plain.json()).toMatchObject({ result: "saved", job: { title: "Sales Development Rep", company: "Initech", needsDetails: false } });

    const source = await prisma.jobSource.findFirstOrThrow({ where: { userId: userA, type: "BROWSER_EXTENSION" } });
    expect(source.name).toBe("Browser extension");
  });

  it("lists waiting applications and fills a form page from the profile", async () => {
    const { token } = await connect(userA);
    const waiting = await waitingApplication(userA, "https://acme.example/careers/apply/1", { reason: "CAPTCHA", platform: "GREENHOUSE" });
    const list = await app.inject({ method: "GET", url: "/v1/extension/applications", headers: auth(token) });
    const item = list.json().applications.find((a: { id: string }) => a.id === waiting.id);
    expect(item).toMatchObject({ reason: "CAPTCHA", canFinishInBrowser: true, canContinueAfterSignIn: false });
    expect(item.origins).toEqual(["https://acme.example/*", "https://*.greenhouse.io/*"]);
    // Another person's token sees nothing of it.
    expect((await app.inject({ method: "GET", url: "/v1/extension/applications", headers: auth(tokenB) })).json().applications.some((a: { id: string }) => a.id === waiting.id)).toBe(false);
    expect((await app.inject({ method: "POST", url: `/v1/extension/applications/${waiting.id}/open`, headers: auth(tokenB) })).statusCode).toBe(404);

    const opened = await app.inject({ method: "POST", url: `/v1/extension/applications/${waiting.id}/open`, headers: auth(token) });
    expect(opened.json().scanOptions.roots).toContain("#application_form");

    const fill = await app.inject({
      method: "POST",
      url: `/v1/extension/applications/${waiting.id}/fill`,
      headers: auth(token),
      payload: {
        url: "https://acme.example/careers/apply/1",
        fields: [
          field({ label: "First Name", name: "first_name", autocomplete: "given-name" }),
          field({ label: "Email", name: "email", kind: "email", inputType: "email", required: true }),
          field({ label: "Why do you want to work at a company that sells anvils?", name: "q1", kind: "textarea", inputType: "textarea", required: true }),
          field({ label: "Resume", name: "resume", kind: "file", inputType: "file", required: true }),
        ],
      },
    });
    expect(fill.statusCode).toBe(200);
    const plan = fill.json().plan as Array<{ index: number; action: string; value?: string }>;
    expect(plan[0]).toMatchObject({ action: "fill", value: "Ada" });
    expect(plan[1]).toMatchObject({ action: "fill", value: expect.stringContaining("ext-a-") });
    expect(plan[2]!.action).toBe("yours");
    // No resume uploaded yet, so attaching it is left to the person.
    expect(plan[3]!.action).toBe("yours");
    const events = await prisma.applicationEvent.findMany({ where: { applicationId: waiting.id }, select: { message: true } });
    expect(events.map((e) => e.message)).toEqual(expect.arrayContaining(["Opened in your own browser with the Applyance extension", expect.stringMatching(/^Filled 2 of 4 fields in your browser/)]));

    const submitted = await app.inject({ method: "POST", url: `/v1/extension/applications/${waiting.id}/submitted`, headers: auth(token), payload: { confirmation: "GH-12345", detected: true } });
    expect(submitted.statusCode).toBe(200);
    const after = await prisma.application.findUniqueOrThrow({ where: { id: waiting.id } });
    expect(after).toMatchObject({ status: "SUBMITTED", confirmationNumber: "GH-12345", attentionReason: null });
    expect((await app.inject({ method: "POST", url: `/v1/extension/applications/${waiting.id}/submitted`, headers: auth(token), payload: {} })).statusCode).toBe(404);
  });

  it("saves a sign-in done in the person's browser and requeues the application", async () => {
    const { token } = await connect(userA);
    const signIn = await waitingApplication(userA, "https://acme.wd5.myworkdayjobs.com/en-US/careers/job/1/apply", { reason: "AUTH_REQUIRED" });
    const cookie = { path: "/", expires: -1, httpOnly: true, secure: true, sameSite: "Lax" as const };
    const res = await app.inject({
      method: "POST",
      url: `/v1/extension/applications/${signIn.id}/signed-in`,
      headers: auth(token),
      payload: { cookies: [{ ...cookie, name: "wd-session", value: "abc", domain: "acme.wd5.myworkdayjobs.com" }, { ...cookie, name: "shared", value: "def", domain: ".myworkdayjobs.com" }, { ...cookie, name: "tracker", value: "x", domain: ".evil.example" }, { ...cookie, name: "tld", value: "x", domain: ".com" }] },
    });
    expect(res.statusCode).toBe(200);
    expect((await prisma.application.findUniqueOrThrow({ where: { id: signIn.id } })).status).toBe("QUEUED");
    const session = await loadBrowserSession(userA, "acme.wd5.myworkdayjobs.com");
    expect((session!.storageState as { cookies: Array<{ name: string }> }).cookies.map((c) => c.name)).toEqual(["wd-session", "shared"]);

    // Only sign-in and verification-code stops can continue this way.
    const captcha = await waitingApplication(userA, "https://acme.example/apply/2", { reason: "CAPTCHA" });
    const refused = await app.inject({ method: "POST", url: `/v1/extension/applications/${captcha.id}/signed-in`, headers: auth(token), payload: { cookies: [{ ...cookie, name: "a", value: "b", domain: "acme.example" }] } });
    expect(refused.statusCode).toBe(409);
    // Cookies for another site don't count as a sign-in.
    const mfa = await waitingApplication(userA, "https://jobs.initech.example/apply/3", { reason: "MFA" });
    const none = await app.inject({ method: "POST", url: `/v1/extension/applications/${mfa.id}/signed-in`, headers: auth(token), payload: { cookies: [{ ...cookie, name: "a", value: "b", domain: ".other.example" }] } });
    expect(none.statusCode).toBe(409);
  });

  it("never opens LinkedIn applications", async () => {
    const { token } = await connect(userA);
    const linkedIn = await waitingApplication(userA, "https://www.linkedin.com/jobs/view/123456789/", { reason: "UNSUPPORTED_SITE" });
    const list = await app.inject({ method: "GET", url: "/v1/extension/applications", headers: auth(token) });
    expect(list.json().applications.find((a: { id: string }) => a.id === linkedIn.id)).toMatchObject({ canFinishInBrowser: false, origins: [] });
    expect((await app.inject({ method: "POST", url: `/v1/extension/applications/${linkedIn.id}/open`, headers: auth(token) })).statusCode).toBe(409);
  });
});
