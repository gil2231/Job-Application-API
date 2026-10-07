import { prisma } from "@autoapply/database";
import { WORKER_HEARTBEAT_KEY } from "@autoapply/shared";
import { getRedis } from "@/lib/redis";

export const dynamic = "force-dynamic";

type Check = "ok" | "unavailable";

const withTimeout = <T>(promise: Promise<T>, ms = 2000) => Promise.race([promise, new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms))]);

/**
 * Health check for load balancers and uptime monitors. Public, so it reports
 * only up/down per dependency. The database is required (503 without it);
 * Redis and the worker are reported, and their absence marks the service degraded.
 */
export async function GET() {
  const database: Check = await withTimeout(prisma.$queryRaw`SELECT 1`).then(() => "ok" as const, () => "unavailable" as const);
  let redis: Check = "unavailable";
  let worker: "online" | "offline" | "unknown" = "unknown";
  const client = await getRedis();
  if (client) {
    try {
      worker = (await withTimeout(client.get(WORKER_HEARTBEAT_KEY))) ? "online" : "offline";
      redis = "ok";
    } catch {
      /* reported as unavailable */
    }
  }
  const status = database !== "ok" ? "error" : redis !== "ok" || worker !== "online" ? "degraded" : "ok";
  return Response.json({ status, checks: { database, redis, worker } }, { status: status === "error" ? 503 : 200, headers: { "Cache-Control": "no-store" } });
}
