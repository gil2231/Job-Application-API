import { requireAdmin } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { AdminNav } from "./admin-nav";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Each admin page checks again: layouts are not re-rendered on every navigation.
  await requireAdmin();
  return (
    <div className="grid gap-5">
      <PageHeader
        title="Admin"
        description="Applyance as a business: your users, their accounts, and automation that needs fixing. Profiles, resumes, salaries and answers are never shown here."
      />
      <AdminNav />
      {children}
    </div>
  );
}
