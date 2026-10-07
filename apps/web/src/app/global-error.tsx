"use client";

import { useEffect } from "react";
import { reportClientError } from "@/lib/report-client-error";

/** Last-resort error page, used when the root layout itself fails. It can't rely on the app's styles. */
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    if (!error.digest) reportClientError(error);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", display: "grid", placeItems: "center", minHeight: "100vh", margin: 0, textAlign: "center" }}>
        <main style={{ maxWidth: 360, padding: 16 }}>
          <h1 style={{ fontSize: 20 }}>Something went wrong</h1>
          <p style={{ color: "#666", fontSize: 14 }}>
            We&apos;ve been notified. Please try again.
            {error.digest ? <span style={{ display: "block", fontFamily: "monospace", fontSize: 12, marginTop: 4 }}>Reference: {error.digest}</span> : null}
          </p>
          <button type="button" onClick={() => retry()} style={{ padding: "6px 14px", fontSize: 14, cursor: "pointer" }}>
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
