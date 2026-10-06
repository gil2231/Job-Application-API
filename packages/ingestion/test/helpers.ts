import { createUser, prisma } from "@autoapply/database";

let counter = 0;

export async function resetDatabase() {
  if (!/test/i.test(new URL(process.env.DATABASE_URL!).pathname)) throw new Error("Refusing to truncate a non-test database");
  const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length) await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
}

export async function makeUser() {
  counter += 1;
  return createUser({ name: "Test User", email: `ingest${counter}-${Date.now()}@example.com`, password: "correct-horse-1" });
}

export const BDR_DESCRIPTION = `About Acme
Acme is a B2B SaaS platform for finance teams.

The Role
We're hiring a Business Development Representative to generate pipeline. This is a hybrid role in our New York office.

Requirements:
• 1+ years of experience in sales or customer-facing roles
• Bachelor's degree or equivalent experience
• Experience with Salesforce and cold calling

Compensation
The base salary range for this role is $65,000 - $75,000 per year plus commission.

This is a full-time position.`;
