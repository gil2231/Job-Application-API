"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Download, MonitorDown, Share, SquarePlus, X } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { promptInstall, startPwa, useInstallState, type InstallPlatform } from "@/lib/pwa";

// The phone header and installed window bar are steel navy in both themes, like the sidebar.
const THEME_COLORS = { light: "#0f1623", dark: "#0f1623" };

/** Registers the service worker and keeps the window's title bar colour in step with the app theme. */
export function PwaSetup() {
  const { resolvedTheme } = useTheme();
  useEffect(() => startPwa(), []);
  useEffect(() => {
    if (!resolvedTheme) return;
    const color = resolvedTheme === "dark" ? THEME_COLORS.dark : THEME_COLORS.light;
    document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => {
      meta.setAttribute("content", color);
      meta.removeAttribute("media");
    });
  }, [resolvedTheme]);
  return null;
}

function Steps({ platform }: { platform: InstallPlatform }) {
  if (platform === "ios") {
    return (
      <ol className="grid gap-3 text-sm">
        <li className="flex gap-3">
          <Share className="text-primary mt-0.5 size-4 shrink-0" />
          <span>
            In Safari, tap the <strong>Share</strong> button (the square with an arrow, at the bottom of the screen or next to the address bar).
          </span>
        </li>
        <li className="flex gap-3">
          <SquarePlus className="text-primary mt-0.5 size-4 shrink-0" />
          <span>
            Scroll down and tap <strong>Add to Home Screen</strong>, then tap <strong>Add</strong>.
          </span>
        </li>
      </ol>
    );
  }
  if (platform === "safari-mac") {
    return (
      <p className="text-sm">
        In Safari&apos;s menu bar, choose <strong>File</strong>, then <strong>Add to Dock</strong>, then click <strong>Add</strong>. Applyance then opens from your Dock in its own window.
      </p>
    );
  }
  return (
    <ul className="grid gap-3 text-sm">
      <li className="flex gap-3">
        <MonitorDown className="text-primary mt-0.5 size-4 shrink-0" />
        <span>
          <strong>On a computer</strong>, open Applyance in Chrome or Edge and click the install icon at the right end of the address bar.
        </span>
      </li>
      <li className="flex gap-3">
        <SquarePlus className="text-primary mt-0.5 size-4 shrink-0" />
        <span>
          <strong>On an Android phone</strong>, open Applyance in Chrome, tap the <strong>⋮</strong> menu, then <strong>Add to Home screen</strong> and <strong>Install</strong>.
        </span>
      </li>
      <li className="flex gap-3">
        <Share className="text-primary mt-0.5 size-4 shrink-0" />
        <span>
          <strong>On an iPhone or iPad</strong>, open Applyance in Safari, tap <strong>Share</strong>, then <strong>Add to Home Screen</strong>.
        </span>
      </li>
    </ul>
  );
}

/**
 * Install support for any surface: `install()` opens the browser's own dialog
 * where there is one, and otherwise shows the steps for this device.
 */
export function useInstallApp() {
  const state = useInstallState();
  const [helpOpen, setHelpOpen] = useState(false);
  const install = async () => {
    if (state.platform === "prompt") await promptInstall();
    else setHelpOpen(true);
  };
  const dialog = (
    <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Install Applyance</DialogTitle>
          <DialogDescription>Get Applyance on your home screen or desktop. It opens in its own window, like any other app.</DialogDescription>
        </DialogHeader>
        <Steps platform={state.platform} />
        <DialogFooter>
          <Button variant="outline" onClick={() => setHelpOpen(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
  return { installed: state.installed, install, dialog };
}

/** "Install Applyance" entry for the account menu; hidden once installed. */
export function InstallMenuItem({ onInstall }: { onInstall: () => void }) {
  const { installed } = useInstallState();
  if (installed) return null;
  return (
    <DropdownMenuItem onSelect={onInstall}>
      <Download />
      Install Applyance
    </DropdownMenuItem>
  );
}

const DISMISS_KEY = "applyance:install-banner-dismissed";

const dismissListeners = new Set<() => void>();
let sessionDismissed = false;

function readDismissed() {
  try {
    return sessionDismissed || window.localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return sessionDismissed;
  }
}

function subscribeDismissed(listener: () => void) {
  dismissListeners.add(listener);
  return () => dismissListeners.delete(listener);
}

/** A dismissible card offering to install the app. Shows only in a browser, never inside the installed app. */
export function InstallBanner() {
  const { installed, install, dialog } = useInstallApp();
  // Starts hidden on the server so the card never flashes for people who dismissed it.
  const dismissed = useSyncExternalStore(subscribeDismissed, readDismissed, () => true);
  if (installed || dismissed) return null;
  const dismiss = () => {
    try {
      window.localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // Storage blocked: the card hides for now and comes back next visit.
      sessionDismissed = true;
    }
    dismissListeners.forEach((l) => l());
  };
  return (
    <div className="bg-card flex items-center gap-3 rounded-xl border p-3 pr-2" data-testid="install-banner">
      {/* eslint-disable-next-line @next/next/no-img-element -- static app icon */}
      <img src="/icons/icon-192.png" alt="" className="size-10 shrink-0 rounded-lg" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">Install Applyance</p>
        <p className="text-muted-foreground text-xs">Open it from your home screen or desktop and answer Needs Attention items on the go.</p>
      </div>
      <Button size="sm" onClick={() => void install()}>
        Install
      </Button>
      <Button size="icon-sm" variant="ghost" aria-label="Dismiss install suggestion" onClick={dismiss}>
        <X />
      </Button>
      {dialog}
    </div>
  );
}
