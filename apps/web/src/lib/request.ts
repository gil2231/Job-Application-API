import "server-only";
import { headers } from "next/headers";
import type { AuditContext } from "@autoapply/database";

/** Client IP and user agent for rate limiting and audit logs. */
export async function getRequestContext(): Promise<AuditContext & { ipAddress: string }> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return {
    ipAddress: forwarded || h.get("x-real-ip") || "unknown",
    userAgent: h.get("user-agent"),
  };
}
