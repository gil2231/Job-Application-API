import { prisma } from "../src/client";
import { createUser } from "../src/repositories/auth";

let counter = 0;

export async function resetDatabase() {
  if (!/test/i.test(new URL(process.env.DATABASE_URL!).pathname)) throw new Error("Refusing to truncate a non-test database");
  const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length) {
    await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} CASCADE`);
  }
}

export async function makeUser(name = "Test User") {
  counter += 1;
  return createUser({ name, email: `user${counter}-${Date.now()}@example.com`, password: "correct-horse-1" });
}
