import Link from "next/link";
import { getSession } from "@/lib/auth";
import { COMPANY } from "@/config/company";
import { CompanyValue, LegalLinks } from "@/components/legal/legal";
import { Button } from "@/components/ui/button";

/** Pages anyone can read, signed in or not: the legal documents and the help center. */
export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  return (
    <div className="flex min-h-screen flex-col">
      <header className="bg-background/80 sticky top-0 z-40 border-b backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center gap-3 px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2">
            <div className="bg-primary text-primary-foreground grid size-7 place-items-center rounded-md text-xs font-bold">A</div>
            <span className="font-semibold tracking-tight">{COMPANY.productName}</span>
          </Link>
          <nav className="ml-auto flex items-center gap-1">
            <Button asChild variant="ghost" size="sm">
              <Link href="/help">Help center</Link>
            </Button>
            <Button asChild size="sm">
              <Link href={session ? "/dashboard" : "/sign-in"}>{session ? "Open app" : "Sign in"}</Link>
            </Button>
          </nav>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6 sm:py-12">{children}</main>
      <footer className="border-t">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 px-4 py-6 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p className="text-muted-foreground text-xs">
            © {new Date().getFullYear()} <CompanyValue value={COMPANY.legalName} />
          </p>
          <LegalLinks />
        </div>
      </footer>
    </div>
  );
}
