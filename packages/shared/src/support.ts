import { z } from "zod";

// Mirrors the SupportCategory and SupportStatus enums in the Prisma schema.
export const SUPPORT_CATEGORIES = ["BUG", "APPLICATION", "ACCOUNT", "BILLING", "PRIVACY", "FEEDBACK", "OTHER"] as const;
export type SupportCategory = (typeof SUPPORT_CATEGORIES)[number];

export const SUPPORT_STATUSES = ["OPEN", "RESOLVED"] as const;
export type SupportStatus = (typeof SUPPORT_STATUSES)[number];

export const SUPPORT_CATEGORY_LABELS: Record<SupportCategory, string> = {
  BUG: "Something isn't working",
  APPLICATION: "A problem with an application",
  ACCOUNT: "Account or sign-in",
  BILLING: "Billing or my plan",
  PRIVACY: "Privacy or my data",
  FEEDBACK: "Feedback or a suggestion",
  OTHER: "Something else",
};

export const SUPPORT_MESSAGE_MAX = 5000;

/** Strip a query string and fragment so tokens or search terms in a URL are never stored. */
export function supportPagePath(value: string | undefined): string | undefined {
  if (!value?.startsWith("/") || value.startsWith("//")) return undefined;
  const path = value.split(/[?#]/, 1)[0]!;
  return path.slice(0, 300) || undefined;
}

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => v || undefined);

export const supportRequestSchema = z.object({
  category: z.enum(SUPPORT_CATEGORIES, "Choose what this is about"),
  subject: z.string().trim().min(3, "Add a short summary").max(150, "Keep the summary under 150 characters"),
  message: z
    .string()
    .trim()
    .min(10, "Tell us a little more so we can help")
    .max(SUPPORT_MESSAGE_MAX, `Keep the message under ${SUPPORT_MESSAGE_MAX} characters`),
  pagePath: z.string().optional().transform(supportPagePath),
  applicationId: z
    .string()
    .regex(/^[a-z0-9]{20,40}$/i)
    .optional()
    .or(z.literal("").transform(() => undefined)),
});
export type SupportRequestInput = z.infer<typeof supportRequestSchema>;

/** Signed-out visitors also give a name and an email to reply to. */
export const publicSupportRequestSchema = supportRequestSchema.extend({
  name: optionalText(120),
  email: z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address")).pipe(z.string().max(254)),
});
export type PublicSupportRequestInput = z.infer<typeof publicSupportRequestSchema>;
