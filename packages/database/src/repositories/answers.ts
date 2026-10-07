import type { AnswerInput, AnswerSource } from "@autoapply/shared";
import { deriveAnswerFromProfile, normalizeQuestionKey, SENSITIVE_ANSWER_CATEGORIES, STANDARD_QUESTIONS } from "@autoapply/shared";
import { prisma } from "../client";
import { decryptString, encryptString, isEncrypted } from "../crypto";
import { isUniqueViolation, NotFoundError, ConflictError } from "./errors";
import { getFullProfile } from "./profile";

export async function listAnswers(userId: string) {
  const rows = await prisma.applicationAnswer.findMany({
    where: { userId },
    orderBy: [{ category: "asc" }, { question: "asc" }],
  });
  return rows.map((r) => ({ ...r, answer: r.isSensitive ? decryptString(r.answer) : r.answer }));
}
export type AnswerListItem = Awaited<ReturnType<typeof listAnswers>>[number];

function toData(input: AnswerInput, source: AnswerSource) {
  const isSensitive = SENSITIVE_ANSWER_CATEGORIES.includes(input.category);
  const questionKey = input.questionKey || normalizeQuestionKey(input.question);
  // An empty answer can never be auto-submitted and always needs a human.
  const empty = input.answer.trim() === "";
  return {
    questionKey,
    question: input.question,
    answer: isSensitive && !empty ? encryptString(input.answer) : input.answer,
    category: input.category,
    source,
    confidence: Math.round(input.confidence),
    autoSubmitAllowed: empty ? false : input.autoSubmitAllowed,
    requiresHumanReview: empty ? true : input.requiresHumanReview,
    isSensitive,
  };
}

export async function createAnswer(userId: string, input: AnswerInput, source: AnswerSource = "USER") {
  try {
    return await prisma.applicationAnswer.create({ data: { userId, ...toData(input, source) } });
  } catch (error) {
    if (isUniqueViolation(error)) throw new ConflictError("You already have an answer for this question");
    throw error;
  }
}

export async function updateAnswer(userId: string, id: string, input: AnswerInput) {
  const existing = await prisma.applicationAnswer.findFirst({ where: { id, userId }, select: { questionKey: true } });
  if (!existing) throw new NotFoundError("Answer");
  try {
    await prisma.applicationAnswer.update({
      where: { id },
      data: { ...toData({ ...input, questionKey: input.questionKey ?? existing.questionKey }, "USER") },
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new ConflictError("You already have an answer for this question");
    throw error;
  }
}

export async function deleteAnswer(userId: string, id: string) {
  const { count } = await prisma.applicationAnswer.deleteMany({ where: { id, userId } });
  if (count === 0) throw new NotFoundError("Answer");
}

/**
 * Standard questions the user has not answered yet. Where the Master Profile
 * states the fact, a suggested answer is attached; otherwise it is flagged as
 * needing the user's input.
 */
export async function getAnswerSuggestions(userId: string) {
  const [existing, profile] = await Promise.all([
    prisma.applicationAnswer.findMany({ where: { userId }, select: { questionKey: true } }),
    getFullProfile(userId),
  ]);
  const answered = new Set(existing.map((e) => e.questionKey));
  return STANDARD_QUESTIONS.filter((q) => !answered.has(q.key)).map((q) => ({
    ...q,
    derived: deriveAnswerFromProfile(q.key, {
      linkedinUrl: profile.linkedinUrl,
      portfolioUrl: profile.portfolioUrl,
      websiteUrl: profile.websiteUrl,
      yearsExperience: profile.yearsExperience,
      employment: profile.employment,
    }),
  }));
}
export type AnswerSuggestion = Awaited<ReturnType<typeof getAnswerSuggestions>>[number];

/**
 * Save an answer the user approved on an application to their Answer Library,
 * so the same question is answered without asking next time. The user chose
 * to remember it, so it may be submitted without another review.
 */
export async function rememberApprovedAnswer(userId: string, questionId: string, questionKey: string) {
  const question = await prisma.applicationQuestion.findFirst({
    where: { id: questionId, application: { userId }, status: "APPROVED" },
    select: { label: true, fieldType: true, answer: { select: { value: true } } },
  });
  if (!question?.answer || question.fieldType === "FILE") return false;
  await rememberAnswer(userId, { questionKey, question: question.label, answer: decryptString(question.answer.value) });
  return true;
}

export async function rememberAnswer(userId: string, input: { questionKey: string; question: string; answer: string }) {
  const standard = STANDARD_QUESTIONS.find((q) => q.key === input.questionKey);
  const category = standard?.category ?? "OTHER";
  const isSensitive = SENSITIVE_ANSWER_CATEGORIES.includes(category);
  const answer = isSensitive ? encryptString(input.answer) : input.answer;
  await prisma.applicationAnswer.upsert({
    where: { userId_questionKey: { userId, questionKey: input.questionKey } },
    update: { answer, source: "USER", confidence: 100, autoSubmitAllowed: true, requiresHumanReview: false, isSensitive },
    create: {
      userId,
      questionKey: input.questionKey,
      question: (standard?.question ?? input.question).slice(0, 500),
      answer,
      category,
      source: "USER",
      confidence: 100,
      autoSubmitAllowed: true,
      requiresHumanReview: false,
      isSensitive,
    },
  });
}

/**
 * Bring stored answers in line with SENSITIVE_ANSWER_CATEGORIES after the
 * list grows (pay, work authorization and sponsorship joined it in Phase 6):
 * saved answers in those categories are encrypted and flagged, and so are the
 * values already filled from them on applications. Encryption needs the app's
 * key, so this runs from the worker (at start-up and in its retention sweep)
 * rather than as a SQL migration. Idempotent and safe to run concurrently.
 */
export async function encryptSensitiveAnswers(batch = 200): Promise<{ answers: number; filled: number }> {
  let answers = 0;
  for (;;) {
    const rows = await prisma.applicationAnswer.findMany({ where: { category: { in: [...SENSITIVE_ANSWER_CATEGORIES] }, isSensitive: false }, select: { id: true, answer: true }, take: batch });
    if (!rows.length) break;
    for (const r of rows) {
      const answer = r.answer.trim() && !isEncrypted(r.answer) ? encryptString(r.answer) : r.answer;
      const { count } = await prisma.applicationAnswer.updateMany({ where: { id: r.id, isSensitive: false, answer: r.answer }, data: { answer, isSensitive: true } });
      answers += count;
    }
    if (rows.length < batch) break;
  }
  let filled = 0;
  for (;;) {
    const rows = await prisma.applicationAnswerInstance.findMany({ where: { libraryAnswer: { isSensitive: true }, NOT: { value: { startsWith: "enc:v1:" } } }, select: { id: true, value: true }, take: batch });
    if (!rows.length) break;
    for (const r of rows) {
      const { count } = await prisma.applicationAnswerInstance.updateMany({ where: { id: r.id, value: r.value }, data: { value: encryptString(r.value) } });
      filled += count;
    }
    if (rows.length < batch) break;
  }
  return { answers, filled };
}
