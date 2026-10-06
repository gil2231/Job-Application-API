import type { Metadata } from "next";
import { headers } from "next/headers";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { Providers } from "@/components/providers";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "AutoApply", template: "%s · AutoApply" },
  description: "Job application automation with a human in the loop.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // The per-request nonce from the proxy's Content Security Policy. Reading it
  // also keeps every page dynamically rendered, which nonces require.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html lang="en" suppressHydrationWarning className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="min-h-screen font-sans">
        <Providers nonce={nonce}>{children}</Providers>
      </body>
    </html>
  );
}
