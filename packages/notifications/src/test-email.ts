import { getAlertRecipient, recordNotification } from "@autoapply/database";
import type { EmailSender } from "./email";
import { appUrl } from "./links";
import { testEmail } from "./templates";

/** Send the Settings page's test email. Returns a message for the user. */
export async function sendTestEmail(userId: string, sender: EmailSender, env: NodeJS.ProcessEnv = process.env): Promise<{ ok: boolean; message: string }> {
  const user = await getAlertRecipient(userId);
  if (!user) return { ok: false, message: "Account not found" };
  const message = testEmail({ to: user.email, name: user.name, settingsUrl: appUrl("/settings#notifications", env) });
  if (!sender.configured) {
    await recordNotification({ userId, kind: "TEST", status: "SKIPPED", recipient: user.email, subject: message.subject, error: "No email provider is set up" });
    return { ok: false, message: "Email isn't set up on this server yet, so nothing was sent." };
  }
  try {
    const sent = await sender.send(message);
    await recordNotification({ userId, kind: "TEST", status: "SENT", recipient: user.email, subject: message.subject, providerMessageId: sent.id });
    return { ok: true, message: `Test email sent to ${user.email}` };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await recordNotification({ userId, kind: "TEST", status: "FAILED", recipient: user.email, subject: message.subject, error: reason });
    return { ok: false, message: `The test email couldn't be sent: ${reason}` };
  }
}
