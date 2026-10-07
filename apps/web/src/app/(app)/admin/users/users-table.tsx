"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Search, Users } from "lucide-react";
import type { listAdminUsers } from "@autoapply/database";
import { Pagination } from "@/components/data-table";
import { TimeAgo } from "@/components/local-time";
import { EmptyState } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate } from "@/lib/format";
import { useSearchParamsState } from "@/lib/use-search-params-state";

type Data = Awaited<ReturnType<typeof listAdminUsers>> & { pageSize: number };

export function UsersTable({ data }: { data: Data }) {
  const { params, set } = useSearchParamsState();
  const [q, setQ] = useState(params.get("q") ?? "");
  useEffect(() => {
    if (q === (params.get("q") ?? "")) return;
    const t = setTimeout(() => set({ q }), 300);
    return () => clearTimeout(t);
  }, [q, params, set]);

  return (
    <div className="grid gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-muted-foreground text-sm">
          {data.total.toLocaleString()} {data.total === 1 ? "user" : "users"}
        </p>
        <div className="relative w-full sm:w-72">
          <Search className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or email" className="h-8 pl-8" aria-label="Search users" />
        </div>
      </div>

      {data.total === 0 ? (
        <div className="rounded-xl border">
          <EmptyState icon={Users} title="No users found" description={params.get("q") ? "No one matches that search." : "No one has signed up yet."} />
        </div>
      ) : (
        <>
          <div className="bg-card rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead>Joined</TableHead>
                  <TableHead>Last active</TableHead>
                  <TableHead className="text-right">Jobs</TableHead>
                  <TableHead className="text-right">Submitted</TableHead>
                  <TableHead className="text-right">Failed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.users.map((u) => (
                  <TableRow key={u.id}>
                    <TableCell className="max-w-72">
                      <Link href={`/admin/users/${u.id}`} className="group block min-w-0">
                        <span className="flex items-center gap-1.5">
                          <span className="truncate font-medium group-hover:underline">{u.name}</span>
                          {u.role === "ADMIN" && <Badge variant="info">Admin</Badge>}
                          {u.locked && <Badge variant="warning">Locked</Badge>}
                        </span>
                        <span className="text-muted-foreground block truncate text-xs">{u.email}</span>
                      </Link>
                    </TableCell>
                    <TableCell className="text-[13px]">{u.plan}</TableCell>
                    <TableCell className="text-[13px]">{formatDate(u.createdAt)}</TableCell>
                    <TableCell className="text-[13px]">{u.lastActiveAt ? <TimeAgo value={u.lastActiveAt} /> : <span className="text-muted-foreground">Never</span>}</TableCell>
                    <TableCell className="text-right tabular-nums">{u.jobs}</TableCell>
                    <TableCell className="text-right tabular-nums">{u.submitted}</TableCell>
                    <TableCell className="text-right tabular-nums">{u.failed > 0 ? <span className="text-destructive">{u.failed}</span> : 0}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Pagination page={data.page} pageCount={data.pageCount} total={data.total} pageSize={data.pageSize} />
        </>
      )}
    </div>
  );
}
