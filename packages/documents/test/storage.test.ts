import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { buildStorageKey, LocalStorageDriver, localStorageRoot } from "../src/storage";
import { sanitizeFileName, validateUpload } from "../src/validation";

describe("LocalStorageDriver", async () => {
  const dir = await mkdtemp(join(tmpdir(), "autoapply-storage-"));
  afterAll(() => rm(dir, { recursive: true, force: true }));
  const driver = new LocalStorageDriver(dir);

  it("stores, reads and deletes", async () => {
    const key = buildStorageKey("user1", "RESUME", "pdf");
    await driver.put(key, Buffer.from("%PDF-1.4 hi"), "application/pdf");
    expect((await driver.get(key)).toString()).toBe("%PDF-1.4 hi");
    await driver.delete(key);
    await expect(driver.get(key)).rejects.toThrow();
  });

  it("refuses keys that escape the root", async () => {
    await expect(driver.put("../../etc/passwd", Buffer.from("x"), "text/plain")).rejects.toThrow(/Invalid storage key/);
  });
});

describe("validateUpload", () => {
  it("accepts a real PDF and rejects a renamed file", () => {
    expect(validateUpload("resume.pdf", Buffer.from("%PDF-1.7 ..."))).toMatchObject({ ok: true, mimeType: "application/pdf" });
    expect(validateUpload("resume.pdf", Buffer.from("MZ executable"))).toMatchObject({ ok: false });
    expect(validateUpload("payload.exe", Buffer.from("MZ"))).toMatchObject({ ok: false });
    expect(validateUpload("empty.pdf", Buffer.alloc(0))).toMatchObject({ ok: false });
  });
  it("sanitizes file names", () => {
    expect(sanitizeFileName("../../evil<script>.pdf")).toBe("evilscript.pdf");
    expect(sanitizeFileName("C:\\Users\\me\\Resume 2026.pdf")).toBe("Resume 2026.pdf");
  });
});

describe("localStorageRoot", () => {
  const root = resolve(import.meta.dirname, "../../..");
  it("resolves a relative directory from the workspace root, wherever the app runs", () => {
    expect(localStorageRoot(".storage", join(root, "apps/web"))).toBe(join(root, ".storage"));
    expect(localStorageRoot(".storage", join(root, "apps/worker/src"))).toBe(join(root, ".storage"));
  });
  it("keeps absolute directories", () => {
    expect(localStorageRoot("/var/autoapply")).toBe("/var/autoapply");
  });
});
