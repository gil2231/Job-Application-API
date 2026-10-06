import type { Metadata } from "next";
import Link from "next/link";
import { getAccountFlags } from "@autoapply/database";
import { verifyEmailToken } from "@/actions/auth";
import { getSession } from "@/lib/auth";

export const metadata: Metadata = { title: "Confirm email" };

export default async function VerifyEmailPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  const session = await getSession();
  const signedIn = !!session;
  // An email scanner may have opened the link first; it still counts if the address is confirmed.
  const ok = (token ? await verifyEmailToken(token) : false) || (!!session && (await getAccountFlags(session.user.id)).emailVerified);
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">{ok ? "Email confirmed" : "This link didn't work"}</h1>
      <p className="text-muted-foreground mt-2 text-sm">
        {ok
          ? "Thanks. Password resets and account notices will go to this address."
          : "It may have expired or already been used. Sign in and use Send a new link on the banner at the top of the app."}
      </p>
      <Link href={signedIn ? "/dashboard" : "/sign-in"} className="text-primary mt-6 inline-block text-sm font-medium hover:underline">
        {signedIn ? "Go to your dashboard" : "Sign in"}
      </Link>
    </>
  );
}
