import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { describeBrowser, isLinkedIn, normalizeApiUrl, originPattern } from "../lib/api.js";
import { toStorageCookies } from "../lib/page.js";
import { PAGE_SCRIPTS_PATH, pageScriptsFile } from "../scripts/build";

describe("extension helpers", () => {
  it("ships page scripts generated from the worker's current scans", () => {
    // If this fails, run: pnpm --filter @autoapply/extension build
    expect(readFileSync(PAGE_SCRIPTS_PATH, "utf8")).toBe(pageScriptsFile());
  });

  it("converts browser cookies to the worker's format", () => {
    const base = { storeId: "0", session: false, httpOnly: true, secure: true, path: "/" };
    expect(
      toStorageCookies([
        { ...base, name: "a", value: "1", domain: "acme.wd5.myworkdayjobs.com", hostOnly: true, sameSite: "lax", expirationDate: 1900000000.5 },
        { ...base, name: "b", value: "2", domain: ".myworkdayjobs.com", hostOnly: false, sameSite: "no_restriction", session: true },
        { ...base, name: "c", value: "3", domain: "myworkdayjobs.com", hostOnly: false, sameSite: "unspecified", expirationDate: 1 },
      ] as chrome.cookies.Cookie[]),
    ).toEqual([
      { name: "a", value: "1", domain: "acme.wd5.myworkdayjobs.com", path: "/", expires: 1900000000, httpOnly: true, secure: true, sameSite: "Lax" },
      { name: "b", value: "2", domain: ".myworkdayjobs.com", path: "/", expires: -1, httpOnly: true, secure: true, sameSite: "None" },
      { name: "c", value: "3", domain: ".myworkdayjobs.com", path: "/", expires: 1, httpOnly: true, secure: true, sameSite: "Lax" },
    ]);
  });

  it("normalizes the server address and recognizes LinkedIn", () => {
    expect(normalizeApiUrl("localhost:4000/")).toBe("http://localhost:4000");
    expect(normalizeApiUrl(" https://api.applyance.example/v1 ")).toBe("https://api.applyance.example");
    expect(normalizeApiUrl("ftp://x")).toBeNull();
    expect(normalizeApiUrl("")).toBeNull();
    expect(originPattern("http://localhost:4000")).toBe("http://localhost/*");
    expect(isLinkedIn("https://www.linkedin.com/jobs/view/1")).toBe(true);
    expect(isLinkedIn("https://notlinkedin.com/jobs")).toBe(false);
    expect(describeBrowser("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 Chrome/140.0 Safari/537.36")).toBe("Chrome on macOS");
  });
});
