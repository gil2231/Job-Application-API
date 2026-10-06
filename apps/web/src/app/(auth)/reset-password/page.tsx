import type { Metadata } from "next";
import Link from "next/link";
import { ResetPasswordForm } from "./reset-password-form";

export const metadata: Metadata = { title: "Choose a new password" };

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  if (!token) {
    return (
      <>
        <h1 className="text-2xl font-semibold tracking-tight">This link isn&apos;t complete</h1>
        <p className="text-muted-foreground mt-2 text-sm">
          Open the link from the email again, or{" "}
          <Link href="/forgot-password" className="text-primary font-medium hover:underline">
            ask for a new one
          </Link>
          .
        </p>
      </>
    );
  }
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Choose a new password</h1>
      <p className="text-muted-foreground mt-1 text-sm">You&apos;ll be signed out everywhere and can sign in with the new password.</p>
      <ResetPasswordForm token={token} />
    </>
  );
}
