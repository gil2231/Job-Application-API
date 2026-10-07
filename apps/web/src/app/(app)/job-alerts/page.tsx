import type { Metadata } from "next";
import Link from "next/link";
import { BellRing } from "lucide-react";
import { getSavedBoardSearch, getUserSettings, listRecentSearchMatches, listSavedSearches } from "@autoapply/database";
import { formatHour } from "@autoapply/notifications";
import { MAX_SAVED_SEARCHES } from "@autoapply/shared";
import { requireUser } from "@/lib/auth";
import { EmptyState, PageHeader } from "@/components/page-header";
import { Card } from "@/components/ui/card";
import { AlertMatches, SavedSearchList, type AlertMatchRow, type SavedSearchRowView } from "./alerts-view";
import { SavedSearchDialog, suggestSearchName } from "./saved-search-form";

export const metadata: Metadata = { title: "Job alerts" };

const MATCH_DAYS = 14;

export default async function JobAlertsPage() {
  const user = await requireUser();
  const [searches, matches, settings, lastBoardSearch] = await Promise.all([
    listSavedSearches(user.id),
    listRecentSearchMatches(user.id, { days: MATCH_DAYS, limit: 200 }),
    getUserSettings(user.id),
    getSavedBoardSearch(user.id),
  ]);

  const rows: SavedSearchRowView[] = searches.map((s) => ({
    id: s.id,
    name: s.name,
    boards: s.boards,
    query: s.query,
    location: s.location,
    searchDescriptions: s.searchDescriptions,
    matchAny: s.matchAny,
    alertsEnabled: s.alertsEnabled,
    lastRunAt: s.lastRunAt?.toISOString() ?? null,
    lastError: s.lastError,
    lastNewCount: s.lastNewCount,
  }));
  const matchRows: AlertMatchRow[] = matches.map((m) => ({
    id: m.id,
    searchId: m.savedSearch.id,
    searchName: m.savedSearch.name,
    url: m.url,
    title: m.title,
    company: m.company,
    location: m.location,
    salaryText: m.salaryText,
    postedAt: m.postedAt?.toISOString() ?? null,
    foundAt: m.firstSeenAt.toISOString(),
    added: m.addedAt !== null,
  }));
  // A new search starts from the last job board search, if there was one.
  const starter = {
    name: lastBoardSearch?.query ? suggestSearchName(lastBoardSearch.query, lastBoardSearch.location) : "",
    boards: lastBoardSearch?.boards ?? [],
    query: lastBoardSearch?.query ?? "",
    location: lastBoardSearch?.location ?? null,
    searchDescriptions: lastBoardSearch?.searchDescriptions ?? false,
    matchAny: lastBoardSearch?.matchAny ?? false,
    alertsEnabled: true,
  };
  const status = !settings.jobAlertEmails
    ? (
        <>
          Daily job alert emails are off. Turn them on in <Link href="/settings#notifications" className="underline">Settings</Link>.
        </>
      )
    : (
        <>
          Your saved searches run every morning around {formatHour(settings.jobAlertHour)} ({settings.timezone}) and email you what&apos;s new. Change the time in{" "}
          <Link href="/settings#notifications" className="underline">
            Settings
          </Link>
          .
        </>
      );

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <PageHeader title="Job alerts" description={status} actions={searches.length < MAX_SAVED_SEARCHES ? <SavedSearchDialog initial={starter} trigger="new" /> : null} />
      {rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={BellRing}
            title="No saved searches yet"
            description="Save a job board keyword search and Applyance checks it every morning, then emails you the jobs posted since the day before. You can also save a search from Search job boards on the Jobs page."
            action={<SavedSearchDialog initial={starter} trigger="new" />}
          />
        </Card>
      ) : (
        <>
          <SavedSearchList searches={rows} />
          <AlertMatches matches={matchRows} days={MATCH_DAYS} />
        </>
      )}
    </div>
  );
}
