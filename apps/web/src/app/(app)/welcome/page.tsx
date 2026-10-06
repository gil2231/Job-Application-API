import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { getOnboardingStatus } from "@autoapply/database";
import { requireUser } from "@/lib/auth";
import { GettingStartedList, STEP_COPY } from "@/components/getting-started";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

export const metadata: Metadata = { title: "Getting started" };

export default async function WelcomePage() {
  const user = await requireUser();
  const status = await getOnboardingStatus(user.id);
  const next = status.steps.find((s) => !s.done);
  const firstName = user.name.split(" ")[0];

  return (
    <div className="mx-auto grid w-full max-w-2xl gap-6 py-4">
      <div>
        <p className="text-primary text-sm font-medium">Getting started</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight">{status.done === 0 ? `Welcome to Applyance, ${firstName}` : `Nice progress, ${firstName}`}</h1>
        <p className="text-muted-foreground mt-2 text-sm">
          A few steps and Applyance is ready to apply for you. You can do them in any order and come back here from your dashboard.
        </p>
      </div>
      <div className="grid gap-2">
        <div className="flex justify-between text-sm">
          <span className="font-medium">
            {status.done} of {status.total} done
          </span>
        </div>
        <Progress value={(status.done / status.total) * 100} aria-label="Getting started progress" />
      </div>
      <GettingStartedList status={status} />
      <div className="flex flex-wrap items-center gap-3">
        {next ? (
          <Button asChild>
            <Link href={STEP_COPY[next.key].href}>
              {STEP_COPY[next.key].cta} <ArrowRight />
            </Link>
          </Button>
        ) : null}
        <Button asChild variant="ghost">
          <Link href="/dashboard">{next ? "Skip to dashboard" : "Go to dashboard"}</Link>
        </Button>
      </div>
    </div>
  );
}
