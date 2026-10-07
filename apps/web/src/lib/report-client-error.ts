/** Sends a browser-side crash to /api/client-errors. Never throws. */
export function reportClientError(error: Error & { digest?: string }): void {
  try {
    const body = JSON.stringify({
      name: error.name,
      message: String(error.message).slice(0, 1000),
      stack: error.stack?.slice(0, 8000),
      digest: error.digest,
      path: window.location.pathname,
    });
    void fetch("/api/client-errors", { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true }).catch(() => undefined);
  } catch {
    // Reporting must never make an error page worse.
  }
}
