import { strToU8, zipSync, type Zippable } from "fflate";
import { audit, exportUserData, listExportFiles } from "@autoapply/database";
import { getStorage, sanitizeFileName } from "@autoapply/documents";
import { getSession } from "@/lib/auth";
import { LIMITS, rateLimit } from "@/lib/rate-limit";
import { getRequestContext } from "@/lib/request";

export const dynamic = "force-dynamic";

const README = `Your Applyance data

data.json holds everything Applyance stores about your account: your Master
Profile, Answer Library (sensitive answers decrypted), jobs, applications with
their questions, answers and history, interviews, rules, settings, plan and
usage, sessions and security log.

documents/ holds the resumes, cover letters and other files you uploaded or
approved.

Left out on purpose: your password and two-factor secrets, sign-in tokens, and
the browser cookies Applyance saved for application sites.
`;

/** Download everything in the account as a ZIP (data.json plus stored documents). */
export async function GET() {
  const session = await getSession();
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const userId = session.user.id;
  const limit = await rateLimit(`export:${userId}`, LIMITS.dataExport.limit, LIMITS.dataExport.windowMs);
  if (!limit.allowed) return Response.json({ error: "Too many exports. Try again later." }, { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } });

  const [data, files] = await Promise.all([exportUserData(userId), listExportFiles(userId)]);
  const zip: Zippable = { "README.txt": strToU8(README), "data.json": strToU8(JSON.stringify(data, null, 2)) };
  const storage = getStorage();
  const missing: string[] = [];
  for (const file of files) {
    try {
      zip[`documents/${file.id}-${sanitizeFileName(file.fileName)}`] = new Uint8Array(await storage.get(file.storageKey));
    } catch {
      missing.push(file.fileName);
    }
  }
  if (missing.length) zip["documents/MISSING.txt"] = strToU8(`These files couldn't be read from storage:\n${missing.join("\n")}\n`);

  const body = zipSync(zip, { level: 6 });
  await audit(userId, "account.data_exported", { context: await getRequestContext(), metadata: { files: files.length } });
  const date = new Date().toISOString().slice(0, 10);
  return new Response(Buffer.from(body), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="applyance-export-${date}.zip"`,
      "Cache-Control": "no-store",
    },
  });
}
