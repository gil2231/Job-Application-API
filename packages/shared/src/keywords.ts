/**
 * Keyword queries, used by the Jobs page search and by job board search.
 *
 * Syntax: words and "quoted phrases" must all appear; a leading minus
 * (-commission, -"cold calling") excludes jobs that mention it.
 * Matching is case-insensitive and on word boundaries, so "sales" doesn't
 * match "wholesale" and "c++" works.
 */
export interface KeywordQuery {
  include: string[];
  exclude: string[];
}

const MAX_TERMS = 20;

export function parseKeywordQuery(input: string | null | undefined): KeywordQuery {
  const query: KeywordQuery = { include: [], exclude: [] };
  if (!input) return query;
  const seen = new Set<string>();
  for (const m of input.matchAll(/(-?)(?:"([^"]*)"?|(\S+))/g)) {
    const negated = m[1] === "-";
    const term = (m[2] ?? m[3] ?? "").replace(/\s+/g, " ").trim();
    // A lone "-" or an empty phrase isn't a term.
    if (!term || /^-+$/.test(term)) continue;
    const key = `${negated ? "-" : ""}${term.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    (negated ? query.exclude : query.include).push(term.slice(0, 100));
    if (query.include.length + query.exclude.length >= MAX_TERMS) break;
  }
  return query;
}

export function isEmptyKeywordQuery(query: KeywordQuery): boolean {
  return query.include.length === 0 && query.exclude.length === 0;
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Matches a term as a whole word or phrase, treating spaces and hyphens alike. */
export function keywordPattern(term: string): RegExp {
  const words = term.trim().split(/[\s-]+/).filter(Boolean).map(escapeRegExp);
  return new RegExp(`(?<![A-Za-z0-9])${words.join("[\\s-]+")}(?![A-Za-z0-9])`, "i");
}

export function mentionsKeyword(text: string, term: string): boolean {
  return term.trim() !== "" && keywordPattern(term).test(text);
}

/** True when the text contains every included term and none of the excluded ones. */
export function matchesKeywordQuery(text: string, query: KeywordQuery): boolean {
  return query.include.every((t) => mentionsKeyword(text, t)) && !query.exclude.some((t) => mentionsKeyword(text, t));
}
