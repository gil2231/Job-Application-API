import type { Metadata } from "next";
import { getRecommendationKeywords, getSavedBoardSearch, listRecommendationCandidates } from "@autoapply/database";
import { rankRecommendations } from "@autoapply/matching";
import { requireUser } from "@/lib/auth";
import { formatSalary } from "@/lib/format";
import { PageHeader } from "@/components/page-header";
import { BoardSearchDialog } from "../jobs/board-search-dialog";
import { KeywordsForm } from "./keywords-form";
import { RecommendedList, type RecommendedRow } from "./recommended-list";

export const metadata: Metadata = { title: "Recommended" };

const quote = (k: string) => (/\s/.test(k) ? `"${k}"` : k);

export default async function RecommendedPage() {
  const user = await requireUser();
  const [keywords, candidates, savedBoardSearch] = await Promise.all([getRecommendationKeywords(user.id), listRecommendationCandidates(user.id), getSavedBoardSearch(user.id)]);
  const ranked = rankRecommendations(candidates, keywords, 50);
  const rows: RecommendedRow[] = ranked.map((r) => ({
    id: r.job.id,
    title: r.job.title,
    company: r.job.company,
    location: r.job.location,
    matchScore: r.job.matchScore,
    status: r.job.status,
    platform: r.job.platform,
    salary: r.job.salaryMin != null || r.job.salaryMax != null ? formatSalary(r.job) : null,
    relevance: r.relevance,
    titleKeywords: r.titleKeywords,
    descriptionKeywords: r.descriptionKeywords,
  }));
  // The board search opens with these keywords, matching any of them.
  const boardSearch = keywords.length
    ? { boards: savedBoardSearch?.boards ?? [], location: savedBoardSearch?.location ?? null, query: keywords.map(quote).join(" "), matchAny: true, searchDescriptions: false }
    : savedBoardSearch;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <PageHeader
        title="Recommended for you"
        description="Jobs you've saved or found that mention your keywords, ranked by how many they mention and how well they match your profile."
        actions={<BoardSearchDialog saved={boardSearch} label={keywords.length ? "Find more on job boards" : "Search job boards"} />}
      />
      <KeywordsForm keywords={keywords} />
      <RecommendedList rows={rows} hasKeywords={keywords.length > 0} />
    </div>
  );
}
