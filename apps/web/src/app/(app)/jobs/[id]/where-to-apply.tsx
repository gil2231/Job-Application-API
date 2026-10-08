"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ExternalLink, Loader2, Route } from "lucide-react";
import { toast } from "sonner";
import { followJobAction } from "@/actions/follow";
import { Button } from "@/components/ui/button";

/** For a job saved from LinkedIn, Handshake or another listing site: where Applyance will apply, and a way to look now. */
export function WhereToApply({ jobId, company, site, listingUrl, searchesJSearch }: { jobId: string; company: string; site: string; listingUrl: string; searchesJSearch: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [notFound, setNotFound] = useState<string | null>(null);
  const find = () =>
    start(async () => {
      const result = await followJobAction(jobId);
      if (result.ok) {
        toast.success(result.message);
        router.refresh();
      } else setNotFound(result.message ?? "Couldn't find it.");
    });

  return (
    <div className="bg-primary/5 border-primary/20 grid gap-3 rounded-lg border px-4 py-3 text-sm" data-testid="where-to-apply">
      <div className="flex gap-3">
        <Route className="text-primary mt-0.5 size-4 shrink-0" />
        <p>
          Saved from {site}. Applyance applies on {company}&apos;s own site, never on {site}. When you apply, it looks for this job on {company}&apos;s public job board
          {searchesJSearch ? " and through JSearch" : ""}. If it can&apos;t be found there (for example a {site === "LinkedIn" ? "LinkedIn Easy Apply" : `${site}-only`} job), it goes to Needs
          Attention for you to apply on {site} yourself.
        </p>
      </div>
      {notFound && (
        <p role="alert" className="text-muted-foreground text-[13px]">
          {notFound}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" onClick={find} disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : <Route />}
          {pending ? "Looking…" : "Find the company's application"}
        </Button>
        <Button asChild size="sm" variant="outline">
          <a href={listingUrl} target="_blank" rel="noopener noreferrer">
            <ExternalLink /> Apply on {site} yourself
          </a>
        </Button>
      </div>
    </div>
  );
}
