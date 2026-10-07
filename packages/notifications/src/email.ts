/**
 * Email delivery. Applyance only talks to an EmailSender, so the provider can
 * be swapped by configuration:
 * - EMAIL_PROVIDER="resend" sends through Resend (RESEND_API_KEY, EMAIL_FROM),
 * - EMAIL_PROVIDER="log" prints each email to the console (local development),
 * - unset: "log" in development, and no sending at all in production, where
 *   alerts are recorded as skipped until a provider is configured.
 */

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Extra headers, e.g. List-Unsubscribe. */
  headers?: Record<string, string>;
}

export interface EmailSender {
  /** Shown in Settings so the user can tell whether email is set up. */
  readonly name: string;
  /** False when no provider is set up: callers record the alert as skipped. */
  readonly configured: boolean;
  send(message: EmailMessage): Promise<{ id: string | null }>;
}

export class EmailSendError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmailSendError";
  }
}

/** Prints emails instead of sending them. */
export class LogEmailSender implements EmailSender {
  readonly name = "Console (development)";
  readonly configured = true;
  async send(message: EmailMessage) {
    console.warn(`[email] to ${message.to}: ${message.subject}\n${message.text}\n`);
    return { id: null };
  }
}

/** Keeps sent emails in memory. For tests. */
export class MemoryEmailSender implements EmailSender {
  readonly name = "Memory";
  readonly configured = true;
  readonly sent: EmailMessage[] = [];
  failNext: string | null = null;
  async send(message: EmailMessage) {
    if (this.failNext) {
      const reason = this.failNext;
      this.failNext = null;
      throw new EmailSendError(reason);
    }
    this.sent.push(message);
    return { id: `mem-${this.sent.length}` };
  }
}

export class DisabledEmailSender implements EmailSender {
  readonly name = "Not set up";
  readonly configured = false;
  constructor(readonly reason: string) {}
  async send(): Promise<{ id: string | null }> {
    throw new EmailSendError(this.reason);
  }
}

type Fetch = typeof fetch;

/** https://resend.com/docs/api-reference/emails/send-email */
export class ResendEmailSender implements EmailSender {
  readonly name = "Resend";
  readonly configured = true;
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly fetchImpl: Fetch = fetch,
  ) {}

  async send(message: EmailMessage) {
    let response: Response;
    try {
      response = await this.fetchImpl("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${this.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ from: this.from, to: [message.to], subject: message.subject, html: message.html, text: message.text, headers: message.headers }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (error) {
      throw new EmailSendError(`Couldn't reach Resend (${error instanceof Error ? error.message : "network error"})`);
    }
    const body = (await response.json().catch(() => null)) as { id?: string; message?: string } | null;
    if (!response.ok) throw new EmailSendError(`Resend refused the email (${response.status}${body?.message ? `: ${body.message}` : ""})`);
    return { id: body?.id ?? null };
  }
}

export function createEmailSender(env: NodeJS.ProcessEnv = process.env, fetchImpl?: Fetch): EmailSender {
  const provider = (env.EMAIL_PROVIDER ?? "").trim().toLowerCase();
  if (provider === "resend") {
    if (!env.RESEND_API_KEY) return new DisabledEmailSender("EMAIL_PROVIDER is resend but RESEND_API_KEY isn't set");
    if (!env.EMAIL_FROM) return new DisabledEmailSender("EMAIL_FROM isn't set (for example: Applyance <alerts@yourdomain.com>)");
    return new ResendEmailSender(env.RESEND_API_KEY, env.EMAIL_FROM, fetchImpl);
  }
  if (provider === "log") return new LogEmailSender();
  if (provider === "none") return new DisabledEmailSender("Email is turned off (EMAIL_PROVIDER=none)");
  if (provider) return new DisabledEmailSender(`Unknown EMAIL_PROVIDER "${provider}"`);
  return env.NODE_ENV === "production" ? new DisabledEmailSender("No email provider is set up (EMAIL_PROVIDER)") : new LogEmailSender();
}
