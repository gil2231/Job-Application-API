import type { Metadata } from "next";
import { requireUser } from "@/lib/auth";
import { loadDocumentData } from "@/lib/documents-data";
import { PageHeader } from "@/components/page-header";
import { DocumentManager } from "./document-manager";

export const metadata: Metadata = { title: "Documents" };

export default async function DocumentsPage() {
  const user = await requireUser();
  const data = await loadDocumentData(user.id);
  return (
    <div className="grid gap-6">
      <PageHeader title="Documents" description="Resumes, cover letters, certifications, transcripts and portfolio files used in your applications." />
      <DocumentManager {...data} />
    </div>
  );
}
