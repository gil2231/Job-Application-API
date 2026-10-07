import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getFullProfile, getUserSettings, listDocuments } from "@autoapply/database";
import { RESUME_PERSONAL_FIELDS } from "@autoapply/shared";
import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { ResumeImport, type CurrentProfile } from "./resume-import";

export const metadata: Metadata = { title: "Import from resume" };

const READABLE = /\.(pdf|docx|txt)$/i;

export default async function ImportResumePage() {
  const user = await requireUser();
  const [profile, documents, settings] = await Promise.all([getFullProfile(user.id), listDocuments(user.id), getUserSettings(user.id)]);
  const current: CurrentProfile = {
    personal: Object.fromEntries(RESUME_PERSONAL_FIELDS.map((k) => [k, profile[k] ?? null])) as CurrentProfile["personal"],
    currentTitle: profile.currentTitle,
    summary: profile.summary,
    skills: profile.skills.map((s) => s.name),
    employment: profile.employment.map((e) => ({ company: e.company, title: e.title })),
    education: profile.education.map((e) => e.school),
  };
  const resumes = documents
    .filter((d) => d.type === "RESUME" && READABLE.test(d.fileName))
    .map((d) => ({ id: d.id, label: d.job ? `${d.name} (for ${d.job.company})` : d.name, fileName: d.fileName }));
  const aiOn = !!(settings.aiProvider || (process.env.AI_PROVIDER && process.env.AI_PROVIDER !== "none"));

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Import from resume"
        description="Upload your resume and Applyance fills in your Master Profile from it. You review every field first, and nothing is saved until you confirm."
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link href="/profile">
              <ArrowLeft />
              Master Profile
            </Link>
          </Button>
        }
      />
      <ResumeImport current={current} resumes={resumes} aiOn={aiOn} hasResume={documents.some((d) => d.type === "RESUME")} />
    </div>
  );
}
