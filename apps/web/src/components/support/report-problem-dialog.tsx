"use client";

import { useState } from "react";
import type { SupportCategory } from "@autoapply/shared";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { SupportForm } from "./support-form";

/** "Report a problem" for signed-in users. The trigger is whatever button or link is passed in. */
export function ReportProblemDialog({
  children,
  defaultCategory,
  applicationId,
}: {
  children: React.ReactNode;
  defaultCategory?: SupportCategory;
  applicationId?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Report a problem</DialogTitle>
          <DialogDescription>
            We&apos;ll see the page you&apos;re on{applicationId ? " and this application" : ""}, and reply by email to the address on your account.
          </DialogDescription>
        </DialogHeader>
        {/* Remounting on open starts each report with an empty form. */}
        {open && <SupportForm signedIn defaultCategory={defaultCategory} applicationId={applicationId} onSent={() => setOpen(false)} onCancel={() => setOpen(false)} />}
      </DialogContent>
    </Dialog>
  );
}
