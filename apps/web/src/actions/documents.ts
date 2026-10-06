"use server";

import { revalidatePath } from "next/cache";
import { audit, createDocument, deleteDocument, setDefaultDocument } from "@autoapply/database";
import { buildStorageKey, getStorage, sanitizeFileName, sha256Hex, validateUpload } from "@autoapply/documents";
import { documentMetaSchema } from "@autoapply/shared";
import { authedAction, formToObject, validationFailed, type ActionResult } from "@/lib/action";
import { LIMITS, rateLimit } from "@/lib/rate-limit";

const ID = /^[a-z0-9]{20,40}$/i;

function refresh() {
  revalidatePath("/documents");
  revalidatePath("/profile");
  revalidatePath("/dashboard");
}

export async function uploadDocumentAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return authedAction(async (user) => {
    const limit = rateLimit(`upload:${user.id}`, LIMITS.upload.limit, LIMITS.upload.windowMs);
    if (!limit.allowed) return { ok: false, message: "Upload limit reached. Try again later." };

    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) return { ok: false, errors: { file: "Choose a file to upload" }, message: "Choose a file to upload" };
    const fields = formToObject(formData);
    delete fields.file;
    const parsed = documentMetaSchema.safeParse({ ...fields, name: fields.name || file.name.replace(/\.[^.]+$/, "") });
    if (!parsed.success) return validationFailed(parsed.error);

    const body = Buffer.from(await file.arrayBuffer());
    const check = validateUpload(file.name, body);
    if (!check.ok) return { ok: false, errors: { file: check.error }, message: check.error };

    const storageKey = buildStorageKey(user.id, parsed.data.type, check.extension);
    await getStorage().put(storageKey, body, check.mimeType);
    try {
      const doc = await createDocument(
        user.id,
        { type: parsed.data.type, name: parsed.data.name, isDefault: parsed.data.isDefault, jobId: parsed.data.jobId },
        { fileName: sanitizeFileName(file.name), mimeType: check.mimeType, sizeBytes: body.length, storageKey, sha256: sha256Hex(body) },
      );
      await audit(user.id, "document.uploaded", { entityType: "Document", entityId: doc.id, metadata: { type: doc.type, sizeBytes: doc.sizeBytes } });
    } catch (error) {
      // Don't leave orphaned bytes in storage if the database write fails.
      await getStorage().delete(storageKey).catch(() => undefined);
      throw error;
    }
    refresh();
    return { ok: true, message: "Document uploaded" };
  });
}

export async function deleteDocumentAction(id: string): Promise<ActionResult> {
  return authedAction(async (user) => {
    if (!ID.test(id)) return { ok: false, message: "Invalid id" };
    const key = await deleteDocument(user.id, id);
    await getStorage().delete(key).catch((error) => console.error("[documents] failed to delete stored file", error));
    await audit(user.id, "document.deleted", { entityType: "Document", entityId: id });
    refresh();
    return { ok: true, message: "Document deleted" };
  });
}

export async function setDefaultDocumentAction(id: string): Promise<ActionResult> {
  return authedAction(async (user) => {
    if (!ID.test(id)) return { ok: false, message: "Invalid id" };
    await setDefaultDocument(user.id, id);
    await audit(user.id, "document.default_set", { entityType: "Document", entityId: id });
    refresh();
    return { ok: true, message: "Default updated" };
  });
}
