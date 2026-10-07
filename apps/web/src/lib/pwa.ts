"use client";

import { useSyncExternalStore } from "react";

/** Chromium's install prompt event (not in the DOM typings yet). */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export type InstallPlatform = "prompt" | "ios" | "safari-mac" | "other";

export interface InstallState {
  /** Already running as the installed app (its own window or home-screen app). */
  installed: boolean;
  /** How this browser installs apps: a native prompt we can open, or steps the person follows. */
  platform: InstallPlatform;
}

let deferredPrompt: BeforeInstallPromptEvent | null = null;
let installedNow = false;
let snapshot: InstallState = { installed: false, platform: "other" };
const listeners = new Set<() => void>();
const SERVER_SNAPSHOT: InstallState = { installed: false, platform: "other" };

function compute(): InstallState {
  const nav = window.navigator as Navigator & { standalone?: boolean };
  const installed = installedNow || window.matchMedia("(display-mode: standalone)").matches || window.matchMedia("(display-mode: window-controls-overlay)").matches || nav.standalone === true;
  const ua = nav.userAgent;
  // iPadOS reports itself as a Mac, so touch support tells them apart.
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && nav.maxTouchPoints > 1);
  const safariMac = !ios && /Macintosh/.test(ua) && /Safari\//.test(ua) && !/Chrome|Chromium|Edg|Firefox/.test(ua);
  const platform: InstallPlatform = deferredPrompt ? "prompt" : ios ? "ios" : safariMac ? "safari-mac" : "other";
  return { installed, platform };
}

function emit() {
  const next = compute();
  if (next.installed !== snapshot.installed || next.platform !== snapshot.platform) snapshot = next;
  listeners.forEach((l) => l());
}

let started = false;
/** Registers the service worker and starts listening for install events. Safe to call more than once. */
export function startPwa() {
  if (started || typeof window === "undefined") return;
  started = true;
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredPrompt = event as BeforeInstallPromptEvent;
    emit();
  });
  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    installedNow = true;
    emit();
  });
  window.matchMedia("(display-mode: standalone)").addEventListener("change", emit);
  emit();
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {
      // Installing still works without it; only the offline page is lost.
    });
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useInstallState(): InstallState {
  return useSyncExternalStore(subscribe, () => snapshot, () => SERVER_SNAPSHOT);
}

/** Opens the browser's own install dialog. Returns false when this browser has none to show. */
export async function promptInstall(): Promise<boolean> {
  if (!deferredPrompt) return false;
  const prompt = deferredPrompt;
  await prompt.prompt();
  const { outcome } = await prompt.userChoice;
  // A prompt can only be shown once; Chrome fires a fresh event if it can be offered again.
  deferredPrompt = null;
  if (outcome === "accepted") installedNow = true;
  emit();
  return outcome === "accepted";
}
