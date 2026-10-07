import Link from "next/link";
import { ArrowRight, CheckCircle2, Circle } from "lucide-react";
import type { OnboardingStatus, OnboardingStep } from "@autoapply/database";
import { cn } from "@/lib/utils";

/**
 * Where each getting-started step sends people. "resume" goes to the resume
 * import page, which reads an uploaded resume into the Master Profile.
 */
export const RESUME_IMPORT_HREF = "/profile/import";

export const STEP_COPY: Record<OnboardingStep, { title: string; body: string; href: string; cta: string }> = {
  resume: {
    title: "Import your resume",
    body: "Upload your resume and Applyance fills in your Master Profile from it. You check every fact before it's saved.",
    href: RESUME_IMPORT_HREF,
    cta: "Import resume",
  },
  profile: {
    title: "Check your Master Profile",
    body: "Applications are filled only from facts in your profile. Anything missing becomes a question for you later.",
    href: "/profile",
    cta: "Open profile",
  },
  rules: {
    title: "Set your rules",
    body: "Pick the roles, pay, locations and match score that qualify a job, and whether applications wait for your review.",
    href: "/rules",
    cta: "Set rules",
  },
  jobs: {
    title: "Add jobs",
    body: "Import your LinkedIn saved jobs from your data export, paste job links, or search company job boards by keyword.",
    href: "/jobs",
    cta: "Add jobs",
  },
  security: {
    title: "Turn on two-factor sign-in",
    body: "Your account holds your work history and site sign-ins. A code from an authenticator app keeps it yours.",
    href: "/settings#security",
    cta: "Set up",
  },
  plan: {
    title: "Choose a plan",
    body: "The Free plan is ready to use. Pro raises the monthly limits for an active search.",
    href: "/billing",
    cta: "See plans",
  },
};

export function GettingStartedList({ status, compact = false }: { status: OnboardingStatus; compact?: boolean }) {
  const next = status.steps.find((s) => !s.done)?.key;
  return (
    <ol className="divide-y rounded-lg border">
      {status.steps.map(({ key, done }) => {
        const copy = STEP_COPY[key];
        const isNext = key === next;
        return (
          <li key={key} className={cn("flex items-start gap-3 p-4", isNext && "bg-primary/[0.03]")}>
            {done ? <CheckCircle2 className="text-success mt-0.5 size-5 shrink-0" aria-label="Done" /> : <Circle className="text-muted-foreground mt-0.5 size-5 shrink-0" aria-label="Not done" />}
            <div className="min-w-0 flex-1">
              <p className={cn("text-sm font-medium", done && "text-muted-foreground line-through")}>{copy.title}</p>
              {!compact && !done && <p className="text-muted-foreground mt-1 text-sm">{copy.body}</p>}
            </div>
            {!done && (
              <Link href={copy.href} className={cn("inline-flex shrink-0 items-center gap-1 text-sm font-medium", isNext ? "text-primary" : "text-muted-foreground hover:text-foreground")}>
                {copy.cta} <ArrowRight className="size-3.5" />
              </Link>
            )}
          </li>
        );
      })}
    </ol>
  );
}
