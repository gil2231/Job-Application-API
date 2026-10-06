import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowRight,
  Bot,
  CheckCircle2,
  FileText,
  Hand,
  Inbox,
  LineChart,
  ListChecks,
  PlaneTakeoff,
  ShieldCheck,
  Sparkles,
  Target,
  UserRound,
} from "lucide-react";
import { getSession } from "@/lib/auth";
import { PricingCards } from "@/components/pricing";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: { absolute: "Applyance: job applications on autopilot, with you in control" },
  description: "Applyance imports the jobs you save, scores them against your profile, fills in the applications and tracks every one. It stops and asks you whenever a person is needed.",
};

const FEATURES = [
  { icon: Inbox, title: "Bring your saved jobs", body: "Import LinkedIn saved jobs from your data export, paste links, or search company job boards by keyword." },
  { icon: Target, title: "Know what's worth applying to", body: "Every job is read and scored against your Master Profile with weights you control, so the best fits rise to the top." },
  { icon: Bot, title: "Applications filled for you", body: "Workday, Greenhouse, Lever, Ashby, SmartRecruiters and ordinary web forms, filled from your profile and Answer Library." },
  { icon: FileText, title: "Tailored resume and cover letter", body: "A version of your resume and a cover letter for each job, built only from facts in your profile, ready as PDF or Word." },
  { icon: PlaneTakeoff, title: "Flightpath tracker", body: "Every application from submitted to offer on one board, with interviews, notes and response rates." },
  { icon: Sparkles, title: "Recommendations", body: "Tell Applyance the roles, industries and skills you want, and it surfaces the saved jobs that match them." },
];

const STEPS = [
  { icon: UserRound, title: "Set up your profile once", body: "Upload your resume, check the facts, and save answers to common questions. Every application reuses them." },
  { icon: ListChecks, title: "Choose the jobs and the rules", body: "Import jobs, set the match score and keywords that qualify a job, and pick Manual, Review or Auto mode." },
  { icon: Hand, title: "Step in only when needed", body: "Applyance does the typing. CAPTCHAs, sign-ins and any question it isn't sure about wait for you in Needs Attention." },
];

const PROMISES = [
  "Never bypasses CAPTCHAs, two-factor checks, sign-ins or anti-bot protections.",
  "Never makes up an answer. Facts come from your profile; AI drafts wait for your approval.",
  "Submits on its own only in Auto mode, with auto-submit turned on, when every check passes.",
  "Never automates LinkedIn Easy Apply or signs in to LinkedIn.",
];

const FAQ = [
  {
    q: "Does Applyance submit applications without asking me?",
    a: "Only if you choose Auto mode and turn on auto-submit in Rules, and even then only when every required field was filled confidently from your own profile and there's no CAPTCHA or sign-in. In Manual and Review modes nothing is sent until you approve it.",
  },
  {
    q: "What happens when a site shows a CAPTCHA or asks me to sign in?",
    a: "The application moves to Needs Attention and waits. Applyance never tries to get around these checks. You finish the step yourself and the application carries on.",
  },
  {
    q: "Will it make things up to fit a job?",
    a: "No. Answers come from your Master Profile and Answer Library. AI is optional, and anything it writes is checked against your profile; a figure, skill or employer that isn't there is rejected.",
  },
  {
    q: "Can it apply through LinkedIn?",
    a: "Applyance imports the jobs you saved on LinkedIn from your own data export or links you paste, then applies on the employer's own application site. It doesn't sign in to LinkedIn or use Easy Apply.",
  },
  {
    q: "How is my data protected?",
    a: "Sensitive answers and saved site sign-ins are encrypted, you can turn on two-factor sign-in, and you can download everything or delete your account at any time from Settings.",
  },
  {
    q: "Can I cancel any time?",
    a: "Yes. Cancel from Plan & billing and you keep Pro until the end of the period you paid for, then move to the Free plan.",
  },
];

