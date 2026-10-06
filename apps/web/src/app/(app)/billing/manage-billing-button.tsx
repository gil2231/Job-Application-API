"use client";

import { useTransition } from "react";
import { ExternalLink, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { openBillingPortalAction } from "@/actions/billing";
import { Button } from "@/components/ui/button";

export function ManageBillingButton({ label = "Manage billing" }: { label?: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await openBillingPortalAction();
          if (result.ok && result.data) window.location.assign(result.data.url);
          else toast.error(result.message ?? "Couldn't open billing");
        })
      }
    >
      {pending ? <Loader2 className="animate-spin" /> : <ExternalLink />}
      {label}
    </Button>
  );
}
