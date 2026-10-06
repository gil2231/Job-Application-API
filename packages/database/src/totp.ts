import { createHmac, randomBytes } from "node:crypto";
import { safeEqual } from "./crypto";

/** RFC 6238 time-based one-time passwords (SHA-1, 6 digits, 30 s), as every authenticator app uses. */
export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_DIGITS = 6;
/** Accept the previous and next code too, for clock drift. */
const DRIFT_STEPS = 1;

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.replace(/=+$/, "").replace(/\s+/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = BASE32.indexOf(char);
    if (index === -1) throw new Error("Invalid base32");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A new 160-bit secret, base32 encoded. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function totpStep(now: number = Date.now()): number {
  return Math.floor(now / 1000 / TOTP_PERIOD_SECONDS);
}

export function totpCode(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = hmac[hmac.length - 1]! & 0xf;
  const binary = (hmac.readUInt32BE(offset) & 0x7fffffff) % 10 ** TOTP_DIGITS;
  return String(binary).padStart(TOTP_DIGITS, "0");
}

/**
 * The time step the code belongs to, or null when it matches none in the
 * drift window. Callers store the step so the same code can't be replayed.
 */
export function matchTotp(secret: string, code: string, now: number = Date.now()): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const current = totpStep(now);
  for (let delta = -DRIFT_STEPS; delta <= DRIFT_STEPS; delta++) {
    if (safeEqual(totpCode(secret, current + delta), code)) return current + delta;
  }
  return null;
}

export function otpauthUri(secret: string, account: string, issuer = "Applyance"): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({ secret, issuer, algorithm: "SHA1", digits: String(TOTP_DIGITS), period: String(TOTP_PERIOD_SECONDS) });
  return `otpauth://totp/${label}?${params.toString()}`;
}
