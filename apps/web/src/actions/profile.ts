"use server";

import { revalidatePath } from "next/cache";
import {
  audit,
  createEducation,
  createEmployment,
  deleteEducation,
  deleteEmployment,
  updateEducation,
  updateEmployment,
  updatePersonal,
  updateProfessional,
} from "@autoapply/database";
import { educationSchema, employmentSchema, personalSchema, professionalSchema } from "@autoapply/shared";
import { authedAction, formToObject, validationFailed, type ActionResult } from "@/lib/action";

const ID = /^[a-z0-9]{20,40}$/i;

function done(message: string): ActionResult {
  revalidatePath("/profile");
  revalidatePath("/dashboard");
  return { ok: true, message };
}

export async function savePersonalAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return authedAction(async (user) => {
    const parsed = personalSchema.safeParse(formToObject(formData));
    if (!parsed.success) return validationFailed(parsed.error);
    await updatePersonal(user.id, parsed.data);
    await audit(user.id, "profile.personal_updated", { entityType: "MasterProfile" });
    return done("Personal details saved");
  });
}

export async function saveProfessionalAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return authedAction(async (user) => {
    const parsed = professionalSchema.safeParse(formToObject(formData));
    if (!parsed.success) return validationFailed(parsed.error);
    await updateProfessional(user.id, parsed.data);
    await audit(user.id, "profile.professional_updated", { entityType: "MasterProfile" });
    return done("Professional details saved");
  });
}

export async function saveEducationAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return authedAction(async (user) => {
    const id = formData.get("id");
    const parsed = educationSchema.safeParse(formToObject(formData));
    if (!parsed.success) return validationFailed(parsed.error);
    if (typeof id === "string" && ID.test(id)) {
      await updateEducation(user.id, id, parsed.data);
      await audit(user.id, "profile.education_updated", { entityType: "Education", entityId: id });
    } else {
      const created = await createEducation(user.id, parsed.data);
      await audit(user.id, "profile.education_added", { entityType: "Education", entityId: created.id });
    }
    return done("Education saved");
  });
}

export async function deleteEducationAction(id: string): Promise<ActionResult> {
  return authedAction(async (user) => {
    if (!ID.test(id)) return { ok: false, message: "Invalid id" };
    await deleteEducation(user.id, id);
    await audit(user.id, "profile.education_deleted", { entityType: "Education", entityId: id });
    return done("Education removed");
  });
}

export async function saveEmploymentAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return authedAction(async (user) => {
    const id = formData.get("id");
    const parsed = employmentSchema.safeParse(formToObject(formData));
    if (!parsed.success) return validationFailed(parsed.error);
    if (typeof id === "string" && ID.test(id)) {
      await updateEmployment(user.id, id, parsed.data);
      await audit(user.id, "profile.employment_updated", { entityType: "Employment", entityId: id });
    } else {
      const created = await createEmployment(user.id, parsed.data);
      await audit(user.id, "profile.employment_added", { entityType: "Employment", entityId: created.id });
    }
    return done("Employment saved");
  });
}

export async function deleteEmploymentAction(id: string): Promise<ActionResult> {
  return authedAction(async (user) => {
    if (!ID.test(id)) return { ok: false, message: "Invalid id" };
    await deleteEmployment(user.id, id);
    await audit(user.id, "profile.employment_deleted", { entityType: "Employment", entityId: id });
    return done("Employment removed");
  });
}
