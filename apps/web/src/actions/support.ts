"use server";

import { audit, createSupportRequest } from "@autoapply/database";
import { publicSupportRequestSchema, supportRequestSchema } from "@autoapply/shared";
import { formToObject, validationFailed, type ActionResult } from "@/lib/action";
import { getSession } from "@/lib/auth";
import { LIMITS, rateLimit } from "@/lib/rate-limit";
import { getRequestContext } from "@/lib/request";

/**
 * "Report a problem" and the help center's contact form. Works signed out too,
 * so someone locked out of their account can still reach support; they then
 * give an email to reply to.
 */
export async function sendSupportRequestAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const context = await getRequestContext();
  const session = await getSession();
  // Bots fill every field; people never see this one.
  if (formData.get("website")) return { ok: true, message: "Thanks. We got your message." };

  const key = session ? `support:${session.user.id}` : `support:ip:${context.ipAddress}`;
  const limit = rateLimit(key, LIMITS.support.limit, LIMITS.support.windowMs);
  if (!limit.allowed) return { ok: false, message: `You've sent a lot of reports. Try again in ${Math.ceil(limit.retryAfterSeconds / 60)} min.` };

  const input = formToObject(formData);
  try {
    if (session) {
      const parsed = supportRequestSchema.safeParse(input);
      if (!parsed.success) return validationFailed(parsed.error);
      const created = await createSupportRequest({ ...parsed.data, userId: session.user.id, email: session.user.email, name: session.user.name, userAgent: context.userAgent });
      await audit(session.user.id, "support.requested", { entityType: "SupportRequest", entityId: created.id, metadata: { category: parsed.data.category }, context });
    } else {
      const parsed = publicSupportRequestSchema.safeParse(input);
      if (!parsed.success) return validationFailed(parsed.error);
      // Signed-out messages never link to an application.
      const created = await createSupportRequest({ ...parsed.data, applicationId: undefined, userId: null, userAgent: context.userAgent });
      await audit(null, "support.requested", { entityType: "SupportRequest", entityId: created.id, metadata: { category: parsed.data.category }, context });
    }
  } catch (error) {
    console.error("[support] failed to save a support request", error);
    return { ok: false, message: "We couldn't send that. Please try again, or email us instead." };
  }
  return { ok: true, message: "Thanks. We got your message and will reply by email." };
}
