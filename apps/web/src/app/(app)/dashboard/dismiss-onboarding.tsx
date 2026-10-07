"use client";

import { X } from "lucide-react";
import { dismissOnboardingAction } from "@/actions/account";
import { ActionButton } from "@/components/action-button";

export function DismissOnboardingButton() {
  return (
    <ActionButton action={dismissOnboardingAction} size="icon-sm" variant="ghost" aria-label="Hide getting started">
      <X />
    </ActionButton>
  );
}
