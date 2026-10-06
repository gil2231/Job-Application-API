import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { SignUpForm } from "./sign-up-form";

export const metadata: Metadata = { title: "Create account" };

export default async function SignUpPage() {
  // Only a valid session skips this page; a stale cookie must not cause a redirect loop.
  if (await getSession()) redirect("/dashboard");
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Create your account</h1>
      <p className="text-muted-foreground mt-1 text-sm">Next, you&apos;ll fill in your Master Profile once and every application reuses it.</p>
      <SignUpForm />
      <p className="text-muted-foreground mt-6 text-sm">
        Already have an account?{" "}
        <Link href="/sign-in" className="text-primary font-medium hover:underline">
          Sign in
        </Link>
      </p>
    </>
  );
}
