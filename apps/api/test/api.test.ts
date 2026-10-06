import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { createSession, createUser, prisma } from "@autoapply/database";
import { buildServer } from "../src/server";

let app: FastifyInstance;
let tokenA: string;
let tokenB: string;

beforeAll(async () => {
  app = await buildServer({ logger: false });
  const stamp = Date.now();
  const a = await createUser({ name: "A", email: `api-a-${stamp}@example.com`, password: "correct-horse-1" });
  const b = await createUser({ name: "B", email: `api-b-${stamp}@example.com`, password: "correct-horse-1" });
  tokenA = (await createSession(a.id)).token;
  tokenB = (await createSession(b.id)).token;
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

const auth = (token: string) => ({ authorization: `Bearer ${token}` });

describe("API", () => {
  it("reports health without auth", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.json()).toEqual({ status: "ok" });
  });

  it("rejects unauthenticated requests", async () => {
    expect((await app.inject({ method: "GET", url: "/v1/jobs" })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/v1/jobs", headers: auth("forged-token-forged-token") })).statusCode).toBe(401);
  });

  it("creates, deduplicates, lists and applies to jobs per user", async () => {
    const body = { url: "https://jobs.lever.co/acme/123?utm_source=x", title: "AE", company: "Acme" };
    const created = await app.inject({ method: "POST", url: "/v1/jobs", headers: auth(tokenA), payload: body });
    expect(created.statusCode).toBe(201);
    expect(created.json().job.platform).toBe("LEVER");
    const jobId = created.json().job.id as string;

    expect((await app.inject({ method: "POST", url: "/v1/jobs", headers: auth(tokenA), payload: { ...body, url: "https://jobs.lever.co/acme/123" } })).statusCode).toBe(409);
    expect((await app.inject({ method: "POST", url: "/v1/jobs", headers: auth(tokenA), payload: { url: "nope" } })).statusCode).toBe(400);

    const listA = await app.inject({ method: "GET", url: "/v1/jobs", headers: auth(tokenA) });
    const listB = await app.inject({ method: "GET", url: "/v1/jobs", headers: auth(tokenB) });
    expect(listA.json().total).toBe(1);
    expect(listB.json().total).toBe(0);

    // B cannot apply to A's job.
    const foreign = await app.inject({ method: "POST", url: "/v1/applications", headers: auth(tokenB), payload: { jobIds: [jobId] } });
    expect(foreign.json()).toMatchObject({ queued: 0, notFound: 1 });

    const applied = await app.inject({ method: "POST", url: "/v1/applications", headers: auth(tokenA), payload: { jobIds: [jobId] } });
    expect(applied.json()).toMatchObject({ queued: 1 });
    const apps = await app.inject({ method: "GET", url: "/v1/applications", headers: auth(tokenA) });
    const appId = apps.json().rows[0].id as string;
    expect((await app.inject({ method: "GET", url: `/v1/applications/${appId}`, headers: auth(tokenA) })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: `/v1/applications/${appId}`, headers: auth(tokenB) })).statusCode).toBe(404);
  });
});
