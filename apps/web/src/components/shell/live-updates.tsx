"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * Subscribes to the server-sent event stream and refreshes server components
 * whenever the user's jobs, applications or timeline change (for example when
 * the worker advances an application).
 */
export function LiveUpdates() {
  const router = useRouter();
  const last = useRef<string | null>(null);

  useEffect(() => {
    let source: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0;

    const connect = () => {
      source = new EventSource("/api/stream");
      source.addEventListener("change", (event) => {
        attempts = 0;
        const fingerprint = (event as MessageEvent<string>).data;
        if (last.current !== null && last.current !== fingerprint && document.visibilityState === "visible") router.refresh();
        last.current = fingerprint;
      });
      source.onerror = () => {
        source?.close();
        attempts += 1;
        retry = setTimeout(connect, Math.min(30_000, 1000 * 2 ** attempts));
      };
    };
    connect();
    return () => {
      source?.close();
      if (retry) clearTimeout(retry);
    };
  }, [router]);

  return null;
}
