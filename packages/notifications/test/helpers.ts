import { createUser, prisma } from "@autoapply/database";
import type { AttentionReason } from "@autoapply/shared";

let counter = 0;

export async function resetDatabase() {
  if (!/test/i.test(new URL(process.env.DATABASE_URL!).pathname)) throw new Error("Refusing to truncate a non-test database");
  const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length) await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
}

export async function makeUser(name = "Jordan Lee") {
  counter += 1;
  return createUser({ name, email: `notify${counter}-${Date.now()}@example.com`, password: "correct-horse-1" });
}

/** An application the worker paused on, with its Needs Attention event created at `at`. */
export async function pausedApplication(userId: string, input: { title: string; company: string; reason: AttentionReason; detail: string; at: Date; status?: "WAITING_FOR_USER" | "REVIEW_REQUIRED" | "READY" }) {
  counter += 1;
  const job = await prisma.job.create({
    data: { userId, sourceType: "MANUAL", url: `https://jobs.example.com/${counter}`, canonicalUrl: `https://jobs.example.com/${counter}`, title: input.title, company: input.company, status: "QUALIFIED" },
  });
  const application = await prisma.application.create({
    data: { userId, jobId: job.id, status: input.status ?? "WAITING_FOR_USER", attentionReason: input.reason, attentionDetail: input.detail },
  });
  const event = await prisma.applicationEvent.create({
    data: { applicationId: application.id, userId, type: "HUMAN_INPUT_REQUIRED", level: "WARNING", message: input.detail, createdAt: input.at },
  });
  return { job, application, event };
}
