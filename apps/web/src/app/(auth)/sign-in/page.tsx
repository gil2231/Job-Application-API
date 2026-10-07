import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ next?: string; reset?: string }> }) {
  const { next, reset } = await searchParams;
  // Only a valid session skips this page; a stale cookie must not cause a redirect loop.
  if (await getSession()) redirect("/dashboard");
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
      <p className="text-muted-foreground mt-1 text-sm">Sign in to your Applyance workspace.</p>
      {reset && (
        <p role="status" className="border-success/30 bg-success/5 mt-6 rounded-md border px-3 py-2 text-sm">
          Your password was changed. Sign in with the new one.
        </p>
      )}
      <SignInForm next={next} />
      <p className="text-muted-foreground mt-6 text-sm">
        New here?{" "}
        <Link href="/sign-up" className="text-primary font-medium hover:underline">
          Create an account
        </Link>
      </p>
    </>
  );
}
