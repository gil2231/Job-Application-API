import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { Providers } from "@/components/providers";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Applyance", template: "%s · Applyance" },
  description: "Job application automation with a human in the loop.",
  applicationName: "Applyance",
  appleWebApp: { capable: true, title: "Applyance", statusBarStyle: "default" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Lets the layout reach under the phone's rounded corners and home bar; the shell pads for them.
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fcfcfc" },
    { media: "(prefers-color-scheme: dark)", color: "#0f0f12" },
  ],
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
