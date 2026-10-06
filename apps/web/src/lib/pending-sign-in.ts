import "server-only";
import { cookies } from "next/headers";
import { decryptString, encryptString } from "@autoapply/database/crypto";

/**
 * Between the password and the two-factor code, the browser holds this
 * cookie: the user id and an expiry, encrypted and authenticated with
 * AES-256-GCM, so it can't be read or forged. It is not a session; it only
 * lets the person enter a code for that account for a few minutes.
 */
const COOKIE = process.env.NODE_ENV === "production" ? "__Host-applyance_2fa" : "applyance_2fa";
const TTL_MS = 10 * 60 * 1000;

interface PendingSignIn {
  userId: string;
  next: string;
  expiresAt: number;
}

export async function setPendingSignIn(userId: string, next: string): Promise<void> {
  const value: PendingSignIn = { userId, next, expiresAt: Date.now() + TTL_MS };
  const store = await cookies();
  store.set(COOKIE, encryptString(JSON.stringify(value)), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: TTL_MS / 1000,
  });
}

export async function getPendingSignIn(): Promise<PendingSignIn | null> {
  const raw = (await cookies()).get(COOKIE)?.value;
  if (!raw || !raw.startsWith("enc:v1:")) return null;
  try {
    const value = JSON.parse(decryptString(raw)) as PendingSignIn;
    return typeof value.userId === "string" && value.expiresAt > Date.now() ? value : null;
  } catch {
    return null;
  }
}

export async function clearPendingSignIn(): Promise<void> {
  (await cookies()).delete(COOKIE);
}
