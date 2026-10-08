import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { NextConfig } from "next";

// Load the monorepo's root .env so every app shares one configuration.
const rootEnv = resolve(process.cwd(), "../../.env");
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  ...(process.env.NODE_ENV === "production"
    ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }]
    : []),
];

const nextConfig: NextConfig = {
  transpilePackages: ["@autoapply/shared", "@autoapply/database", "@autoapply/documents", "@autoapply/ats-adapters", "@autoapply/automation", "@autoapply/ai", "@autoapply/matching", "@autoapply/ingestion", "@autoapply/queue", "@autoapply/inbox", "@autoapply/notifications", "@autoapply/ops"],
  serverExternalPackages: ["@prisma/client", "@node-rs/argon2", "ioredis", "bullmq", "undici"],
  poweredByHeader: false,
  // `next dev` refuses its scripts to other hosts, which leaves pages dead when
  // the app is shared through a Cloudflare quick tunnel (a new name each start).
  allowedDevOrigins: ["*.trycloudflare.com"],
  experimental: {
    serverActions: { bodySizeLimit: "11mb" },
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // Browsers must always fetch the newest service worker so fixes reach installed apps.
      { source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }] },
    ];
  },
};

export default nextConfig;
