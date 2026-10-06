"use client";

import { ThemeProvider } from "next-themes";
import { PwaSetup } from "@/components/install-app";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange>
      <TooltipProvider>
        {children}
        <PwaSetup />
        {/* On phones, toasts sit above the bottom tab bar. */}
        <Toaster position="bottom-right" richColors closeButton mobileOffset={{ bottom: "calc(4.5rem + env(safe-area-inset-bottom))" }} />
      </TooltipProvider>
    </ThemeProvider>
  );
}
