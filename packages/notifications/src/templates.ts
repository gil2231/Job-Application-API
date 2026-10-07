import type { AttentionReason } from "@autoapply/shared";
import type { EmailMessage } from "./email";
import { formatHour } from "./time";

/**
 * The emails Applyance sends. Each template returns an HTML and a plain-text
 * body: some mail apps only show text, and spam filters expect both. Every
 * value from the database is escaped before it goes into the HTML.
 */

export const PRODUCT_NAME = "Applyance";

const escapeHtml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

const firstName = (name: string) => name.trim().split(/\s+/)[0] || "there";

const truncate = (value: string, max: number) => (value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value);

/** What the person has to do, by why the application stopped (matches the wording in Flightpath). */
export const ATTENTION_TEXT: Record<AttentionReason, string> = {
  CAPTCHA: "CAPTCHA for you to finish",
  MFA: "Verification code needed",
  AUTH_REQUIRED: "Sign-in needed",
  QUESTION_REVIEW: "Questions for you to answer",
  LOW_CONFIDENCE_MAPPING: "Fields for you to check",
  UNSUPPORTED_SITE: "Site needs you to apply",
  VALIDATION_ERROR: "Form errors to fix",
  REPEATED_FAILURE: "Kept failing; needs a look",
  CONTRADICTION: "Conflicting answers to check",
  FINAL_REVIEW: "Ready for your final review",
};

interface Layout {
  preheader: string;
  heading: string;
  intro: string;
  bodyHtml: string;
  button: { label: string; url: string };
  footer: string;
  unsubscribe?: { label: string; url: string };
}

