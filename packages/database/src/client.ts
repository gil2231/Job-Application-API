import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { __autoapplyPrisma?: PrismaClient };

/**
 * Shared Prisma client. Reused across hot reloads in development so we do not
 * exhaust Postgres connections.
 */
export const prisma: PrismaClient =
  globalForPrisma.__autoapplyPrisma ??
  new PrismaClient({ log: process.env.PRISMA_LOG === "query" ? ["query", "warn", "error"] : ["warn", "error"] });

if (process.env.NODE_ENV !== "production") globalForPrisma.__autoapplyPrisma = prisma;
