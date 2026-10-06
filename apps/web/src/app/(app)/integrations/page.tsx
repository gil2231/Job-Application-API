import type { Metadata } from "next";
import { Globe, Link2 } from "lucide-react";
import { listJobSources } from "@autoapply/database";
import { enumLabel, PLATFORMS } from "@autoapply/shared";
import { requireUser } from "@/lib/auth";
import { formatRelative } from "@/lib/format";
import { getWorkerStatus } from "@/lib/worker-status";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Integrations" };

export default async function IntegrationsPage() {
  const user = await requireUser();
  const [sources, worker] = await Promise.all([listJobSources(user.id), getWorkerStatus()]);
  const installed = new Set(worker.state === "online" ? worker.heartbeat.adapters : []);

  return (
    <div className="grid gap-5">
      <PageHeader title="Integrations" description="Where jobs come from, and which application platforms AutoApply can work with." />
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Job sources</CardTitle>
          <CardDescription>
            Jobs you add by URL appear under Manual entry. Importing LinkedIn saved jobs uses only paths you authorize (an export or your own signed-in session) and is added with the ingestion phase.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="divide-y rounded-lg border">
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
          <CardTitle className="text-sm">Application platforms</CardTitle>
          <CardDescription>
            Every job&apos;s platform is detected from its URL today. A platform shows as Automated once the running worker has an adapter for it.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {PLATFORMS.filter((p) => p !== "UNKNOWN").map((p) => (
              <div key={p} className="flex items-center gap-3 rounded-lg border px-3 py-2.5">
                <Globe className="text-muted-foreground size-4" />
                <span className="flex-1 text-sm">{p === "GENERIC" ? "Other web forms" : enumLabel(p)}</span>
                {installed.has(p) ? <Badge variant="success">Automated</Badge> : <Badge variant="muted">Detection</Badge>}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
