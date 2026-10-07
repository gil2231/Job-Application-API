"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ChevronRight, Search } from "lucide-react";
import { HELP_ARTICLES, HELP_CATEGORIES, searchHelp } from "@/content/help";
import { Input } from "@/components/ui/input";

export function HelpSearch() {
  const [query, setQuery] = useState("");
  const results = useMemo(() => searchHelp(query), [query]);
  const searching = query.trim().length > 0;

  return (
    <div className="grid gap-8">
      <div className="relative">
        <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search help, e.g. CAPTCHA"
          aria-label="Search help articles"
          className="h-11 pl-9 text-base"
        />
      </div>

      {searching ? (
        <section aria-live="polite" className="grid gap-2">
          <p className="text-muted-foreground text-sm">
            {results.length === 0 ? "No articles match. Try other words, or send us a message below." : `${results.length} article${results.length === 1 ? "" : "s"}`}
          </p>
          <ArticleList articles={results} />
        </section>
      ) : (
        <div className="grid gap-8 md:grid-cols-2">
          {HELP_CATEGORIES.map((category) => (
            <section key={category} className="grid content-start gap-2">
              <h2 className="text-sm font-semibold">{category}</h2>
              <ArticleList articles={HELP_ARTICLES.filter((a) => a.category === category)} />
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function ArticleList({ articles }: { articles: typeof HELP_ARTICLES }) {
  if (!articles.length) return null;
  return (
    <ul className="divide-y rounded-lg border">
      {articles.map((a) => (
        <li key={a.slug}>
          <Link href={`/help/${a.slug}`} className="hover:bg-muted/50 flex items-center gap-3 px-4 py-3 transition-colors">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{a.title}</p>
              <p className="text-muted-foreground text-xs">{a.summary}</p>
            </div>
            <ChevronRight className="text-muted-foreground size-4 shrink-0" />
          </Link>
        </li>
      ))}
    </ul>
  );
}
