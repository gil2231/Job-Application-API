"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit, deleteMailConnection, listMailConnections, updateMailConnectionSettings } from "@autoapply/database";
import { dismissEmail, linkEmailToApplication, revokeToken, syncMailConnection } from "@autoapply/inbox";
import { authedAction, parseIds, type ActionResult } from "@/lib/action";
import { appUrl, syncCalendarSoon } from "@/lib/mail";

const one = (id: unknown) => parseIds([id])[0];

function refresh() {
  revalidatePath("/integrations");
  revalidatePath("/integrations/email");
  revalidatePath("/flightpath");
  revalidatePath("/dashboard");
}

async function ownConnection(userId: string, id: string) {
  return (await listMailConnections(userId)).find((c) => c.id === id) ?? null;
}

export async function syncMailNowAction(connectionId: string): Promise<ActionResult> {
  return authedAction(async (user) => {
    const id = one(connectionId);
    if (!id || !(await ownConnection(user.id, id))) return { ok: false, message: "Invalid request" };
    const report = await syncMailConnection(id, { appUrl: appUrl() });
    refresh();
    if (report.status === "busy") return { ok: true, message: "A sync is already running" };
    if (report.status === "reconnect") return { ok: false, message: "The sign-in for this account has expired. Connect it again." };
    if (report.status !== "ok") return { ok: false, message: "Sync didn't finish. Try again in a minute." };
    const e = report.email;
    const parts = e ? [e.moved && `${e.moved} moved`, e.interviewsAdded && `${e.interviewsAdded} interview${e.interviewsAdded === 1 ? "" : "s"} added`, e.suggested && `${e.suggested} to check`, e.unmatched && `${e.unmatched} to match`].filter(Boolean) : [];
    return { ok: true, message: parts.length ? `Synced: ${parts.join(", ")}` : "Synced. Nothing new." };
  });
}

const settingsSchema = z.object({ readEmail: z.boolean().optional(), autoUpdate: z.boolean().optional(), calendarSync: z.boolean().optional() }).strict();

export async function updateMailSettingsAction(connectionId: string, input: unknown): Promise<ActionResult> {
  return authedAction(async (user) => {
    const id = one(connectionId);
    const parsed = settingsSchema.safeParse(input);
    if (!id || !parsed.success) return { ok: false, message: "Invalid request" };
    const connection = await ownConnection(user.id, id);
    if (!connection) return { ok: false, message: "Invalid request" };
    await updateMailConnectionSettings(user.id, id, parsed.data);
    await audit(user.id, "mail.settings_changed", { entityType: "MailConnection", entityId: id, metadata: parsed.data });
    if (parsed.data.calendarSync) syncCalendarSoon(user.id);
    refresh();
    return { ok: true, message: "Saved" };
  });
}

export async function disconnectMailAction(connectionId: string): Promise<ActionResult> {
  return authedAction(async (user) => {
    const id = one(connectionId);
    if (!id) return { ok: false, message: "Invalid request" };
    const removed = await deleteMailConnection(user.id, id);
    // Ask Google to forget the grant too. Microsoft has no per-app revoke.
    await revokeToken(removed.provider, removed.refreshToken ?? removed.accessToken);
    await audit(user.id, "mail.disconnected", { entityType: "MailConnection", entityId: id, metadata: { provider: removed.provider } });
    refresh();
    return { ok: true, message: "Disconnected" };
  });
}

export async function linkEmailAction(emailId: string, applicationId: string): Promise<ActionResult> {
  return authedAction(async (user) => {
    const id = one(emailId);
    const appId = one(applicationId);
    if (!id || !appId) return { ok: false, message: "Invalid request" };
    const { outcome } = await linkEmailToApplication(user.id, id, appId);
    await audit(user.id, "mail.email_linked", { entityType: "EmailMessage", entityId: id, metadata: { applicationId: appId, outcome } });
    syncCalendarSoon(user.id);
    refresh();
    revalidatePath(`/applications/${appId}`);
    const message = outcome === "MOVED" ? "Linked and moved" : outcome === "INTERVIEW_ADDED" ? "Linked and interview added" : outcome === "SUGGESTED" ? "Linked. It's on the application's timeline to check." : "Linked";
    return { ok: true, message };
  });
}

export async function dismissEmailAction(emailId: string): Promise<ActionResult> {
  return authedAction(async (user) => {
    const id = one(emailId);
    if (!id) return { ok: false, message: "Invalid request" };
    await dismissEmail(user.id, id);
    refresh();
    return { ok: true, message: "Dismissed" };
  });
}
