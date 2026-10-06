/**
 * Removes personal data and secrets from text before it leaves the server in
 * an error report or alert. Applyance holds resumes, contact details and
 * session tokens, so reports carry the shape of a failure, never its data.
 */
const RULES: [RegExp, string][] = [
  // Connection strings with credentials: postgres://user:pass@host, redis://:pass@host
  [/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]*:[^\s/@]*@/gi, "$1[credentials]@"],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer [token]"],
  [/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]"],
  // Phone numbers: 10+ digits with optional separators
  [/(?<![\w.])\+?\d[\d\s().-]{8,}\d(?![\w.])/g, "[phone]"],
  // Long opaque tokens (session tokens, API keys, base64 keys)
  [/\b(?:sk|pk|rk|whsec|xox[abp])[-_][A-Za-z0-9_-]{8,}\b/g, "[secret]"],
  [/\b(?=[A-Za-z_-]*\d)[A-Za-z0-9_-]{32,}\b/g, "[secret]"],
  [/(?<![A-Za-z0-9+/])(?=[A-Za-z+/]*\d)[A-Za-z0-9+/]{40,}={0,2}/g, "[secret]"],
];

const SENSITIVE_KEY = /pass(word)?|secret|token|key|auth|cookie|session|email|phone|ssn|address|dob|birth|resume|answer/i;

export function scrubText(text: string, maxLength = 2000): string {
  let out = text;
  for (const [pattern, replacement] of RULES) out = out.replace(pattern, replacement);
  return out.length > maxLength ? `${out.slice(0, maxLength)}…` : out;
}

/** Scrubs every string in a small JSON-like value and drops values under sensitive-looking keys. */
export function scrubValue(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[truncated]";
  if (typeof value === "string") return scrubText(value, 500);
  if (typeof value === "number" || typeof value === "boolean" || value == null) return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => scrubValue(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>).slice(0, 50)) {
      out[k] = SENSITIVE_KEY.test(k) ? "[redacted]" : scrubValue(v, depth + 1);
    }
    return out;
  }
  return String(value);
}
