import type { AutomationRuleInput, MatchWeights } from "@autoapply/shared";
import { DEFAULT_MATCH_WEIGHTS, MATCH_DIMENSIONS } from "@autoapply/shared";
import { prisma } from "../client";

function readWeights(value: unknown): MatchWeights {
  const source = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  return Object.fromEntries(
    MATCH_DIMENSIONS.map((d) => [d, typeof source[d] === "number" ? (source[d] as number) : DEFAULT_MATCH_WEIGHTS[d]]),
  ) as MatchWeights;
}

export async function getAutomationRule(userId: string) {
  const rule = await prisma.automationRule.upsert({
    where: { userId },
    update: {},
    create: { userId, matchWeights: DEFAULT_MATCH_WEIGHTS },
  });
  return { ...rule, matchWeights: readWeights(rule.matchWeights) };
}
export type AutomationRuleView = Awaited<ReturnType<typeof getAutomationRule>>;

export async function saveAutomationRule(userId: string, input: AutomationRuleInput) {
  const data = { ...input, minSalary: input.minSalary == null ? null : Math.round(input.minSalary) };
  await prisma.automationRule.upsert({ where: { userId }, update: data, create: { userId, ...data } });
}
