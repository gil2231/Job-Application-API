import Link from "next/link";
import { getSession } from "@/lib/auth";
import { Button } from "@/components/ui/button";

function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2">
      <div className="bg-primary text-primary-foreground grid size-7 place-items-center rounded-lg text-sm font-bold">A</div>
      <span className="font-semibold tracking-tight">Applyance</span>
    </Link>
  );
}

export default async function MarketingLayout({ children }: { children: React.ReactNode }) {
  const signedIn = !!(await getSession());
  return (
    <div className="flex min-h-screen flex-col">
      <header className="bg-background/80 sticky top-0 z-30 border-b backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <Logo />
          <nav className="text-muted-foreground hidden items-center gap-6 text-sm md:flex">
            <Link href="/#features" className="hover:text-foreground">
              Features
            </Link>
            <Link href="/#how-it-works" className="hover:text-foreground">
              How it works
            </Link>
            <Link href="/pricing" className="hover:text-foreground">
              Pricing
            </Link>
            <Link href="/#faq" className="hover:text-foreground">
              FAQ
            </Link>
          </nav>
          <div className="flex items-center gap-2">
            {signedIn ? (
              <Button asChild size="sm">
                <Link href="/dashboard">Open dashboard</Link>
              </Button>
            ) : (
              <>
                <Button asChild size="sm" variant="ghost">
                  <Link href="/sign-in">Sign in</Link>
                </Button>
                <Button asChild size="sm">
                  <Link href="/sign-up">Start free</Link>
                </Button>
              </>
            )}
          </div>
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <footer className="border-t">
        <div className="text-muted-foreground mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 text-sm sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex items-center gap-3">
            <Logo />
            <span>© {new Date().getFullYear()} Applyance</span>
          </div>
          <nav className="flex flex-wrap gap-5">
            <Link href="/pricing" className="hover:text-foreground">
              Pricing
            </Link>
            <Link href="/terms" className="hover:text-foreground">
              Terms
            </Link>
            <Link href="/privacy" className="hover:text-foreground">
              Privacy
            </Link>
            <Link href="/sign-in" className="hover:text-foreground">
              Sign in
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
