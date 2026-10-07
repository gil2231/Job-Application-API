import Image from "next/image";
import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { LegalLinks } from "@/components/legal/legal";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="flex flex-col justify-center px-6 py-12 sm:px-12">
        <div className="mx-auto w-full max-w-sm">
          <Link href="/" className="mb-10 flex w-fit" aria-label="Applyance home">
            <Logo markClassName="h-8 drop-shadow-[0_1px_1px_rgb(0_0_0/0.35)]" textClassName="text-xl" />
          </Link>
          {children}
          <LegalLinks className="mt-10 justify-center" />
        </div>
      </div>
      <div className="relative hidden overflow-hidden border-l bg-black lg:block">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_70%_30%,oklch(0.45_0.15_259/0.35)_0%,transparent_55%)]" />
        <Image src="/brand/applyance-logo.png" alt="" width={640} height={640} priority className="absolute top-1/2 mix-blend-screen left-1/2 w-[min(80%,560px)] -translate-x-1/2 -translate-y-[62%]" />
        <div className="relative flex h-full flex-col justify-end p-12 text-zinc-100">
          <p className="max-w-md text-2xl leading-snug font-medium tracking-tight">
            Save jobs once. Applyance analyzes, fills and tracks every application, and stops for you whenever a human is needed.
          </p>
          <ul className="mt-8 space-y-2 text-sm text-zinc-400">
            <li>Never bypasses CAPTCHAs, MFA or other security checks</li>
            <li>Never invents qualifications. Answers come from your profile</li>
            <li>You choose Manual, Review or Auto submission</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
