import type { Metadata } from "next";
import { getSession } from "@/lib/auth";
import { COMPANY } from "@/config/company";
import { CompanyEmail } from "@/components/legal/legal";
import { SupportForm } from "@/components/support/support-form";
import { HelpSearch } from "./help-search";

export const metadata: Metadata = { title: "Help center", description: `Answers to common questions about ${COMPANY.productName}, and how to reach support.` };

export default async function HelpPage() {
  const session = await getSession();
  return (
    <div className="grid gap-12">
      <header className="grid gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">How can we help?</h1>
        <p className="text-muted-foreground">Guides to every part of {COMPANY.productName}, and a way to reach us when something isn&apos;t right.</p>
      </header>
      <HelpSearch />
      <section id="contact" className="grid scroll-mt-20 gap-4 border-t pt-10 md:grid-cols-[1fr_1.4fr] md:gap-10">
        <div className="grid content-start gap-2">
          <h2 className="text-xl font-semibold tracking-tight">Report a problem or ask a question</h2>
          <p className="text-muted-foreground text-sm">
            {session
              ? "We'll reply by email to the address on your account."
              : "You don't need to be signed in, so this works even if you're locked out. We'll reply to the email you give."}
          </p>
          <p className="text-muted-foreground text-sm">
            You can also email <CompanyEmail value={COMPANY.supportEmail} />.
          </p>
        </div>
        <SupportForm signedIn={!!session} />
      </section>
    </div>
  );
}
