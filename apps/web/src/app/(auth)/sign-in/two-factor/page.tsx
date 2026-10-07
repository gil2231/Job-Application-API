import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getPendingSignIn } from "@/lib/pending-sign-in";
import { TwoFactorForm } from "./two-factor-form";

export const metadata: Metadata = { title: "Two-factor sign-in" };

export default async function TwoFactorPage() {
  if (!(await getPendingSignIn())) redirect("/sign-in");
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Enter your code</h1>
      <p className="text-muted-foreground mt-1 text-sm">Open your authenticator app and enter the 6-digit code for Applyance.</p>
      <TwoFactorForm />
      <p className="text-muted-foreground mt-6 text-sm">
        Lost your phone? Enter one of your recovery codes instead.{" "}
        <Link href="/sign-in" className="text-primary font-medium hover:underline">
          Start over
        </Link>
      </p>
    </>
  );
}
