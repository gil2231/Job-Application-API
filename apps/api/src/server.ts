import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { z } from "zod";
import { detectPlatformFromUrl } from "@autoapply/ats-adapters";
import {
  ConflictError,
  createInterviewRound,
  createManualJob,
  deleteInterviewRound,
  DuplicateJobError,
  getApplicationDetail,
  getDashboardStats,
  getTrackerBoard,
  listApplications,
  listInterviewRounds,
  listTrackerApplications,
  moveApplicationStage,
  listJobs,
  NotFoundError,
  prisma,
  queueApplications,
  updateInterviewRound,
  validateSessionToken,
  type PublicUser,
} from "@autoapply/database";
import { captureException } from "@autoapply/ops";
import { applicationFiltersSchema, fieldErrors, interviewRoundSchema, jobFiltersSchema, manualJobSchema, trackerFiltersSchema, trackerStageSchema } from "@autoapply/shared";

declare module "fastify" {
  interface FastifyRequest {
    user?: PublicUser;
  }
}

const SESSION_COOKIES = ["__Host-autoapply_session", "autoapply_session"];

/** Accepts the web app's session cookie or the same token as a Bearer header. */
async function authenticate(request: FastifyRequest, reply: FastifyReply) {
  const header = request.headers.authorization;
  const bearer = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
  const token = bearer ?? SESSION_COOKIES.map((name) => request.cookies[name]).find(Boolean);
  const session = await validateSessionToken(token);
  if (!session) return reply.code(401).send({ error: "Unauthorized" });
  request.user = session.user;
}

const idParam = z.object({ id: z.string().regex(/^[a-z0-9]{20,40}$/i) });

/**
 * REST API for non-browser clients (the worker, future browser extension,
 * integrations). Uses the same data-access layer and authorization rules as
 * the web app: every query is scoped to the authenticated user.
 */
export async function buildServer(options: { logger?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? true, trustProxy: true, bodyLimit: 1_000_000 });
  await app.register(helmet);
  await app.register(cookie);
  await app.register(rateLimit, { max: 300, timeWindow: "1 minute" });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof z.ZodError) return reply.code(400).send({ error: "Invalid request", fields: fieldErrors(error) });
    if (error instanceof DuplicateJobError) return reply.code(409).send({ error: error.message, jobId: error.existingJobId });
    if (error instanceof NotFoundError) return reply.code(404).send({ error: error.message });
    if (error instanceof ConflictError) return reply.code(409).send({ error: error.message });
    const status = (error as { statusCode?: number }).statusCode;
    if (status && status < 500) return reply.code(status).send({ error: (error as Error).message });
    app.log.error(error);
    // routeOptions.url is the route pattern (/v1/applications/:id), never the real path.
    captureException(error, { tags: { route: request.routeOptions.url, method: request.method }, userId: request.user?.id });
    return reply.code(500).send({ error: "Internal server error" });
  });

  app.get("/health", async (_request, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return { status: "ok" };
    } catch {
      return reply.code(503).send({ status: "error", database: "unreachable" });
    }
  });

  await app.register(
    async (v1) => {
      v1.addHook("preHandler", authenticate);

      v1.get("/me", async (request) => ({ user: request.user }));

      v1.get("/dashboard", async (request) => getDashboardStats(request.user!.id));

      v1.get("/jobs", async (request) => listJobs(request.user!.id, jobFiltersSchema.parse(request.query)));

      v1.post("/jobs", async (request, reply) => {
        const input = manualJobSchema.parse(request.body);
        const job = await createManualJob(request.user!.id, input, detectPlatformFromUrl(input.applicationUrl ?? input.url).platform);
        return reply.code(201).send({ job });
      });

      v1.post("/applications", async (request, reply) => {
        const body = z.object({ jobIds: z.array(z.string()).min(1).max(500), mode: z.enum(["MANUAL", "REVIEW", "AUTO"]).optional() }).parse(request.body);
        const result = await queueApplications(request.user!.id, body.jobIds, { mode: body.mode });
        return reply.code(result.queued ? 201 : 200).send(result);
      });

      v1.get("/applications", async (request) => listApplications(request.user!.id, applicationFiltersSchema.parse(request.query)));

      v1.get("/applications/:id", async (request) => {
        const { id } = idParam.parse(request.params);
        return getApplicationDetail(request.user!.id, id);
      });

      // Flightpath (application tracker)
      v1.get("/tracker/board", async (request) => {
        const { q } = trackerFiltersSchema.parse(request.query);
        return getTrackerBoard(request.user!.id, { q });
      });

      v1.get("/tracker/applications", async (request) => {
        const { view: _view, ...filters } = trackerFiltersSchema.parse(request.query);
        return listTrackerApplications(request.user!.id, filters);
      });

      v1.patch("/applications/:id/stage", async (request) => {
        const { id } = idParam.parse(request.params);
        const { stage } = z.object({ stage: trackerStageSchema }).parse(request.body);
        return moveApplicationStage(request.user!.id, id, stage);
      });

      v1.get("/applications/:id/interviews", async (request) => {
        const { id } = idParam.parse(request.params);
        return { interviews: await listInterviewRounds(request.user!.id, id) };
      });

      v1.post("/applications/:id/interviews", async (request, reply) => {
        const { id } = idParam.parse(request.params);
        const round = await createInterviewRound(request.user!.id, id, interviewRoundSchema.parse(request.body ?? {}));
        return reply.code(201).send({ interview: round });
      });

      v1.put("/interviews/:id", async (request) => {
        const { id } = idParam.parse(request.params);
        return { interview: await updateInterviewRound(request.user!.id, id, interviewRoundSchema.parse(request.body ?? {})) };
      });

      v1.delete("/interviews/:id", async (request, reply) => {
        const { id } = idParam.parse(request.params);
        await deleteInterviewRound(request.user!.id, id);
        return reply.code(204).send();
      });
    },
    { prefix: "/v1" },
  );

  return app;
}
