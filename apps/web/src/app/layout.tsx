import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { Providers } from "@/components/providers";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Applyance", template: "%s · Applyance" },
  description: "Job application automation with a human in the loop.",
  applicationName: "Applyance",
  appleWebApp: { capable: true, title: "Applyance", statusBarStyle: "black" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Lets the layout reach under the phone's rounded corners and home bar; the shell pads for them.
  viewportFit: "cover",
  // Matches the steel navy header in both themes.
  themeColor: "#0f1623",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="min-h-screen font-sans">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
