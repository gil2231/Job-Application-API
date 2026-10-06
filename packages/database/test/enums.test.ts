import { describe, expect, it } from "vitest";
import { $Enums } from "@prisma/client";
import * as shared from "@autoapply/shared";

const pairs: Array<[string, Record<string, string>, readonly string[]]> = [
  ["JobStatus", $Enums.JobStatus, shared.JOB_STATUSES],
  ["ApplicationStatus", $Enums.ApplicationStatus, shared.APPLICATION_STATUSES],
  ["ApplicationOutcome", $Enums.ApplicationOutcome, shared.APPLICATION_OUTCOMES],
  ["AutomationMode", $Enums.AutomationMode, shared.AUTOMATION_MODES],
  ["Platform", $Enums.Platform, shared.PLATFORMS],
  ["FailureType", $Enums.FailureType, shared.FAILURE_TYPES],
  ["AttentionReason", $Enums.AttentionReason, shared.ATTENTION_REASONS],
  ["WorkArrangement", $Enums.WorkArrangement, shared.WORK_ARRANGEMENTS],
  ["EmploymentType", $Enums.EmploymentType, shared.EMPLOYMENT_TYPES],
  ["SkillCategory", $Enums.SkillCategory, shared.SKILL_CATEGORIES],
  ["DocumentType", $Enums.DocumentType, shared.DOCUMENT_TYPES],
  ["AnswerCategory", $Enums.AnswerCategory, shared.ANSWER_CATEGORIES],
  ["AnswerSource", $Enums.AnswerSource, shared.ANSWER_SOURCES],
  ["JobSourceType", $Enums.JobSourceType, shared.JOB_SOURCE_TYPES],
  ["ApplicationEventType", $Enums.ApplicationEventType, shared.APPLICATION_EVENT_TYPES],
  ["EventLevel", $Enums.EventLevel, shared.EVENT_LEVELS],
  ["InterviewKind", $Enums.InterviewKind, shared.INTERVIEW_KINDS],
  ["InterviewStatus", $Enums.InterviewStatus, shared.INTERVIEW_STATUSES],
  ["SupportCategory", $Enums.SupportCategory, shared.SUPPORT_CATEGORIES],
  ["SupportStatus", $Enums.SupportStatus, shared.SUPPORT_STATUSES],
];

describe("shared enums mirror the Prisma schema", () => {
  it.each(pairs)("%s", (_name, prismaEnum, sharedValues) => {
    expect([...sharedValues].sort()).toEqual(Object.values(prismaEnum).sort());
  });
});
