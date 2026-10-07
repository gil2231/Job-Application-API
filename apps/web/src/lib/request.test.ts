import { describe, expect, it } from "vitest";
import { contentSecurityPolicy } from "./csp";
import { clientIp } from "./request";

describe("clientIp", () => {
  it("takes the address our own proxy appended, not the one the client claimed", () => {
    expect(clientIp("6.6.6.6, 203.0.113.9", null, 1)).toBe("203.0.113.9");
    expect(clientIp("6.6.6.6, 203.0.113.9, 10.0.0.2", null, 2)).toBe("203.0.113.9");
    expect(clientIp("203.0.113.9", null, 3)).toBe("203.0.113.9");
  });
  it("falls back to X-Real-IP, and ignores both when no proxy is trusted", () => {
    expect(clientIp(null, "198.51.100.4", 1)).toBe("198.51.100.4");
    expect(clientIp("6.6.6.6", "6.6.6.6", 0)).toBe("unknown");
  });
});

describe("contentSecurityPolicy", () => {
  it("only runs scripts carrying this request's nonce and blocks framing and plugins", () => {
    const csp = contentSecurityPolicy("abc123", { https: true });
    expect(csp).toContain("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("upgrade-insecure-requests");
    expect(contentSecurityPolicy("n", { dev: true })).toContain("'unsafe-eval'");
  });
});
