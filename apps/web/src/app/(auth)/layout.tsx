import { LegalLinks } from "@/components/legal/legal";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="flex flex-col justify-center px-6 py-12 sm:px-12">
        <div className="mx-auto w-full max-w-sm">
          <div className="mb-10 flex items-center gap-2">
            <div className="bg-primary text-primary-foreground grid size-8 place-items-center rounded-lg text-sm font-bold">A</div>
            <span className="text-lg font-semibold tracking-tight">AutoApply</span>
          </div>
          {children}
          <LegalLinks className="mt-10 justify-center" />
        </div>
      </div>
      <div className="relative hidden overflow-hidden border-l bg-[radial-gradient(ellipse_at_top_left,var(--color-primary)_0%,transparent_60%)] bg-zinc-950 lg:block">
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff0a_1px,transparent_1px),linear-gradient(to_bottom,#ffffff0a_1px,transparent_1px)] bg-[size:32px_32px]" />
        <div className="relative flex h-full flex-col justify-end p-12 text-zinc-100">
          <p className="max-w-md text-2xl leading-snug font-medium tracking-tight">
            Save jobs once. AutoApply analyzes, fills and tracks every application, and stops for you whenever a human is needed.
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
