"use server";

import { revalidatePath } from "next/cache";
import { NotFoundError, setSupportRequestStatus } from "@autoapply/database";
import type { ActionResult } from "@/lib/action";
import { requireAdmin } from "@/lib/auth";
import { getRequestContext } from "@/lib/request";

const ID = /^[a-z0-9]{20,40}$/i;

/** Resolve or reopen a "Report a problem" message. Admins only. */
export async function setReportStatusAction(id: string, resolved: boolean): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!ID.test(id)) return { ok: false, message: "Invalid id" };
  try {
    await setSupportRequestStatus(admin.id, id, resolved ? "RESOLVED" : "OPEN", await getRequestContext());
  } catch (error) {
    if (error instanceof NotFoundError) return { ok: false, message: error.message };
    throw error;
  }
  revalidatePath("/admin/reports");
  revalidatePath("/admin");
  return { ok: true, message: resolved ? "Marked resolved" : "Reopened" };
}
