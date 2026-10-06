import type { Metadata } from "next";
import { getUserSettings, listAuditLogs, listBrowserSessions, listSessions } from "@autoapply/database";
import { enumLabel } from "@autoapply/shared";
import { requireUser } from "@/lib/auth";
import { formatDate, formatRelative } from "@/lib/format";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ANTHROPIC_DEFAULT_MODEL } from "@autoapply/ai";
import { AccountForm, AnalysisForm, BrowserSessionList, PasswordForm, PreferencesForm, SessionList } from "./settings-forms";

export const metadata: Metadata = { title: "Settings" };

function describeAgent(ua: string | null): string {
  if (!ua) return "Unknown device";
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  const os = /Windows/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "macOS" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser} on ${os}` : browser;
}

export default async function SettingsPage() {
  const user = await requireUser();
  const [settings, sessions, logs, browserSessions] = await Promise.all([getUserSettings(user.id), listSessions(user.id), listAuditLogs(user.id, 40), listBrowserSessions(user.id)]);

  return (
    <div className="grid gap-5">
      <PageHeader title="Settings" description="Your account, security and automation preferences." />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Account</CardTitle>
          </CardHeader>
          <CardContent>
            <AccountForm name={user.name} email={user.email} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Password</CardTitle>
            <CardDescription>Changing it signs out your other sessions.</CardDescription>
          </CardHeader>
          <CardContent>
            <PasswordForm />
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Automation preferences</CardTitle>
          <CardDescription>Thresholds below which AutoApply stops and asks you.</CardDescription>
        </CardHeader>
        <CardContent>
          <PreferencesForm settings={settings} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Job analysis</CardTitle>
          <CardDescription>How imported postings are read. Analysis only describes the job; nothing about you is generated.</CardDescription>
        </CardHeader>
        <CardContent>
          <AnalysisForm settings={settings} anthropicConfigured={!!process.env.ANTHROPIC_API_KEY} defaultModel={ANTHROPIC_DEFAULT_MODEL} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Active sessions</CardTitle>
        </CardHeader>
        <CardContent>
          <SessionList
            currentId={user.sessionId}
            sessions={sessions.map((s) => ({ id: s.id, device: describeAgent(s.userAgent), ip: s.ipAddress, lastSeen: formatRelative(s.lastSeenAt), created: formatDate(s.createdAt) }))}
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Saved application sign-ins</CardTitle>
          <CardDescription>Browser cookies the worker keeps, encrypted, for each application site, so a sign-in or MFA you finished once isn't asked for again. Remove one to start fresh on that site.</CardDescription>
        </CardHeader>
        <CardContent>
          <BrowserSessionList
            sessions={browserSessions
              .filter((s) => s.status === "ACTIVE")
              .map((s) => ({ id: s.id, domain: s.domain, platform: enumLabel(s.platform), lastUsed: s.lastUsedAt ? formatRelative(s.lastUsedAt) : null, expires: s.expiresAt ? formatDate(s.expiresAt) : null }))}
          />
        </CardContent>
      </Card>
      <Card className="gap-0 pb-0">
        <CardHeader className="border-b pb-4">
          <CardTitle className="text-sm">Security log</CardTitle>
          <CardDescription>Recent account and data changes.</CardDescription>
        </CardHeader>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-5">Event</TableHead>
              <TableHead>IP address</TableHead>
              <TableHead className="pr-5">When</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {logs.map((l) => (
              <TableRow key={l.id}>
                <TableCell className="pl-5">
                  <Badge variant="secondary" className="font-mono text-[11px]">
                    {l.action}
                  </Badge>
                </TableCell>
                <TableCell className="text-muted-foreground text-[13px]">{l.ipAddress ?? "—"}</TableCell>
                <TableCell className="text-muted-foreground pr-5 text-[13px]">{formatDate(l.createdAt, "MMM d, h:mm a")}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
