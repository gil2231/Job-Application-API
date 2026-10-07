"use client";

import { useTransition } from "react";
import { Check, Mail, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { setReportStatusAction } from "@/actions/admin-support";
import { Button } from "@/components/ui/button";

export function ReportActions({ id, email, subject, resolved }: { id: string; email: string; subject: string; resolved: boolean }) {
  const [pending, startTransition] = useTransition();
  const toggle = () =>
    startTransition(async () => {
      const result = await setReportStatusAction(id, !resolved);
      if (result.ok) toast.success(result.message);
      else toast.error(result.message ?? "Something went wrong");
    });
  return (
    <div className="flex flex-wrap gap-2">
      <Button asChild size="sm" variant="outline">
        <a href={`mailto:${email}?subject=${encodeURIComponent(`Re: ${subject}`)}`}>
          <Mail /> Reply by email
        </a>
      </Button>
      <Button size="sm" variant={resolved ? "outline" : "default"} disabled={pending} onClick={toggle}>
        {resolved ? <RotateCcw /> : <Check />} {resolved ? "Reopen" : "Mark resolved"}
      </Button>
    </div>
  );
}
