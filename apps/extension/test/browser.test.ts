// End to end: the real extension loaded in Chromium, talking to the real API
// and database, on local stand-ins for a job page and an application form.
import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import { chromium, type BrowserContext, type Page, type Worker } from "playwright-core";
import { buildServer } from "@autoapply/api/src/server";
import { createDocument, createExtensionPairingCode, createUser, loadBrowserSession, prisma } from "@autoapply/database";
import { buildStorageKey, getStorage, sha256Hex } from "@autoapply/documents";

type FastifyInstance = Awaited<ReturnType<typeof buildServer>>;

const EXTENSION = resolve(import.meta.dirname, "..");
// PLAYWRIGHT_CHROMIUM_EXECUTABLE, like the worker, else Playwright's full Chromium
// (its default headless shell can't load extensions).
const CHROMIUM = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined;
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n");

const JOB_PAGE = `<!doctype html><html><head><title>Account Executive - Globex Careers</title>
<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@type": "JobPosting", title: "Account Executive", hiringOrganization: { name: "Globex" }, description: "<p>Own a book of mid-market accounts and close new business.</p>".repeat(10) })}</script>
</head><body><h1>Account Executive</h1><p>Apply now.</p></body></html>`;

const FORM_PAGE = `<!doctype html><html><head><title>Apply</title></head><body>
<h1>Apply: Account Executive</h1>
<form id="application_form" action="/thanks" method="get">
  <label for="first_name">First Name *</label><input id="first_name" name="first_name" required>
  <label for="last_name">Last Name *</label><input id="last_name" name="last_name" required>
  <label for="email">Email *</label><input id="email" name="email" type="email" required>
  <label for="phone">Phone</label><input id="phone" name="phone" type="tel">
  <label for="resume">Resume/CV *</label><input id="resume" name="resume" type="file" required>
  <label for="why">Why do you want to sell anvils? *</label><textarea id="why" name="why" required></textarea>
  <div class="g-recaptcha" data-sitekey="test" style="width:300px;height:80px;border:1px solid #ccc">I'm not a robot</div>
  <button type="submit" id="submit">Submit application</button>
</form>
<script>document.getElementById("resume").addEventListener("change", (e) => { document.body.dataset.resume = e.target.files[0] ? e.target.files[0].name + ":" + e.target.files[0].size : ""; });</script>
</body></html>`;

const THANKS_PAGE = `<!doctype html><html><body><h1>Thank you for applying!</h1><p>Your confirmation number is AB-12345.</p></body></html>`;

const SIGN_IN_PAGE = `<!doctype html><html><body><h1>Candidate sign in</h1>
<form><label for="u">Email</label><input id="u" name="u" type="email"><label for="p">Password</label><input id="p" name="p" type="password"><button type="button">Sign in</button></form>
</body></html>`;

let api: FastifyInstance;
let apiUrl: string;
let site: Server;
let siteUrl: string;
let context: BrowserContext;
let worker: Worker;
let extensionId: string;
let userDir: string;
let userId: string;

const background = <T>(fn: string, arg?: unknown) => worker.evaluate(([f, a]) => (globalThis as unknown as Record<string, Record<string, (x: unknown) => Promise<unknown>>>).applyance![f as string]!(a), [fn, arg] as const) as Promise<T>;

async function waitFor<T>(read: () => Promise<T>, ok: (value: T) => boolean, ms = 15_000): Promise<T> {
  const end = Date.now() + ms;
  let value = await read();
  while (!ok(value) && Date.now() < end) {
    await new Promise((r) => setTimeout(r, 200));
    value = await read();
  }
  return value;
}

async function waitingApplication(url: string, reason: "CAPTCHA" | "AUTH_REQUIRED") {
  const job = await prisma.job.create({ data: { userId, url, canonicalUrl: `${url}#${Date.now()}`, title: "Account Executive", company: "Acme", status: "QUALIFIED", sourceType: "MANUAL" } });
  return prisma.application.create({ data: { userId, jobId: job.id, status: "WAITING_FOR_USER", attentionReason: reason, attentionDetail: "Stopped for you", platform: "GENERIC" } });
}

async function pageAt(path: string): Promise<Page> {
  const found = await waitFor(async () => context.pages().find((p) => p.url().startsWith(`${siteUrl}${path}`)), Boolean);
  if (!found) throw new Error(`No tab opened at ${path}`);
  return found;
}

