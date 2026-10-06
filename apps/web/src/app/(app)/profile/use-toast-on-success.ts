"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";

/** Toast each successful action result once. */
export function useToastOnSuccess(state: { ok: boolean; message?: string }, onSuccess?: () => void) {
  const last = useRef(state);
  useEffect(() => {
    if (state !== last.current && state.ok) {
      if (state.message) toast.success(state.message);
      onSuccess?.();
    }
    last.current = state;
  }, [state, onSuccess]);
}
