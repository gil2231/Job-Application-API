"use server";

import { revalidatePath } from "next/cache";
import { readResume } from "@autoapply/ai";
import { audit, createDocument, getDocument, getUserSettings, importResumeIntoProfile } from "@autoapply/database";
import { buildStorageKey, extractResumeText, getStorage, sanitizeFileName, sha256Hex, validateUpload } from "@autoapply/documents";
import { resumeImportSchema, type ResumeReading } from "@autoapply/shared";
import { authedAction, validationFailed, type ActionResult } from "@/lib/action";
import { rescoreInBackground } from "@/lib/pipeline";
import { LIMITS, rateLimit } from "@/lib/rate-limit";

const ID = /^[a-z0-9]{20,40}$/i;

/**
 * Read a resume (a new upload or one already in Documents) into a draft of
 * profile fields. Nothing is saved; the person reviews the draft first.
 */
export async function readResumeAction(formData: FormData): Promise<ActionResult<ResumeReading & { fileName: string }>> {
  return authedAction(async (user) => {
    const limit = rateLimit(`resume-import:${user.id}`, LIMITS.generate.limit, LIMITS.generate.windowMs);
    if (!limit.allowed) return { ok: false, message: `Import limit reached. Try again in ${Math.ceil(limit.retryAfterSeconds / 60)} min.` };

    const file = formData.get("file");
    const documentId = formData.get("documentId");
    let fileName: string;
    let body: Buffer;
    if (file instanceof File && file.size > 0) {
      fileName = sanitizeFileName(file.name);
      body = Buffer.from(await file.arrayBuffer());
    } else if (typeof documentId === "string" && ID.test(documentId)) {
      const doc = await getDocument(user.id, documentId);
      fileName = doc.fileName;
      body = await getStorage().get(doc.storageKey);
    } else {
      return { ok: false, message: "Choose your resume file" };
    }

    const text = await extractResumeText(fileName, body);
    if (!text.ok) return { ok: false, message: text.error };
    const settings = await getUserSettings(user.id);
    const reading = await readResume(text.text, { ai: { provider: settings.aiProvider, model: settings.aiModel } });
    await audit(user.id, "profile.resume_read", { metadata: { method: reading.method, model: reading.model ?? null, removed: reading.removed.length } });
    return { ok: true, data: { ...reading, fileName } };
  });
}

/** Save what the person confirmed on the review page, and optionally keep the file as a resume. */
export async function confirmResumeImportAction(formData: FormData): Promise<ActionResult> {
  return authedAction(async (user) => {
    let raw: unknown;
    try {
      raw = JSON.parse(String(formData.get("payload") ?? ""));
    } catch {
      return { ok: false, message: "Invalid request" };
    }
    const parsed = resumeImportSchema.safeParse(raw);
    if (!parsed.success) return validationFailed(parsed.error);
    const input = parsed.data;

    // Check the file before writing anything, so a bad file doesn't leave a half-done import.
    const file = formData.get("file");
    let upload: { body: Buffer; name: string; extension: string; mimeType: string } | null = null;
    if (input.saveResume && file instanceof File && file.size > 0) {
      const limit = rateLimit(`upload:${user.id}`, LIMITS.upload.limit, LIMITS.upload.windowMs);
      if (!limit.allowed) return { ok: false, message: "Upload limit reached. Uncheck “Save this file” or try again later." };
      const body = Buffer.from(await file.arrayBuffer());
      const check = validateUpload(file.name, body);
      if (!check.ok) return { ok: false, message: check.error };
      upload = { body, name: file.name, ...check };
    }

    const result = await importResumeIntoProfile(user.id, input);
    await audit(user.id, "profile.resume_imported", { entityType: "MasterProfile", metadata: { ...result, savedResume: !!upload } });

    if (upload) {
      const storageKey = buildStorageKey(user.id, "RESUME", upload.extension);
      await getStorage().put(storageKey, upload.body, upload.mimeType);
      try {
        const doc = await createDocument(
          user.id,
          { type: "RESUME", name: upload.name.replace(/\.[^.]+$/, "").slice(0, 150) || "Resume", isDefault: false },
          { fileName: sanitizeFileName(upload.name), mimeType: upload.mimeType, sizeBytes: upload.body.length, storageKey, sha256: sha256Hex(upload.body) },
        );
        await audit(user.id, "document.uploaded", { entityType: "Document", entityId: doc.id, metadata: { type: doc.type, sizeBytes: doc.sizeBytes } });
      } catch (error) {
        await getStorage().delete(storageKey).catch(() => undefined);
        throw error;
      }
      revalidatePath("/documents");
    }

    rescoreInBackground(user.id);
    revalidatePath("/profile");
    revalidatePath("/dashboard");
    revalidatePath("/jobs");
    const parts = [
      result.fieldsUpdated && `${result.fieldsUpdated} detail${result.fieldsUpdated === 1 ? "" : "s"}`,
      result.employmentAdded && `${result.employmentAdded} job${result.employmentAdded === 1 ? "" : "s"}`,
      result.educationAdded && `${result.educationAdded} school${result.educationAdded === 1 ? "" : "s"}`,
      result.skillsAdded && `${result.skillsAdded} skill${result.skillsAdded === 1 ? "" : "s"}`,
    ].filter(Boolean);
    return { ok: true, message: parts.length ? `Added to your profile: ${parts.join(", ")}` : "Nothing new to add" };
  });
}
