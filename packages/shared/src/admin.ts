import { z } from "zod";
import { FAILURE_TYPES, PLATFORMS } from "./enums";

/** Search params for the admin Users page. Bad values fall back to defaults. */
export const adminUserFiltersSchema = z.object({
  q: z.string().trim().max(200).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10_000).default(1).catch(1),
});
export type AdminUserFiltersInput = z.infer<typeof adminUserFiltersSchema>;

/** Search params for the admin Failing applications page. */
export const adminFailureFiltersSchema = z.object({
  scope: z.enum(["failed", "stuck", "all"]).default("failed").catch("failed"),
  failureType: z.enum(FAILURE_TYPES).optional().catch(undefined),
  platform: z.enum(PLATFORMS).optional().catch(undefined),
  page: z.coerce.number().int().min(1).max(10_000).default(1).catch(1),
});
export type AdminFailureFiltersInput = z.infer<typeof adminFailureFiltersSchema>;
