"use server";

import { revalidatePath } from "next/cache";
import { audit, createExtensionPairingCode, revokeExtensionConnection } from "@autoapply/database";
import { authedAction, type ActionResult } from "@/lib/action";

/** A one-time code the person types into the browser extension to connect it to this account. */
export async function createExtensionCodeAction(): Promise<ActionResult<{ code: string; expiresAt: string }>> {
  return authedAction(async (user) => {
    const { code, expiresAt } = await createExtensionPairingCode(user.id);
    await audit(user.id, "extension.code_created");
    return { ok: true, data: { code, expiresAt: expiresAt.toISOString() } };
  });
}

export async function disconnectExtensionAction(id: string): Promise<ActionResult> {
  return authedAction(async (user) => {
    if (typeof id !== "string" || !/^[a-z0-9]{20,40}$/i.test(id) || !(await revokeExtensionConnection(user.id, id))) return { ok: false, message: "Extension not found" };
    await audit(user.id, "extension.disconnected", { entityType: "ExtensionConnection", entityId: id });
    revalidatePath("/settings");
    return { ok: true, message: "Extension disconnected. It will ask for a new code." };
  });
}
