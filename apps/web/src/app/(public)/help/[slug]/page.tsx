import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Lightbulb } from "lucide-react";
import { getSession } from "@/lib/auth";
import { HELP_ARTICLES, getHelpArticle, type HelpBlock } from "@/content/help";
import { Button } from "@/components/ui/button";

export function generateStaticParams() {
  return HELP_ARTICLES.map((a) => ({ slug: a.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const article = getHelpArticle((await params).slug);
  return article ? { title: article.title, description: article.summary } : {};
}

function Block({ block }: { block: HelpBlock }) {
  if ("h" in block) return <h2 className="mt-2 text-lg font-semibold tracking-tight">{block.h}</h2>;
  if ("p" in block) return <p>{block.p}</p>;
  if ("tip" in block)
    return (
      <div className="bg-primary/5 border-primary/20 flex items-start gap-2.5 rounded-lg border px-4 py-3 text-sm">
        <Lightbulb className="text-primary mt-0.5 size-4 shrink-0" />
        <p>{block.tip}</p>
      </div>
    );
  if ("steps" in block)
    return (
      <ol className="grid list-decimal gap-1.5 pl-5">
        {block.steps.map((s) => (
          <li key={s} className="pl-1">
            {s}
          </li>
        ))}
      </ol>
    );
  return (
    <ul className="grid list-disc gap-1.5 pl-5">
      {block.list.map((s) => (
        <li key={s} className="pl-1">
          {s}
        </li>
      ))}
    </ul>
  );
}

export default async function HelpArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const article = getHelpArticle((await params).slug);
  if (!article) notFound();
  const session = await getSession();
  const related = HELP_ARTICLES.filter((a) => a.category === article.category && a.slug !== article.slug);
  // App pages need an account; public pages (like the legal documents) don't.
  const links = (article.links ?? []).filter((l) => session || l.href.startsWith("/terms") || l.href.startsWith("/privacy"));

  return (
    <div className="mx-auto grid max-w-3xl gap-8">
      <Button asChild variant="ghost" size="sm" className="w-fit">
        <Link href="/help">
          <ArrowLeft /> Help center
        </Link>
      </Button>
      <article className="grid gap-4 text-[15px] leading-relaxed">
        <p className="text-primary text-sm font-medium">{article.category}</p>
        <h1 className="text-3xl font-semibold tracking-tight">{article.title}</h1>
        <p className="text-muted-foreground text-base">{article.summary}</p>
        {article.blocks.map((block, i) => (
          <Block key={i} block={block} />
        ))}
        {links.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-2">
            {links.map((l) => (
              <Button key={l.href} asChild variant="outline" size="sm">
                <Link href={l.href}>{l.label}</Link>
              </Button>
            ))}
          </div>
        )}
      </article>
      <div className="grid gap-3 border-t pt-6">
        {related.length > 0 && (
          <>
            <p className="text-sm font-semibold">More in {article.category}</p>
            <ul className="grid gap-1">
              {related.map((a) => (
                <li key={a.slug}>
                  <Link href={`/help/${a.slug}`} className="text-primary text-sm hover:underline">
                    {a.title}
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
        <p className="text-muted-foreground text-sm">
          Still stuck?{" "}
          <Link href="/help#contact" className="text-primary font-medium hover:underline">
            Send us a message
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
