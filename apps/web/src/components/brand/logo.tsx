import { useId } from "react";
import { cn } from "@/lib/utils";

/**
 * The Applyance mark: a brushed-steel "A" crossed by a streak of blue light.
 * Drawn as SVG so it stays sharp at any size: bright silver on dark surfaces,
 * darker steel on light ones (--mark-* in globals.css). The uploaded artwork is
 * used for the installable app icons (public/icons, src/app/apple-icon.png).
 */
export function LogoMark({ className, title }: { className?: string; title?: string }) {
  const id = useId();
  const steel = `${id}-steel`;
  const streak = `${id}-streak`;
  const glow = `${id}-glow`;
  return (
    <svg viewBox="262 312 724 568" className={cn("shrink-0", className)} role={title ? "img" : undefined} aria-hidden={title ? undefined : true} aria-label={title}>
      <defs>
        <linearGradient id={steel} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" style={{ stopColor: "var(--mark-1)" }} />
          <stop offset="0.45" style={{ stopColor: "var(--mark-2)" }} />
          <stop offset="0.7" style={{ stopColor: "var(--mark-3)" }} />
          <stop offset="1" style={{ stopColor: "var(--mark-4)" }} />
        </linearGradient>
        <linearGradient id={streak} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.6" stopColor="#d8e6ff" />
          <stop offset="1" stopColor="#4d8bff" />
        </linearGradient>
        <linearGradient id={glow} x1="1" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#7fb0ff" stopOpacity="0.95" />
          <stop offset="1" stopColor="#3f7dff" stopOpacity="0.2" />
        </linearGradient>
      </defs>
      <path fill={`url(#${steel})`} d="M625 328 L756 546 L679 574 L625 492 L513 664 C640 600 800 545 975 495 C780 590 520 720 275 868 Z" />
      <path fill={`url(#${steel})`} d="M701 680 L800 622 L948 866 L815 866 Z" />
      <path fill={`url(#${streak})`} opacity="0.9" d="M513 664 C640 600 800 545 975 495 C800 560 620 640 470 700 Z" />
      <path fill="none" stroke={`url(#${glow})`} strokeWidth="7" strokeLinecap="round" d="M622 334 L281 862" />
    </svg>
  );
}

/** The mark with the Applyance name beside it. */
export function Logo({ className, markClassName, textClassName }: { className?: string; markClassName?: string; textClassName?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <LogoMark className={cn("h-6 w-auto", markClassName)} />
      <span className={cn("brand-wordmark font-semibold tracking-tight", textClassName)}>Applyance</span>
    </span>
  );
}
