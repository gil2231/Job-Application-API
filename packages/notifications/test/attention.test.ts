import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@autoapply/database";
import { DisabledEmailSender, MemoryEmailSender, sendAttentionAlerts, verifyUnsubscribeToken } from "../src";
import { makeUser, pausedApplication, resetDatabase } from "./helpers";

const NOW = new Date("2026-10-06T15:00:00Z");
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

describe("Needs Attention alerts", () => {
  beforeEach(resetDatabase);

  it("sends one email covering every application that paused, then nothing more for them", async () => {
    const user = await makeUser();
    await pausedApplication(user.id, { title: "Account Executive", company: "Acme", reason: "CAPTCHA", detail: "The site showed a CAPTCHA.", at: minutesAgo(5) });
    await pausedApplication(user.id, { title: "SDR", company: "Globex", reason: "QUESTION_REVIEW", detail: "2 questions need your answer.", at: minutesAgo(4), status: "REVIEW_REQUIRED" });
    const sender = new MemoryEmailSender();

    expect(await sendAttentionAlerts({ sender, now: NOW })).toEqual({ sent: 1, failed: 0, skipped: 0 });
    expect(sender.sent).toHaveLength(1);
    const email = sender.sent[0]!;
    expect(email.to).toBe(user.email);
    expect(email.subject).toBe("2 applications are waiting on you");
    expect(email.text).toContain("Account Executive at Acme: CAPTCHA for you to finish");
    expect(email.text).toContain("SDR at Globex: Questions for you to answer");
    expect(email.html).toContain("https://app.example.com/needs-attention");
    expect(email.headers?.["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");

    // Already covered: a second run sends nothing.
    expect(await sendAttentionAlerts({ sender, now: new Date(NOW.getTime() + 60 * 60_000) })).toEqual({ sent: 0, failed: 0, skipped: 0 });
    const history = await prisma.notification.findMany({ where: { userId: user.id } });
    expect(history).toMatchObject([{ kind: "NEEDS_ATTENTION", status: "SENT", recipient: user.email }]);
  });

  it("waits for a pause to settle, and for the cooldown, so bursts become one email", async () => {
    const user = await makeUser();
    await pausedApplication(user.id, { title: "AE", company: "Acme", reason: "MFA", detail: "Enter the code.", at: minutesAgo(0.5) });
    const sender = new MemoryEmailSender();
    expect((await sendAttentionAlerts({ sender, now: NOW })).sent).toBe(0); // too fresh

    expect((await sendAttentionAlerts({ sender, now: new Date(NOW.getTime() + 3 * 60_000) })).sent).toBe(1);
    // Another pause shortly after the email: held until the 15-minute cooldown is over.
    await pausedApplication(user.id, { title: "BDR", company: "Initech", reason: "AUTH_REQUIRED", detail: "Sign in.", at: new Date(NOW.getTime() + 4 * 60_000) });
    expect((await sendAttentionAlerts({ sender, now: new Date(NOW.getTime() + 8 * 60_000) })).sent).toBe(0);
    expect((await sendAttentionAlerts({ sender, now: new Date(NOW.getTime() + 20 * 60_000) })).sent).toBe(1);
    expect(sender.sent[1]!.subject).toBe("BDR at Initech is waiting on you");
    expect(sender.sent[1]!.text).toContain("1 other application is also still waiting");
  });

  it("drops pauses the person already handled, and respects the setting", async () => {
    const handled = await makeUser();
    const { application } = await pausedApplication(handled.id, { title: "AE", company: "Acme", reason: "CAPTCHA", detail: "CAPTCHA", at: minutesAgo(10) });
    await prisma.application.update({ where: { id: application.id }, data: { status: "QUEUED" } });
    const optedOut = await makeUser();
    await prisma.userSetting.upsert({ where: { userId: optedOut.id }, update: { emailNotifications: false }, create: { userId: optedOut.id, emailNotifications: false } });
    await pausedApplication(optedOut.id, { title: "AE", company: "Acme", reason: "CAPTCHA", detail: "CAPTCHA", at: minutesAgo(10) });

    const sender = new MemoryEmailSender();
    expect(await sendAttentionAlerts({ sender, now: NOW })).toEqual({ sent: 0, failed: 0, skipped: 0 });
    expect(await prisma.applicationEvent.count({ where: { notifiedAt: null } })).toBe(0);
  });

  it("retries a failed send later and records why", async () => {
    const user = await makeUser();
    await pausedApplication(user.id, { title: "AE", company: "Acme", reason: "FINAL_REVIEW", detail: "Ready to submit.", at: minutesAgo(5), status: "READY" });
    const sender = new MemoryEmailSender();
    sender.failNext = "Resend refused the email (500)";
    expect((await sendAttentionAlerts({ sender, now: NOW })).failed).toBe(1);
    expect(await prisma.notification.findFirst({ where: { userId: user.id } })).toMatchObject({ status: "FAILED", error: "Resend refused the email (500)" });
    expect((await sendAttentionAlerts({ sender, now: new Date(NOW.getTime() + 5 * 60_000) })).sent).toBe(0); // cooldown
    expect((await sendAttentionAlerts({ sender, now: new Date(NOW.getTime() + 16 * 60_000) })).sent).toBe(1);
  });

  it("records the alert as skipped when no email provider is set up", async () => {
    const user = await makeUser();
    await pausedApplication(user.id, { title: "AE", company: "Acme", reason: "CAPTCHA", detail: "CAPTCHA", at: minutesAgo(5) });
    expect((await sendAttentionAlerts({ sender: new DisabledEmailSender("not set up"), now: NOW })).skipped).toBe(1);
    expect(await prisma.notification.findFirst({ where: { userId: user.id } })).toMatchObject({ status: "SKIPPED" });
    expect(await prisma.applicationEvent.count({ where: { notifiedAt: null } })).toBe(0);
  });

  it("escapes job text in the email and signs a working unsubscribe link", async () => {
    const user = await makeUser();
    await pausedApplication(user.id, { title: "<script>alert(1)</script>", company: "A&B", reason: "CAPTCHA", detail: "x", at: minutesAgo(5) });
    const sender = new MemoryEmailSender();
    await sendAttentionAlerts({ sender, now: NOW });
    const { html } = sender.sent[0]!;
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("A&amp;B");
    const token = decodeURIComponent(/unsubscribe\?token=([^"&]+)/.exec(html)![1]!);
    expect(verifyUnsubscribeToken(token)).toEqual({ userId: user.id, kind: "attention" });
    expect(verifyUnsubscribeToken(token.replace(/.$/, (c) => (c === "A" ? "B" : "A")))).toBeNull();
    expect(verifyUnsubscribeToken(token.replace("attention", "job_alerts"))).toBeNull();
  });
});
