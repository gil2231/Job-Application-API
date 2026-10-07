import "server-only";
import { ConflictError, NotFoundError } from "@autoapply/database";
import { fieldErrors, createLogger } from "@autoapply/shared";
import type { z } from "zod";
import { requireUser } from "./auth";
import { LIMITS, rateLimit } from "./rate-limit";

const log = createLogger("action");

export interface ActionResult<T = undefined> {
  ok: boolean;
  message?: string;
  errors?: Record<string, string>;
  data?: T;
}

/** Convert FormData to a plain object; repeated keys become arrays. */
export function formToObject(formData: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of formData.entries()) {
    if (key.startsWith("$ACTION")) continue;
    if (key in out) {
      const prev = out[key];
      out[key] = Array.isArray(prev) ? [...prev, value] : [prev, value];
    } else {
      out[key] = value;
    }
  }
  return out;
}

export function validationFailed(error: z.ZodError): ActionResult<never> {
  return { ok: false, message: "Please fix the highlighted fields.", errors: fieldErrors(error) };
}

/**
 * Wrap a mutation: requires a signed-in user, applies the per-user mutation
 * rate limit, and turns domain errors into user-facing messages.
 */
export async function authedAction<T>(
  fn: (user: Awaited<ReturnType<typeof requireUser>>) => Promise<ActionResult<T>>,
): Promise<ActionResult<T>> {
  const user = await requireUser();
  const limit = await rateLimit(`mutation:${user.id}`, LIMITS.mutation.limit, LIMITS.mutation.windowMs);
  if (!limit.allowed) return { ok: false, message: `Too many requests. Try again in ${limit.retryAfterSeconds}s.` };
  try {
    return await fn(user);
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof ConflictError) return { ok: false, message: error.message };
    // Let Next.js redirects and notFound() propagate.
    if (error && typeof error === "object" && "digest" in error) throw error;
    log.error("Unexpected error in a server action", { error });
    return { ok: false, message: "Something went wrong. Please try again." };
  }
}

/** Parse an id list from a server action argument, rejecting anything that is not a cuid-like string. */
export function parseIds(ids: unknown, max = 500): string[] {
  if (!Array.isArray(ids)) return [];
  return ids.filter((id): id is string => typeof id === "string" && /^[a-z0-9]{20,40}$/i.test(id)).slice(0, max);
}
