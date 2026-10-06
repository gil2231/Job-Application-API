import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { COMPANY, isPlaceholder } from "@/config/company";
import { cn } from "@/lib/utils";

/** A value from the company config; unfilled [placeholders] are highlighted so they're easy to spot. */
export function CompanyValue({ value, className }: { value: string; className?: string }) {
  if (!isPlaceholder(value)) return <span className={className}>{value}</span>;
  return <mark className={cn("rounded bg-amber-200/70 px-1 text-inherit dark:bg-amber-500/30", className)}>{value}</mark>;
}

/** An email address from the company config, as a mailto link once it's filled in. */
export function CompanyEmail({ value }: { value: string }) {
  if (isPlaceholder(value)) return <CompanyValue value={value} />;
  return (
    <a href={`mailto:${value}`} className="text-primary font-medium hover:underline">
      {value}
    </a>
  );
}

export function DraftBanner() {
  if (COMPANY.legalReviewed) return null;
  return (
    <div role="note" className="border-warning/40 bg-warning/10 flex items-start gap-2.5 rounded-lg border px-4 py-3 text-sm">
      <AlertTriangle className="text-warning mt-0.5 size-4 shrink-0" />
      <p>
        <strong>Draft for legal review.</strong> This document has not yet been reviewed by a lawyer and may change before {COMPANY.productName} launches. Highlighted
        text is a placeholder still to be filled in.
      </p>
    </div>
  );
}

/** A note for the reviewing lawyer. Shown only while the documents are drafts. */
export function ReviewNote({ children }: { children: React.ReactNode }) {
  if (COMPANY.legalReviewed) return null;
  return (
    <aside className="my-3 rounded-md border border-dashed border-sky-500/50 bg-sky-500/5 px-3 py-2 text-[13px] text-sky-900 dark:text-sky-200">
      <span className="font-semibold">Reviewer note: </span>
      {children}
    </aside>
  );
}

export interface LegalSectionDef {
  id: string;
  title: string;
}

export function LegalDocument({ title, intro, sections, children }: { title: string; intro: React.ReactNode; sections: LegalSectionDef[]; children: React.ReactNode }) {
  return (
    <article className="grid gap-8">
      <header className="grid gap-4">
        <DraftBanner />
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
          <p className="text-muted-foreground mt-2 text-sm">Last updated {formatLegalDate(COMPANY.legalLastUpdated)}</p>
        </div>
        <div className="text-muted-foreground leading-relaxed">{intro}</div>
      </header>
      <nav aria-label="Contents" className="bg-muted/40 rounded-lg border p-4">
        <p className="mb-2 text-sm font-semibold">Contents</p>
        <ol className="grid list-decimal gap-1 pl-5 text-sm sm:grid-cols-2 sm:gap-x-8">
          {sections.map((s) => (
            <li key={s.id}>
              <a href={`#${s.id}`} className="text-primary hover:underline">
                {s.title}
              </a>
            </li>
          ))}
        </ol>
      </nav>
      <div className="grid gap-10">{children}</div>
    </article>
  );
}

export function LegalSection({ section, index, children }: { section: LegalSectionDef; index: number; children: React.ReactNode }) {
  return (
    <section id={section.id} className="scroll-mt-20">
      <h2 className="mb-3 text-lg font-semibold tracking-tight">
        {index}. {section.title}
      </h2>
      <div className="grid gap-3 text-[15px] leading-relaxed [&_li]:pl-1 [&_ol]:grid [&_ol]:list-decimal [&_ol]:gap-1.5 [&_ol]:pl-5 [&_ul]:grid [&_ul]:list-disc [&_ul]:gap-1.5 [&_ul]:pl-5 [&_h3]:mt-2 [&_h3]:font-semibold">
        {children}
      </div>
    </section>
  );
}

export function formatLegalDate(iso: string): string {
  const date = new Date(`${iso}T12:00:00Z`);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
}

export function LegalLinks({ className }: { className?: string }) {
  return (
    <nav aria-label="Legal" className={cn("text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 text-xs", className)}>
      <Link href="/terms" className="hover:text-foreground hover:underline">
        Terms
      </Link>
      <Link href="/privacy" className="hover:text-foreground hover:underline">
        Privacy
      </Link>
      <Link href="/help" className="hover:text-foreground hover:underline">
        Help
      </Link>
    </nav>
  );
}