/** A static picture of the pipeline, drawn with the app's own styles. */
function ProductPreview() {
  const rows = [
    { title: "Account Executive", company: "Northwind", score: 92, status: "Submitted", tone: "bg-success/15 text-[color-mix(in_oklch,var(--success),black_25%)] dark:text-success" },
    { title: "Sales Development Rep", company: "Contoso", score: 87, status: "Needs review", tone: "bg-warning/20 text-[color-mix(in_oklch,var(--warning),black_35%)] dark:text-warning" },
    { title: "Customer Success Manager", company: "Fabrikam", score: 81, status: "Filling form", tone: "bg-primary/10 text-primary" },
    { title: "Partnerships Lead", company: "Tailspin", score: 74, status: "Queued", tone: "bg-muted text-muted-foreground" },
  ];
  return (
    <div aria-hidden className="bg-card relative rounded-xl border p-4 shadow-2xl shadow-black/5 sm:p-5">
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm font-semibold">Today&apos;s applications</p>
        <span className="bg-primary/10 text-primary rounded-full px-2 py-0.5 text-[11px] font-medium">Review mode</span>
      </div>
      <div className="grid grid-cols-3 gap-2 text-center">
        {[
          ["Qualified", "38"],
          ["Sent", "12"],
          ["Interviews", "3"],
        ].map(([label, value]) => (
          <div key={label} className="bg-muted/60 rounded-lg px-2 py-3">
            <p className="text-xl font-semibold tabular-nums">{value}</p>
            <p className="text-muted-foreground text-[11px]">{label}</p>
          </div>
        ))}
      </div>
      <ul className="mt-4 divide-y text-sm">
        {rows.map((r) => (
          <li key={r.title} className="flex items-center gap-3 py-2.5">
            <span className="bg-primary/10 text-primary grid size-9 shrink-0 place-items-center rounded-full text-xs font-semibold tabular-nums">{r.score}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{r.title}</span>
              <span className="text-muted-foreground block truncate text-xs">{r.company}</span>
            </span>
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium ${r.tone}`}>{r.status}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default async function LandingPage({ searchParams }: { searchParams: Promise<{ deleted?: string }> }) {
  const { deleted } = await searchParams;
  if (await getSession()) redirect("/dashboard");

  return (
    <>
      {deleted && (
        <div role="status" className="bg-muted border-b px-4 py-3 text-center text-sm">
          Your account and all of its data have been deleted.
        </div>
      )}

      <section className="relative overflow-hidden">
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,color-mix(in_oklch,var(--primary),transparent_85%)_0%,transparent_60%)]" />
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-16 sm:px-6 md:py-24 lg:grid-cols-2">
          <div>
            <p className="bg-primary/10 text-primary mb-5 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium">
              <ShieldCheck className="size-3.5" /> A person stays in the loop
            </p>
            <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">Apply to more of the right jobs, without the busywork.</h1>
            <p className="text-muted-foreground mt-5 max-w-xl text-lg text-pretty">
              Applyance imports the jobs you save, scores them against your profile, fills in the applications and tracks every one. It stops and asks you whenever a person is needed.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild size="lg">
                <Link href="/sign-up">
                  Start free <ArrowRight />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link href="/pricing">See pricing</Link>
              </Button>
            </div>
            <p className="text-muted-foreground mt-4 text-sm">Free plan includes 25 applications a month. No card needed.</p>
          </div>
          <ProductPreview />
        </div>
      </section>

      <section id="features" className="mx-auto max-w-6xl scroll-mt-16 px-4 py-16 sm:px-6">
        <h2 className="text-center text-3xl font-semibold tracking-tight">Everything between &quot;saved&quot; and &quot;hired&quot;</h2>
        <p className="text-muted-foreground mx-auto mt-3 max-w-2xl text-center">One place to find, apply to and follow up on jobs, built around your own facts.</p>
        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="bg-card rounded-xl border p-6">
              <div className="bg-primary/10 text-primary mb-4 grid size-9 place-items-center rounded-lg">
                <f.icon className="size-5" />
              </div>
              <h3 className="font-semibold">{f.title}</h3>
              <p className="text-muted-foreground mt-2 text-sm">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="how-it-works" className="bg-muted/40 scroll-mt-16 border-y">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <h2 className="text-center text-3xl font-semibold tracking-tight">How it works</h2>
          <ol className="mt-12 grid gap-8 md:grid-cols-3">
            {STEPS.map((s, i) => (
              <li key={s.title} className="relative">
                <div className="flex items-center gap-3">
                  <span className="bg-primary text-primary-foreground grid size-8 place-items-center rounded-full text-sm font-semibold">{i + 1}</span>
                  <s.icon className="text-muted-foreground size-5" />
                </div>
                <h3 className="mt-4 font-semibold">{s.title}</h3>
                <p className="text-muted-foreground mt-2 text-sm">{s.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-16 sm:px-6 lg:grid-cols-2">
        <div>
          <h2 className="text-3xl font-semibold tracking-tight">Honest by design</h2>
          <p className="text-muted-foreground mt-3">Employers see the real you. Applyance only speeds up the typing; it never cuts corners on your behalf.</p>
        </div>
        <ul className="grid gap-3">
          {PROMISES.map((p) => (
            <li key={p} className="bg-card flex gap-3 rounded-lg border p-4 text-sm">
              <CheckCircle2 className="text-success mt-0.5 size-5 shrink-0" />
              <span>{p}</span>
            </li>
          ))}
        </ul>
      </section>

      <section id="pricing" className="bg-muted/40 scroll-mt-16 border-y">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <h2 className="text-center text-3xl font-semibold tracking-tight">Simple pricing</h2>
          <p className="text-muted-foreground mx-auto mt-3 mb-10 max-w-xl text-center">Start free. Upgrade when your search picks up, and cancel any time.</p>
          <PricingCards mode="public" />
        </div>
      </section>

      <section id="faq" className="mx-auto max-w-3xl scroll-mt-16 px-4 py-16 sm:px-6">
        <h2 className="text-center text-3xl font-semibold tracking-tight">Questions</h2>
        <div className="mt-10 divide-y rounded-xl border">
          {FAQ.map((f) => (
            <details key={f.q} className="group px-5 py-4">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium">
                {f.q}
                <span className="text-muted-foreground transition-transform group-open:rotate-45">+</span>
              </summary>
              <p className="text-muted-foreground mt-3 text-sm">{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-20 sm:px-6">
        <div className="bg-primary text-primary-foreground flex flex-col items-center gap-5 rounded-2xl px-6 py-14 text-center">
          <LineChart className="size-8 opacity-80" />
          <h2 className="max-w-xl text-3xl font-semibold tracking-tight">Spend your time on interviews, not forms.</h2>
          <Button asChild size="lg" variant="secondary">
            <Link href="/sign-up">
              Create your free account <ArrowRight />
            </Link>
          </Button>
        </div>
      </section>
    </>
  );
}
