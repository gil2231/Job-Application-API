import "server-only";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { localStorageRoot } from "@autoapply/documents";

export interface Email {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/**
 * Sends account email (verify address, reset password).
 * EMAIL_PROVIDER=resend sends through Resend's HTTP API (RESEND_API_KEY, EMAIL_FROM),
 * the same settings the notification emails use. Otherwise ("log", or unset
 * outside production) the email is printed and saved under
 * <STORAGE_LOCAL_DIR>/outbox so local development and tests can open the link;
 * it refuses to run in production, where a real driver is required.
 */
export async function sendEmail(email: Email): Promise<void> {
  const provider = (process.env.EMAIL_PROVIDER ?? "").trim().toLowerCase();
  if (provider === "resend") {
    const key = process.env.RESEND_API_KEY;
    const from = process.env.EMAIL_FROM;
    if (!key || !from) throw new Error("EMAIL_PROVIDER=resend needs RESEND_API_KEY and EMAIL_FROM");
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [email.to], subject: email.subject, text: email.text, html: email.html }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Resend refused the email (${res.status})`);
    return;
  }
  if (provider === "none" || (process.env.NODE_ENV === "production" && provider !== "log")) {
    throw new Error("No email provider is set up. Set EMAIL_PROVIDER=resend, RESEND_API_KEY and EMAIL_FROM.");
  }
  console.warn(`[email] to ${email.to}: ${email.subject}\n${email.text}`);
  const dir = join(localStorageRoot(process.env.STORAGE_LOCAL_DIR ?? ".storage"), "outbox");
  await mkdir(dir, { recursive: true });
  const name = `${Date.now()}-${email.to.replace(/[^a-z0-9@.-]/gi, "_")}.json`;
  await writeFile(join(dir, name), JSON.stringify(email, null, 2), { mode: 0o600 });
}

const escape = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** A plain, single-button email in text and HTML. */
export function linkEmail(opts: { to: string; subject: string; greeting: string; body: string; button: string; url: string; footer: string }): Email {
  const text = `${opts.greeting}\n\n${opts.body}\n\n${opts.button}: ${opts.url}\n\n${opts.footer}\n\nApplyance`;
  const html = `<!doctype html><html><body style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#18181b;line-height:1.5;max-width:520px;margin:0 auto;padding:24px">
<p style="font-weight:600;font-size:18px;margin:0 0 24px">Applyance</p>
<p>${escape(opts.greeting)}</p><p>${escape(opts.body)}</p>
<p style="margin:28px 0"><a href="${escape(opts.url)}" style="background:#4f46e5;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">${escape(opts.button)}</a></p>
<p style="color:#71717a;font-size:13px">Or paste this link into your browser:<br><span style="word-break:break-all">${escape(opts.url)}</span></p>
<p style="color:#71717a;font-size:13px">${escape(opts.footer)}</p></body></html>`;
  return { to: opts.to, subject: opts.subject, text, html };
}