function layout(l: Layout): string {
  const unsubscribe = l.unsubscribe ? ` <a href="${escapeHtml(l.unsubscribe.url)}" style="color:#6b7280;text-decoration:underline">${escapeHtml(l.unsubscribe.label)}</a>` : "";
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(l.heading)}</title></head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#18181b">
<span style="display:none;max-height:0;overflow:hidden;opacity:0">${escapeHtml(l.preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:24px 12px">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;border:1px solid #e4e4e7">
<tr><td style="padding:24px 24px 8px;font-size:15px;font-weight:600;letter-spacing:-0.01em">${PRODUCT_NAME}</td></tr>
<tr><td style="padding:8px 24px 0"><h1 style="margin:0 0 8px;font-size:20px;line-height:1.3">${escapeHtml(l.heading)}</h1>
<p style="margin:0 0 16px;font-size:14px;line-height:1.5;color:#3f3f46">${escapeHtml(l.intro)}</p></td></tr>
<tr><td style="padding:0 24px">${l.bodyHtml}</td></tr>
<tr><td style="padding:20px 24px 24px"><a href="${escapeHtml(l.button.url)}" style="display:inline-block;background:#18181b;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:10px 18px;border-radius:8px">${escapeHtml(l.button.label)}</a></td></tr>
</table>
<p style="max-width:560px;margin:16px auto 0;font-size:12px;line-height:1.5;color:#6b7280">${escapeHtml(l.footer)}${unsubscribe}</p>
</td></tr>
</table>
</body>
</html>`;
}

const listHtml = (rows: string[]) =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e4e4e7;border-radius:8px">${rows
    .map((row, i) => `<tr><td style="padding:12px 14px;${i ? "border-top:1px solid #e4e4e7;" : ""}font-size:14px;line-height:1.45">${row}</td></tr>`)
    .join("")}</table>`;

// ── Needs Attention ─────────────────────────────────────────────────────────

export interface AttentionItem {
  applicationId: string;
  title: string;
  company: string;
  reason: AttentionReason | null;
  detail: string | null;
}

export function needsAttentionEmail(input: {
  to: string;
  name: string;
  items: AttentionItem[];
  /** Everything waiting, including applications an earlier email already covered. */
  totalWaiting: number;
  needsAttentionUrl: string;
  applicationUrl: (applicationId: string) => string;
  settingsUrl: string;
  unsubscribeUrl: string;
  headers?: Record<string, string>;
}): EmailMessage {
  const { items } = input;
  const subject =
    items.length === 1
      ? `${items[0]!.title} at ${items[0]!.company} is waiting on you`
      : `${plural(items.length, "application")} ${items.length === 1 ? "is" : "are"} waiting on you`;
  const older = input.totalWaiting - items.length;
  const intro =
    `Hi ${firstName(input.name)}, ${PRODUCT_NAME} paused ${items.length === 1 ? "an application" : `${items.length} applications`} because ${items.length === 1 ? "it needs" : "they need"} you. Nothing more is sent until you deal with ${items.length === 1 ? "it" : "them"}.` +
    (older > 0 ? ` ${plural(older, "other application")} ${older === 1 ? "is" : "are"} also still waiting.` : "");
  const label = (item: AttentionItem) => (item.reason ? ATTENTION_TEXT[item.reason] : "Needs your attention");
  const rows = items.map(
    (item) =>
      `<a href="${escapeHtml(input.applicationUrl(item.applicationId))}" style="color:#18181b;font-weight:600;text-decoration:none">${escapeHtml(item.title)}</a> <span style="color:#6b7280">at ${escapeHtml(item.company)}</span>` +
      `<br><span style="display:inline-block;margin-top:4px;font-size:12px;font-weight:600;color:#b45309">${escapeHtml(label(item))}</span>` +
      (item.detail ? `<br><span style="font-size:13px;color:#52525b">${escapeHtml(truncate(item.detail, 240))}</span>` : ""),
  );
  const text = [
    intro,
    "",
    ...items.flatMap((item) => [`- ${item.title} at ${item.company}: ${label(item)}`, ...(item.detail ? [`  ${truncate(item.detail, 240)}`] : []), `  ${input.applicationUrl(item.applicationId)}`]),
    "",
    `Open Needs Attention: ${input.needsAttentionUrl}`,
    "",
    `Turn these emails off in Settings (${input.settingsUrl}) or unsubscribe: ${input.unsubscribeUrl}`,
  ].join("\n");
  return {
    to: input.to,
    subject,
    text,
    headers: input.headers,
    html: layout({
      preheader: items.map(label).join(", "),
      heading: items.length === 1 ? "An application is waiting on you" : `${items.length} applications are waiting on you`,
      intro,
      bodyHtml: listHtml(rows),
      button: { label: "Open Needs Attention", url: input.needsAttentionUrl },
      footer: `You get this email when an application stops and needs you. Change it in Settings.`,
      unsubscribe: { label: "Stop these emails", url: input.unsubscribeUrl },
    }),
  };
}

// ── Daily job alerts ────────────────────────────────────────────────────────

export interface JobAlertPosting {
  title: string;
  company: string;
  location: string | null;
  salaryText: string | null;
  url: string;
}

export interface JobAlertSection {
  searchName: string;
  query: string;
  postings: JobAlertPosting[];
  /** New matches beyond the ones listed. */
  more: number;
}

export const MAX_POSTINGS_PER_SEARCH_EMAIL = 10;

export function jobAlertEmail(input: {
  to: string;
  name: string;
  sections: JobAlertSection[];
  alertsUrl: string;
  settingsUrl: string;
  unsubscribeUrl: string;
  alertHour: number;
  headers?: Record<string, string>;
}): EmailMessage {
  const total = input.sections.reduce((n, s) => n + s.postings.length + s.more, 0);
  const subject =
    input.sections.length === 1 ? `${plural(total, "new job")} for "${truncate(input.sections[0]!.searchName, 60)}"` : `${plural(total, "new job")} from your saved searches`;
  const intro = `Hi ${firstName(input.name)}, here ${total === 1 ? "is the job" : `are the ${total} jobs`} posted since your last alert that match${total === 1 ? "es" : ""} your saved search${input.sections.length === 1 ? "" : "es"}. Add the ones you like to your jobs in ${PRODUCT_NAME} and they'll be scored like any other.`;
  const posting = (p: JobAlertPosting) =>
    `<a href="${escapeHtml(p.url)}" style="color:#18181b;font-weight:600;text-decoration:none">${escapeHtml(p.title)}</a>` +
    `<br><span style="font-size:13px;color:#52525b">${escapeHtml([p.company, p.location, p.salaryText].filter(Boolean).join(" · "))}</span>`;
  const bodyHtml = input.sections
    .map(
      (s) =>
        `<h2 style="margin:16px 0 8px;font-size:14px">${escapeHtml(s.searchName)} <span style="font-weight:400;color:#6b7280">(${plural(s.postings.length + s.more, "new job")})</span></h2>` +
        listHtml([
          ...s.postings.map(posting),
          ...(s.more > 0 ? [`<a href="${escapeHtml(input.alertsUrl)}" style="color:#52525b">and ${plural(s.more, "more job")} in ${PRODUCT_NAME}</a>`] : []),
        ]),
    )
    .join("");
  const text = [
    intro,
    ...input.sections.flatMap((s) => [
      "",
      `${s.searchName} (${plural(s.postings.length + s.more, "new job")})`,
      ...s.postings.flatMap((p) => [`- ${p.title}, ${[p.company, p.location, p.salaryText].filter(Boolean).join(" · ")}`, `  ${p.url}`]),
      ...(s.more > 0 ? [`  and ${plural(s.more, "more job")}: ${input.alertsUrl}`] : []),
    ]),
    "",
    `See all new matches: ${input.alertsUrl}`,
    "",
    `Change the time or turn these emails off in Settings (${input.settingsUrl}) or unsubscribe: ${input.unsubscribeUrl}`,
  ].join("\n");
  return {
    to: input.to,
    subject,
    text,
    headers: input.headers,
    html: layout({
      preheader: input.sections.map((s) => `${s.searchName}: ${s.postings.length + s.more} new`).join(", "),
      heading: `${plural(total, "new job")} for you`,
      intro,
      bodyHtml,
      button: { label: "Review new matches", url: input.alertsUrl },
      footer: `Your saved searches run every morning around ${formatHour(input.alertHour)}. You only get an email when there's something new.`,
      unsubscribe: { label: "Stop job alert emails", url: input.unsubscribeUrl },
    }),
  };
}

// ── Test email ──────────────────────────────────────────────────────────────

export function testEmail(input: { to: string; name: string; settingsUrl: string }): EmailMessage {
  const intro = `Hi ${firstName(input.name)}, this is a test from ${PRODUCT_NAME}. If you can read it, Needs Attention alerts and daily job alerts will reach this inbox.`;
  return {
    to: input.to,
    subject: `${PRODUCT_NAME} test email`,
    text: `${intro}\n\nYour notification settings: ${input.settingsUrl}`,
    html: layout({
      preheader: "Your alerts will arrive here.",
      heading: "Your email alerts work",
      intro,
      bodyHtml: "",
      button: { label: "Notification settings", url: input.settingsUrl },
      footer: "You asked for this test email in Settings.",
    }),
  };
}
