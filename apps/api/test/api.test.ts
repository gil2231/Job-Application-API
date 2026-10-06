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

  it("moves applications through Flightpath stages and manages interviews per user", async () => {
    const created = await app.inject({ method: "POST", url: "/v1/jobs", headers: auth(tokenA), payload: { url: "https://boards.greenhouse.io/linear/jobs/42", title: "AE", company: "Linear" } });
    const jobId = created.json().job.id as string;
    await app.inject({ method: "POST", url: "/v1/applications", headers: auth(tokenA), payload: { jobIds: [jobId] } });
    const appId = (await prisma.application.findUniqueOrThrow({ where: { jobId } })).id;

    expect((await app.inject({ method: "PATCH", url: `/v1/applications/${appId}/stage`, headers: auth(tokenA), payload: { stage: "PROCESSING" } })).statusCode).toBe(409);
    expect((await app.inject({ method: "PATCH", url: `/v1/applications/${appId}/stage`, headers: auth(tokenA), payload: { stage: "NOPE" } })).statusCode).toBe(400);
    expect((await app.inject({ method: "PATCH", url: `/v1/applications/${appId}/stage`, headers: auth(tokenB), payload: { stage: "SUBMITTED" } })).statusCode).toBe(404);
    const moved = await app.inject({ method: "PATCH", url: `/v1/applications/${appId}/stage`, headers: auth(tokenA), payload: { stage: "SUBMITTED" } });
    expect(moved.json()).toMatchObject({ from: "QUEUED", to: "SUBMITTED", kind: "mark_submitted" });

    const round = await app.inject({ method: "POST", url: `/v1/applications/${appId}/interviews`, headers: auth(tokenA), payload: { kind: "PHONE_SCREEN", scheduledAt: new Date(Date.now() + 86400_000).toISOString(), durationMinutes: 30 } });
    expect(round.statusCode).toBe(201);
    const roundId = round.json().interview.id as string;
    expect((await app.inject({ method: "PUT", url: `/v1/interviews/${roundId}`, headers: auth(tokenB), payload: { status: "COMPLETED" } })).statusCode).toBe(404);
    expect((await app.inject({ method: "PUT", url: `/v1/interviews/${roundId}`, headers: auth(tokenA), payload: { kind: "PHONE_SCREEN", status: "COMPLETED" } })).json().interview.status).toBe("COMPLETED");

    const board = await app.inject({ method: "GET", url: "/v1/tracker/board", headers: auth(tokenA) });
    expect(board.json().columns.find((c: { stage: string }) => c.stage === "INTERVIEWING").total).toBe(1);
    const table = await app.inject({ method: "GET", url: "/v1/tracker/applications?stage=INTERVIEWING", headers: auth(tokenA) });
    expect(table.json().rows[0].id).toBe(appId);
    expect((await app.inject({ method: "GET", url: "/v1/tracker/applications?stage=INTERVIEWING", headers: auth(tokenB) })).json().total).toBe(0);
    expect((await app.inject({ method: "GET", url: `/v1/applications/${appId}/interviews`, headers: auth(tokenA) })).json().interviews).toHaveLength(1);
    expect((await app.inject({ method: "DELETE", url: `/v1/interviews/${roundId}`, headers: auth(tokenA) })).statusCode).toBe(204);
  });
});
