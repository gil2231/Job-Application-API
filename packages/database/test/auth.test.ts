import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/client";
import {
  authenticate, createSession, createUser, EmailTakenError, MAX_FAILED_LOGINS, revokeSessionToken, validateSessionToken,
} from "../src/repositories/auth";
import { resetDatabase } from "./helpers";

beforeEach(resetDatabase);

describe("auth", () => {
  it("creates a user with hashed password, profile, rules and settings", async () => {
    const user = await createUser({ name: "Ada", email: "ADA@Example.com", password: "correct-horse-1" });
    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id }, include: { profile: true, settings: true, automationRule: true } });
    expect(row.email).toBe("ada@example.com");
    expect(row.passwordHash).toMatch(/^\$argon2id\$/);
    expect(row.passwordHash).not.toContain("correct-horse-1");
    expect(row.profile?.email).toBe("ada@example.com");
    expect(row.settings).not.toBeNull();
    expect(row.automationRule?.matchWeights).toMatchObject({ skills: 25 });
  });

  it("rejects a duplicate email", async () => {
    await createUser({ name: "A", email: "a@example.com", password: "correct-horse-1" });
    await expect(createUser({ name: "B", email: "A@example.com", password: "correct-horse-1" })).rejects.toBeInstanceOf(EmailTakenError);
  });

  it("authenticates and locks after repeated failures", async () => {
    await createUser({ name: "A", email: "a@example.com", password: "correct-horse-1" });
    expect(await authenticate("a@example.com", "correct-horse-1")).toMatchObject({ ok: true });
    expect(await authenticate("nobody@example.com", "x")).toMatchObject({ ok: false, reason: "invalid" });
    for (let i = 0; i < MAX_FAILED_LOGINS - 1; i++) {
      expect(await authenticate("a@example.com", "wrong")).toMatchObject({ ok: false, reason: "invalid" });
    }
    expect(await authenticate("a@example.com", "wrong")).toMatchObject({ ok: false, reason: "locked" });
    // Even the right password is refused while locked.
    expect(await authenticate("a@example.com", "correct-horse-1")).toMatchObject({ ok: false, reason: "locked" });
  });

  it("stores only a hash of the session token and validates it", async () => {
    const user = await createUser({ name: "A", email: "a@example.com", password: "correct-horse-1" });
    const { token } = await createSession(user.id, { ipAddress: "127.0.0.1", userAgent: "test" });
    const stored = await prisma.session.findFirstOrThrow({ where: { userId: user.id } });
    expect(stored.tokenHash).not.toBe(token);
    expect((await validateSessionToken(token))?.user.id).toBe(user.id);
    expect(await validateSessionToken(token + "x")).toBeNull();
    await revokeSessionToken(token);
    expect(await validateSessionToken(token)).toBeNull();
  });

  it("rejects and removes expired sessions", async () => {
    const user = await createUser({ name: "A", email: "a@example.com", password: "correct-horse-1" });
    const { token } = await createSession(user.id);
    await prisma.session.updateMany({ where: { userId: user.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await validateSessionToken(token)).toBeNull();
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0);
  });
});
