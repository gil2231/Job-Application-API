import { describe, expect, it, vi } from "vitest";
import { createEmailSender, EmailSendError, LogEmailSender, ResendEmailSender } from "../src";

const message = { to: "a@example.com", subject: "Hi", html: "<p>Hi</p>", text: "Hi", headers: { "List-Unsubscribe": "<https://x>" } };

describe("createEmailSender", () => {
  it("picks the provider from the environment", () => {
    expect(createEmailSender({ EMAIL_PROVIDER: "resend", RESEND_API_KEY: "re_123", EMAIL_FROM: "Applyance <a@b.com>" })).toBeInstanceOf(ResendEmailSender);
    expect(createEmailSender({ EMAIL_PROVIDER: "log" })).toBeInstanceOf(LogEmailSender);
    expect(createEmailSender({})).toBeInstanceOf(LogEmailSender);
  });
  it("is not configured in production without a provider, or with missing settings", () => {
    expect(createEmailSender({ NODE_ENV: "production" }).configured).toBe(false);
    expect(createEmailSender({ EMAIL_PROVIDER: "resend", EMAIL_FROM: "a@b.com" }).configured).toBe(false);
    expect(createEmailSender({ EMAIL_PROVIDER: "resend", RESEND_API_KEY: "re_123" }).configured).toBe(false);
    expect(createEmailSender({ EMAIL_PROVIDER: "carrier-pigeon" }).configured).toBe(false);
  });
});

describe("ResendEmailSender", () => {
  it("posts the email to Resend", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ id: "email_1" }), { status: 200 }));
    const sender = new ResendEmailSender("re_123", "Applyance <alerts@example.com>", fetchImpl as unknown as typeof fetch);
    expect(await sender.send(message)).toEqual({ id: "email_1" });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer re_123");
    expect(JSON.parse(init.body as string)).toMatchObject({ from: "Applyance <alerts@example.com>", to: ["a@example.com"], subject: "Hi", headers: message.headers });
  });
  it("reports a refusal with Resend's reason", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ message: "Domain not verified" }), { status: 403 }));
    const sender = new ResendEmailSender("re_123", "a@b.com", fetchImpl as unknown as typeof fetch);
    await expect(sender.send(message)).rejects.toThrow(new EmailSendError("Resend refused the email (403: Domain not verified)"));
  });
});
