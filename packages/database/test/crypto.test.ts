import { describe, expect, it } from "vitest";
import { decryptString, encryptString, isEncrypted } from "../src/crypto";

describe("field encryption", () => {
  it("round-trips and uses a fresh IV each time", () => {
    const a = encryptString("Prefer not to say");
    const b = encryptString("Prefer not to say");
    expect(isEncrypted(a)).toBe(true);
    expect(a).not.toBe(b);
    expect(decryptString(a)).toBe("Prefer not to say");
  });
  it("detects tampering", () => {
    const value = encryptString("secret");
    const raw = Buffer.from(value.slice(7), "base64");
    raw[raw.length - 1] = raw[raw.length - 1]! ^ 0xff;
    expect(() => decryptString("enc:v1:" + raw.toString("base64"))).toThrow();
  });
  it("passes plaintext through", () => {
    expect(decryptString("plain")).toBe("plain");
  });
});
