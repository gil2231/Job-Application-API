"use server";

import { revalidatePath } from "next/cache";
import { audit, getJob, prisma } from "@autoapply/database";
import { detectPlatformFromUrl } from "@autoapply/ats-adapters";
import { applyYourselfMessage, followToCompany } from "@autoapply/ingestion";
import { listingSite } from "@autoapply/shared";
import { authedAction, type ActionResult } from "@/lib/action";
import { fakeJobSources } from "@/lib/fake-job-sources";
import { LIMITS, rateLimit } from "@/lib/rate-limit";

const fake = process.env.E2E_FAKE_JOB_SOURCES === "1" && process.env.NODE_ENV !== "production";

/**
 * Look for a job saved from LinkedIn, Handshake or another listing site on the
 * company's own site, and point the job there so Applyance can fill it. The
 * listing site itself is never fetched.
 */
export async function followJobAction(jobId: string): Promise<ActionResult<{ found: boolean }>> {
  return authedAction<{ found: boolean }>(async (user) => {
    if (typeof jobId !== "string") return { ok: false, message: "Job not found" };
    const job = await getJob(user.id, jobId);
    const current = job.applicationUrl ?? job.url;
    const site = listingSite(current);
    if (!site) return { ok: true, message: "This job already applies on the company's own site.", data: { found: true } };
    const limit = await rateLimit(`posting-lookup:${user.id}`, LIMITS.postingLookup.limit, LIMITS.postingLookup.windowMs);
    if (!limit.allowed) return { ok: false, message: `Lookup limit reached. Try again in ${Math.ceil(limit.retryAfterSeconds / 60)} minutes.` };

    const found = await followToCompany(
      { url: job.url, applicationUrl: job.applicationUrl, title: job.title, company: job.company, location: job.location },
      fake ? { http: fakeJobSources, aggregatorKey: "fake" } : { aggregatorKey: process.env.JSEARCH_API_KEY?.trim() || null },
    );
    if (!found) return { ok: false, message: applyYourselfMessage(site, current, job), data: { found: false } };
    await prisma.job.update({ where: { id: job.id }, data: { applicationUrl: found.url, platform: detectPlatformFromUrl(found.url).platform } });
    await audit(user.id, "jobs.followed_to_company", { entityType: "Job", entityId: job.id, metadata: { from: site, via: found.via } });
    revalidatePath(`/jobs/${job.id}`);
    revalidatePath("/jobs");
    return { ok: true, message: `Found ${job.company}'s own application on ${found.foundOn}. Applyance will apply there.`, data: { found: true } };
  });
}
