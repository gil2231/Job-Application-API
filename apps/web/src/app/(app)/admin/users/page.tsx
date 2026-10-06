import type { Metadata } from "next";
import { listAdminUsers, ADMIN_PAGE_SIZE } from "@autoapply/database";
import { adminUserFiltersSchema } from "@autoapply/shared";
import { requireAdmin } from "@/lib/auth";
import { UsersTable } from "./users-table";

export const metadata: Metadata = { title: "Users · Admin" };

export default async function AdminUsersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin();
  const raw = await searchParams;
  const filters = adminUserFiltersSchema.parse(Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v])));
  const data = await listAdminUsers(filters);
  return <UsersTable data={{ ...data, pageSize: ADMIN_PAGE_SIZE }} />;
}
