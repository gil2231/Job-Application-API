"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { reportClientError } from "@/lib/report-client-error";

export default function ErrorPage({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    // Server errors were already reported where they happened; only report browser-side ones.
    if (!error.digest) reportClientError(error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
      <p className="text-muted-foreground text-sm font-medium">Something went wrong</p>
      <h1 className="text-xl font-semibold">This page hit an error</h1>
      <p className="text-muted-foreground max-w-sm text-sm">
        We&apos;ve been notified. Try again, and if it keeps happening, let us know what you were doing.
        {error.digest ? <span className="mt-1 block font-mono text-xs">Reference: {error.digest}</span> : null}
      </p>
      <Button variant="outline" size="sm" onClick={() => retry()}>
        Try again
      </Button>
    </div>
  );
}
