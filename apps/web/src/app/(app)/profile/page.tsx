import type { Metadata } from "next";
import { CheckCircle2 } from "lucide-react";
import { getFullProfile, profileCompleteness } from "@autoapply/database";
import { requireUser } from "@/lib/auth";
import { loadDocumentData } from "@/lib/documents-data";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { DocumentManager } from "../documents/document-manager";
import { ProfileTabs } from "./profile-tabs";
import { PersonalForm } from "./personal-form";
import { ProfessionalForm } from "./professional-form";
import { EducationSection } from "./education-section";
import { EmploymentSection } from "./employment-section";

export const metadata: Metadata = { title: "Master Profile" };

export default async function ProfilePage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const user = await requireUser();
  const [{ tab }, profile, docs] = await Promise.all([searchParams, getFullProfile(user.id), loadDocumentData(user.id)]);
  const completeness = profileCompleteness(profile, { resumes: docs.documents.filter((d) => d.type === "RESUME").length });

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Master Profile"
        description="Enter your information once. Every application is filled from here, and nothing outside it is ever invented."
      />
      <Card className="gap-3 py-4">
        <CardHeader className="px-4">
          <CardTitle className="flex items-center gap-2 text-sm">
            {completeness.percent === 100 && <CheckCircle2 className="text-success size-4" />}
            Profile {completeness.percent}% complete
          </CardTitle>
          {completeness.missing.length > 0 && <CardDescription>Still missing: {completeness.missing.join(", ")}</CardDescription>}
        </CardHeader>
        <CardContent className="px-4">
          <Progress value={completeness.percent} />
        </CardContent>
      </Card>
      <ProfileTabs
        initialTab={tab}
        counts={{ education: profile.education.length, employment: profile.employment.length, documents: docs.documents.length }}
        personal={<PersonalForm profile={profile} />}
        professional={<ProfessionalForm profile={profile} />}
        education={<EducationSection records={profile.education} />}
        employment={<EmploymentSection records={profile.employment} />}
        documents={<DocumentManager {...docs} />}
      />
    </div>
  );
}
