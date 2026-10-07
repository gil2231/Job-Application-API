import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decryptFile, encryptFile, parseKey, sha256File } from "../src/backup/crypto";

let dir: string;
const key = randomBytes(32);
const plain = Buffer.concat([Buffer.from("CREATE TABLE users (email text); jane@example.com\n"), randomBytes(300_000)]);

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "ops-crypto-"));
  await writeFile(join(dir, "plain"), plain);
});
afterAll(() => rm(dir, { recursive: true, force: true }));

describe("backup encryption", () => {
  it("round-trips and reports the stored file's checksum", async () => {
    const result = await encryptFile(join(dir, "plain"), join(dir, "enc"), key);
    const encrypted = await readFile(join(dir, "enc"));
    expect(result.bytes).toBe(encrypted.length);
    expect(result.sha256).toBe(await sha256File(join(dir, "enc")));
    expect(encrypted.includes(Buffer.from("jane@example.com"))).toBe(false);
    await decryptFile(join(dir, "enc"), join(dir, "out"), [key]);
    expect((await readFile(join(dir, "out"))).equals(plain)).toBe(true);
  });

  it("picks the right key after a rotation", async () => {
    await encryptFile(join(dir, "plain"), join(dir, "enc-old"), key);
    await decryptFile(join(dir, "enc-old"), join(dir, "out-old"), [randomBytes(32), key]);
    expect((await readFile(join(dir, "out-old"))).equals(plain)).toBe(true);
  });

  it("refuses an unknown key", async () => {
    await encryptFile(join(dir, "plain"), join(dir, "enc2"), key);
    await expect(decryptFile(join(dir, "enc2"), join(dir, "out2"), [randomBytes(32)])).rejects.toThrow(/key that isn't configured/);
  });

  it("detects a modified file", async () => {
    await encryptFile(join(dir, "plain"), join(dir, "enc3"), key);
    const bytes = await readFile(join(dir, "enc3"));
    bytes[5000] = bytes[5000]! ^ 1;
    await writeFile(join(dir, "enc3"), bytes);
    await expect(decryptFile(join(dir, "enc3"), join(dir, "out3"), [key])).rejects.toThrow(/integrity check/);
  });

  it("validates keys", () => {
    expect(() => parseKey("c2hvcnQ=")).toThrow(/32 bytes/);
    expect(parseKey(key.toString("base64")).equals(key)).toBe(true);
  });
});
