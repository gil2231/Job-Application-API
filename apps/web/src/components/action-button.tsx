"use client";

import * as React from "react";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

type Result = { ok: boolean; message?: string };

/** Run a server action and report the result as a toast. */
export function useServerAction() {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const run = React.useCallback(
    (fn: () => Promise<Result>, opts: { onSuccess?: () => void; refresh?: boolean } = {}) => {
      startTransition(async () => {
        const result = await fn();
        if (result.ok) {
          if (result.message) toast.success(result.message);
          opts.onSuccess?.();
          if (opts.refresh !== false) router.refresh();
        } else {
          toast.error(result.message ?? "Something went wrong");
        }
      });
    },
    [router],
  );
  return { pending, run };
}

export function ActionButton({
  action,
  children,
  ...props
}: Omit<React.ComponentProps<typeof Button>, "onClick" | "action"> & { action: () => Promise<Result> }) {
  const { pending, run } = useServerAction();
  return (
    <Button {...props} disabled={pending || props.disabled} onClick={() => run(action)}>
      {pending && <Loader2 className="animate-spin" />}
      {children}
    </Button>
  );
}
