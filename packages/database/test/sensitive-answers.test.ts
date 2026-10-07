import { beforeEach, describe, expect, it } from "vitest";
import { manualJobSchema } from "@autoapply/shared";
import { prisma } from "../src/client";
import { isEncrypted } from "../src/crypto";
import { approveQuestionAnswer, queueApplications } from "../src/repositories/applications";
import { createAnswer, encryptSensitiveAnswers, listAnswers } from "../src/repositories/answers";
import { createManualJob } from "../src/repositories/jobs";
import { makeUser, resetDatabase } from "./helpers";

beforeEach(resetDatabase);

async function questionWithAnswer(userId: string, value: string, libraryAnswerId: string | null) {
  const job = await createManualJob(userId, manualJobSchema.parse({ url: `https://example.com/jobs/${Math.random()}`, title: "Role", company: "Acme" }), "GENERIC");
  await queueApplications(userId, [job.id]);
  const app = await prisma.application.findUniqueOrThrow({ where: { jobId: job.id } });
  return prisma.applicationQuestion.create({
    data: { applicationId: app.id, label: "Expected salary", normalizedKey: "expected_salary", status: "NEEDS_REVIEW", answer: { create: { value, source: "USER", confidence: 100, libraryAnswerId } } },
    include: { answer: true },
  });
}

describe("sensitive answers", () => {
  it("encrypts pay, work authorization, sponsorship and military answers when saved", async () => {
    const user = await makeUser();
    for (const [questionKey, category] of [["salary_expectations", "COMPENSATION"], ["work_authorization", "WORK_AUTHORIZATION"], ["sponsorship", "SPONSORSHIP"], ["military_status", "DEMOGRAPHIC"]] as const) {
      await createAnswer(user.id, { questionKey, question: questionKey, answer: "Yes", category, confidence: 100, autoSubmitAllowed: true, requiresHumanReview: false });
    }
    await createAnswer(user.id, { questionKey: "relocation", question: "Relocate?", answer: "No", category: "RELOCATION", confidence: 100, autoSubmitAllowed: true, requiresHumanReview: false });
    const rows = await prisma.applicationAnswer.findMany({ where: { userId: user.id }, orderBy: { questionKey: "asc" } });
    expect(rows.map((r) => [r.questionKey, r.isSensitive, isEncrypted(r.answer)])).toEqual([
      ["military_status", true, true],
      ["relocation", false, false],
      ["salary_expectations", true, true],
      ["sponsorship", true, true],
      ["work_authorization", true, true],
    ]);
    // Read back as plain text for the person.
    expect((await listAnswers(user.id)).every((a) => a.answer === "Yes" || a.answer === "No")).toBe(true);
  });

  it("encrypts existing plain-text answers and the values filled from them, once", async () => {
    const user = await makeUser();
    const salary = await prisma.applicationAnswer.create({ data: { userId: user.id, questionKey: "salary_expectations", question: "Salary?", answer: "$80,000", category: "COMPENSATION", isSensitive: false } });
    const relocation = await prisma.applicationAnswer.create({ data: { userId: user.id, questionKey: "relocation", question: "Relocate?", answer: "No", category: "RELOCATION", isSensitive: false } });
    const filled = await questionWithAnswer(user.id, "$80,000", salary.id);
    const other = await questionWithAnswer(user.id, "No", relocation.id);

    expect(await encryptSensitiveAnswers()).toEqual({ answers: 1, filled: 1 });
    const after = await prisma.applicationAnswer.findUniqueOrThrow({ where: { id: salary.id } });
    expect(after.isSensitive).toBe(true);
    expect(isEncrypted(after.answer)).toBe(true);
    expect(isEncrypted((await prisma.applicationAnswerInstance.findUniqueOrThrow({ where: { id: filled.answer!.id } })).value)).toBe(true);
    expect((await prisma.applicationAnswerInstance.findUniqueOrThrow({ where: { id: other.answer!.id } })).value).toBe("No");
    expect((await listAnswers(user.id)).find((a) => a.id === salary.id)?.answer).toBe("$80,000");
    expect(await encryptSensitiveAnswers()).toEqual({ answers: 0, filled: 0 });
  });

  it("encrypts an approved answer to a recognized sensitive question even without a saved answer", async () => {
    const user = await makeUser();
    const question = await questionWithAnswer(user.id, "", null);
    await approveQuestionAnswer(user.id, question.id, "$90,000", { sensitive: true });
    const value = (await prisma.applicationAnswerInstance.findUniqueOrThrow({ where: { questionId: question.id } })).value;
    expect(isEncrypted(value)).toBe(true);
  });
});