beforeAll(async () => {
  api = await buildServer({ logger: false });
  await api.listen({ port: 0, host: "127.0.0.1" });
  apiUrl = `http://localhost:${(api.server.address() as AddressInfo).port}`;

  site = createServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0];
    const body = path === "/jobs/1" ? JOB_PAGE : path === "/apply" ? FORM_PAGE : path === "/thanks" ? THANKS_PAGE : path === "/sign-in" ? SIGN_IN_PAGE : null;
    res.writeHead(body ? 200 : 404, { "content-type": "text/html" }).end(body ?? "not found");
  });
  await new Promise<void>((r) => site.listen(0, "127.0.0.1", r));
  siteUrl = `http://localhost:${(site.address() as AddressInfo).port}`;

  const user = await createUser({ name: "Ada", email: `ext-e2e-${Date.now()}@example.com`, password: "correct-horse-1" });
  userId = user.id;
  await prisma.masterProfile.update({ where: { userId }, data: { firstName: "Ada", lastName: "Lovelace", phone: "555-0100" } });
  const key = buildStorageKey(userId, "RESUME", "pdf");
  await getStorage().put(key, PDF, "application/pdf");
  await createDocument(userId, { type: "RESUME", name: "Main resume", isDefault: true }, { fileName: "ada-resume.pdf", mimeType: "application/pdf", sizeBytes: PDF.length, storageKey: key, sha256: sha256Hex(PDF) });

  userDir = mkdtempSync(join(tmpdir(), "applyance-ext-profile-"));
  context = await chromium.launchPersistentContext(userDir, {
    executablePath: CHROMIUM,
    channel: CHROMIUM ? undefined : "chromium",
    headless: true,
    args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`],
  });
  worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  extensionId = new URL(worker.url()).host;
});

afterAll(async () => {
  await context?.close();
  rmSync(userDir, { recursive: true, force: true });
  site?.close();
  await api?.close();
  await prisma.$disconnect();
});

describe("Applyance extension in Chromium", () => {
  it("connects from the popup with a pairing code", async () => {
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup/popup.html`);
    await expectText(popup, "Connect to your account");
    const { code } = await createExtensionPairingCode(userId);
    await popup.fill("#code", code);
    await popup.fill("#api-url", apiUrl);
    await popup.click("button[type=submit]");
    await expectText(popup, "Save this job");
    await expectText(popup, "Nothing needs you right now");
    expect(await popup.textContent("#account")).toContain("ext-e2e-");
    const connection = await prisma.extensionConnection.findFirstOrThrow({ where: { userId, tokenHash: { not: null } } });
    expect(connection.browser).toMatch(/on Linux$/);
    await popup.close();
  });

  it("saves the job on the current page", async () => {
    const tab = await context.newPage();
    await tab.goto(`${siteUrl}/jobs/1`);
    const saved = await background<{ result: string; job: { title: string; company: string } }>("saveTab", { id: await tabId(tab), url: tab.url() });
    expect(saved).toMatchObject({ result: "saved", job: { title: "Account Executive", company: "Globex" } });
    const again = await background<{ result: string }>("saveTab", { id: await tabId(tab), url: tab.url() });
    expect(again.result).toBe("already_saved");
    await tab.close();
  });

  it("fills an application stopped by a CAPTCHA, and records the person's own submission", async () => {
    const app = await waitingApplication(`${siteUrl}/apply`, "CAPTCHA");
    await background("startHandoff", app.id);
    const tab = await pageAt("/apply");
    await waitFor(() => tab.inputValue("#first_name"), (v) => v === "Ada");
    expect(await tab.inputValue("#last_name")).toBe("Lovelace");
    expect(await tab.inputValue("#email")).toContain("ext-e2e-");
    expect(await tab.inputValue("#phone")).toBe("555-0100");
    expect(await waitFor(() => tab.evaluate(() => document.body.dataset.resume ?? ""), (v) => !!v)).toBe(`ada-resume.pdf:${PDF.length}`);
    // The question Applyance has no answer for is left to the person, and the CAPTCHA is untouched.
    expect(await tab.inputValue("#why")).toBe("");
    expect(await tab.getAttribute("#why", "data-applyance-yours")).toBe("");
    const panel = tab.locator("#applyance-panel");
    await expectText(tab, "Why do you want to sell anvils?", panel);
    await expectText(tab, "Solve it yourself", panel);
    expect((await prisma.application.findUniqueOrThrow({ where: { id: app.id } })).status).toBe("WAITING_FOR_USER");

    await tab.fill("#why", "Anvils are durable.");
    await tab.click("#submit");
    const after = await waitFor(() => prisma.application.findUniqueOrThrow({ where: { id: app.id } }), (a) => a.status === "SUBMITTED");
    expect(after).toMatchObject({ status: "SUBMITTED", confirmationNumber: "AB-12345" });
    await expectText(tab, "Recorded as submitted", tab.locator("#applyance-panel"));
    const events = await prisma.applicationEvent.findMany({ where: { applicationId: app.id }, orderBy: { createdAt: "asc" }, select: { message: true } });
    expect(events.map((e) => e.message)).toEqual([
      "Opened in your own browser with the Applyance extension",
      "Filled 5 of 6 fields in your browser on localhost; 1 left for you",
      "Submitted by you in your own browser (the site showed its confirmation), confirmation AB-12345",
    ]);
    await tab.close();
  });

  it("saves a sign-in the person did themselves and hands the application back to the worker", async () => {
    const app = await waitingApplication(`${siteUrl}/sign-in`, "AUTH_REQUIRED");
    await background("startHandoff", app.id);
    const tab = await pageAt("/sign-in");
    const panel = tab.locator("#applyance-panel");
    await expectText(tab, "Sign in yourself", panel);
    // Nothing is typed into a sign-in form.
    expect(await tab.inputValue("#u")).toBe("");
    // The person signs in; the site sets its session cookie.
    await tab.evaluate(() => {
      document.cookie = "candidate_session=signed-in; path=/";
    });
    await panel.getByRole("button", { name: "Continue in Applyance" }).click();
    const after = await waitFor(() => prisma.application.findUniqueOrThrow({ where: { id: app.id } }), (a) => a.status === "QUEUED");
    expect(after.status).toBe("QUEUED");
    await expectText(tab, "Applyance is carrying on", panel);
    const session = await loadBrowserSession(userId, "localhost");
    expect((session!.storageState as { cookies: Array<{ name: string; value: string }> }).cookies).toEqual(expect.arrayContaining([expect.objectContaining({ name: "candidate_session", value: "signed-in" })]));
    await tab.close();
  });
});

async function tabId(page: Page): Promise<number> {
  const url = page.url();
  return worker.evaluate(async (u) => (await chrome.tabs.query({ url: u }))[0]!.id!, url);
}

async function expectText(page: Page, text: string, within = page.locator("body")) {
  await within.getByText(text, { exact: false }).first().waitFor({ state: "visible", timeout: 15_000 });
}
