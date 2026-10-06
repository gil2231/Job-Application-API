import { Suspense } from "react";
import type { Metadata } from "next";
import { FileSpreadsheet, Globe, Link2, Sparkles } from "lucide-react";
import { getUserSettings, listJobImports, listJobSources, listMailConnections, countEmailsToReview } from "@autoapply/database";
import { createJobAnalyzer } from "@autoapply/ai";
import Link from "next/link";
import { AUTOMATED_PLATFORMS } from "@autoapply/ats-adapters";
import { enumLabel, PLATFORMS, type Platform } from "@autoapply/shared";
import { requireUser } from "@/lib/auth";
import { formatRelative } from "@/lib/format";
import { mailProviderSetup } from "@/lib/mail";
import { getWorkerStatus } from "@/lib/worker-status";
import { MailConnectNotice, MailConnections } from "./mail-connections";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Integrations" };

/** What's worth knowing about how each platform is handled. */
const PLATFORM_NOTES: Partial<Record<Platform, string>> = {
  WORKDAY: "Asks for a candidate account per employer. You sign in once; the session is reused.",
  GREENHOUSE: "Including boards embedded on employer career sites.",
  LEVER: "Fields Lever fills from your resume are reset to your profile.",
  ASHBY: "Resume autofill is skipped; answers come from your profile.",
  SMARTRECRUITERS: "Never uses Apply with LinkedIn or Indeed.",
  LINKEDIN_EASY_APPLY: "Needs your LinkedIn sign-in, so it's never automated. Add the employer's own link instead.",
  GENERIC: "Any other application form, filled by its labels.",
};

export default async function IntegrationsPage() {
  const user = await requireUser();
  const [sources, worker, imports, settings, mail, toReview] = await Promise.all([
    listJobSources(user.id),
    getWorkerStatus(),
    listJobImports(user.id, 10),
    getUserSettings(user.id),
    listMailConnections(user.id),
    countEmailsToReview(user.id),
  ]);
  const analyzer = createJobAnalyzer({ provider: settings.aiProvider, model: settings.aiModel }).info;
  const installed = new Set(worker.state === "online" ? worker.heartbeat.adapters : []);

  return (
    <div className="grid gap-5">
      <PageHeader title="Integrations" description="Where jobs come from, your email and calendar, and which application platforms Applyance can work with." />
      <Suspense>
        <MailConnectNotice />
      </Suspense>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Email and calendar</CardTitle>
          <CardDescription>
            Connect Gmail or Outlook and Applyance keeps Flightpath up to date from employers&apos; replies: rejections, interview invites and offers. It only opens emails that mention a company
            you applied to or come from a hiring system, and keeps just the sender, subject and a short preview. Interviews can go on your calendar too.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <MailConnections connections={mail} setup={mailProviderSetup()} toReview={toReview} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Job sources</CardTitle>
          <CardDescription>
            Import from the Jobs page. LinkedIn saved jobs come from the data export you download from LinkedIn; AutoApply never signs in to LinkedIn or reads its pages.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {sources.length === 0 && <p className="text-muted-foreground text-sm">No jobs imported yet.</p>}
          <ul className={sources.length ? "divide-y rounded-lg border" : "hidden"}>
            {sources.map((s) => (
              <li key={s.id} className="flex items-center gap-3 px-4 py-3">
                <div className="bg-muted text-muted-foreground grid size-8 place-items-center rounded-md">
                  <Link2 className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{s.name}</p>
                  <p className="text-muted-foreground text-xs">
                    {enumLabel(s.type)} · {s.jobCount} job{s.jobCount === 1 ? "" : "s"}
                    {s.lastSyncedAt && ` · synced ${formatRelative(s.lastSyncedAt)}`}
                  </p>
                  {s.lastError && <p className="text-destructive text-xs">{s.lastError}</p>}
                </div>
                <Badge variant={s.enabled ? "success" : "muted"}>{s.enabled ? "Active" : "Disabled"}</Badge>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Recent imports</CardTitle>
          <CardDescription>Each import, with how many jobs were new, already in your list, or skipped.</CardDescription>
        </CardHeader>
        <CardContent>
          {imports.length === 0 ? (
            <p className="text-muted-foreground text-sm">No imports yet.</p>
          ) : (
            <ul className="divide-y rounded-lg border" data-testid="import-history">
              {imports.map((run) => (
                <li key={run.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="bg-muted text-muted-foreground grid size-8 place-items-center rounded-md">
                    <FileSpreadsheet className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {run.source.name}
                      {run.fileName && <span className="text-muted-foreground font-normal"> · {run.fileName}</span>}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {run.createdCount} new · {run.duplicateCount} already in list · {run.skippedCount} skipped
                      {run.failedCount > 0 && ` · ${run.failedCount} unreadable`} · {formatRelative(run.createdAt)}
                    </p>
                    {run.error && <p className="text-destructive text-xs">{run.error}</p>}
                  </div>
                  <Badge variant={run.status === "COMPLETED" ? "success" : run.status === "FAILED" ? "destructive" : "info"}>{enumLabel(run.status)}</Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Job analysis</CardTitle>
          <CardDescription>How imported jobs are read and scored.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3 rounded-lg border px-4 py-3">
            <div className="bg-muted text-muted-foreground grid size-8 place-items-center rounded-md">
              <Sparkles className="size-4" />
            </div>
            <div className="min-w-0 flex-1 text-sm">
              {analyzer.method === "ai" ? (
                <p>
                  <span className="font-medium">AI analysis</span> with {analyzer.provider} ({analyzer.model}). If a request fails, the built-in analyzer is used for that job.
                </p>
              ) : (
                <p>
                  <span className="font-medium">Built-in analyzer.</span> <span className="text-muted-foreground">{analyzer.reason}. Choose a provider in <Link href="/settings" className="underline">Settings</Link> for AI extraction.</span>
                </p>
              )}
            </div>
            <Badge variant={analyzer.method === "ai" ? "success" : "muted"}>{analyzer.method === "ai" ? "AI" : "Built-in"}</Badge>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Application platforms</CardTitle>
          <CardDescription>
            Each job&apos;s platform is detected from its link, and again from the page when the worker opens it, so employer career sites that embed an ATS are recognized too.
            {worker.state !== "online" && " The worker isn't running, so nothing is being filled right now."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3" data-testid="platforms">
            {PLATFORMS.filter((p) => p !== "UNKNOWN").map((p) => {
              const supported = AUTOMATED_PLATFORMS.includes(p);
              return (
                <li key={p} className="flex items-start gap-3 rounded-lg border px-3 py-2.5">
                  <Globe className="text-muted-foreground mt-0.5 size-4 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm">{p === "GENERIC" ? "Other web forms" : enumLabel(p)}</p>
                    {PLATFORM_NOTES[p] && <p className="text-muted-foreground text-xs">{PLATFORM_NOTES[p]}</p>}
                  </div>
                  {installed.has(p) ? (
                    <Badge variant="success">Automated</Badge>
                  ) : supported ? (
                    <Badge variant="info" title="Supported; start the worker to fill these applications">
                      Supported
                    </Badge>
                  ) : (
                    <Badge variant="muted">Not automated</Badge>
                  )}
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
