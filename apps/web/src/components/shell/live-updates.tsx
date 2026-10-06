"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ApplicationProgress } from "@autoapply/shared";

const LiveProgressContext = createContext<Record<string, ApplicationProgress>>({});

/** Live worker progress for the user's applications, keyed by application id. */
export function useLiveProgress() {
  return useContext(LiveProgressContext);
}

/** How long a finished run's checklist stays on screen. */
const KEEP_FINISHED_MS = 60_000;

/**
 * Subscribes to the server-sent event stream. Refreshes server components
 * whenever the user's jobs, applications or timeline change, and keeps the
 * worker's live step-by-step progress for components that show it.
 */
export function LiveUpdatesProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const last = useRef<string | null>(null);
  const [progress, setProgress] = useState<Record<string, ApplicationProgress>>({});

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
      source.addEventListener("progress", (event) => {
        try {
          const p = JSON.parse((event as MessageEvent<string>).data) as ApplicationProgress;
          setProgress((prev) => {
            const next: Record<string, ApplicationProgress> = { ...prev, [p.applicationId]: p };
            const cutoff = Date.now() - KEEP_FINISHED_MS;
            for (const [id, value] of Object.entries(next)) {
              if ((value.phase === "done" || value.phase === "failed") && new Date(value.updatedAt).getTime() < cutoff) delete next[id];
            }
            return next;
          });
        } catch {
          /* ignore malformed progress */
        }
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

  return <LiveProgressContext.Provider value={progress}>{children}</LiveProgressContext.Provider>;
}
