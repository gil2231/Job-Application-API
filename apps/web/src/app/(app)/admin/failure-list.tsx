import Link from "next/link";
import type { listAdminFailures } from "@autoapply/database";
import { enumLabel } from "@autoapply/shared";
import { TimeAgo } from "@/components/local-time";
import { AttentionBadge, StatusBadge } from "@/components/status";
import { Badge } from "@/components/ui/badge";

export type AdminFailure = Awaited<ReturnType<typeof listAdminFailures>>["items"][number];

/** Failed or stuck applications, one card per application. Shared by the failures page and a user's page. */
export function FailureList({ items, showUser = true }: { items: AdminFailure[]; showUser?: boolean }) {
  return (
    <ul className="divide-y" data-testid="admin-failures">
      {items.map((item) => (
        <li key={item.id} className="grid gap-1.5 py-3 first:pt-0 last:pb-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-medium">
              {item.job.title} <span className="text-muted-foreground font-normal">at {item.job.company}</span>
            </span>
            <StatusBadge status={item.status} />
            {item.failureType && <Badge variant="destructive">{enumLabel(item.failureType)}</Badge>}
            {item.attentionReason && item.status !== "FAILED" && <AttentionBadge reason={item.attentionReason} />}
          </div>
          <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <span className="font-mono">{item.job.host}</span>
            {item.platform !== "UNKNOWN" && <span>{enumLabel(item.platform)}</span>}
            <span>
              {item.attemptCount} {item.attemptCount === 1 ? "attempt" : "attempts"}
            </span>
            <span>
              Updated <TimeAgo value={item.updatedAt} />
            </span>
            {showUser && (
              <Link href={`/admin/users/${item.user.id}`} className="hover:text-foreground underline-offset-2 hover:underline">
                {item.user.email}
              </Link>
            )}
          </div>
          {item.lastError && <p className="bg-muted/60 rounded-md px-2.5 py-1.5 font-mono text-xs break-words whitespace-pre-wrap">{item.lastError}</p>}
        </li>
      ))}
    </ul>
  );
}
