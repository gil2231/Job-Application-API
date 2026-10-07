import "server-only";
import { headers } from "next/headers";
import type { AuditContext } from "@autoapply/database";

/**
 * The client's IP from X-Forwarded-For. Each proxy appends the address it saw,
 * so the trustworthy entry is the one added by our own outermost proxy:
 * counting TRUSTED_PROXY_HOPS (default 1) from the right. Entries further left
 * are whatever the client claimed and could be forged to dodge rate limits.
 * Set TRUSTED_PROXY_HOPS=0 when nothing sits in front of the app.
 */
export function clientIp(forwardedFor: string | null, realIp: string | null, hops: number): string {
  if (hops > 0 && forwardedFor) {
    const chain = forwardedFor.split(",").map((s) => s.trim()).filter(Boolean);
    const ip = chain[Math.max(0, chain.length - hops)];
    if (ip) return ip;
  }
  if (hops > 0 && realIp) return realIp.trim();
  return "unknown";
}

function trustedHops(): number {
  const n = Number.parseInt(process.env.TRUSTED_PROXY_HOPS ?? "", 10);
  return Number.isFinite(n) && n >= 0 ? n : 1;
}

/** Client IP and user agent for rate limiting and audit logs. */
export async function getRequestContext(): Promise<AuditContext & { ipAddress: string }> {
  const h = await headers();
  return {
    ipAddress: clientIp(h.get("x-forwarded-for"), h.get("x-real-ip"), trustedHops()),
    userAgent: h.get("user-agent")?.slice(0, 500) ?? null,
  };
}
