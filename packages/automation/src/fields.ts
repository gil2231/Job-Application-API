import type { ProfileFieldKey } from "@autoapply/shared";

/** Selector strategies, in the order the worker prefers them. Never screen coordinates. */
export const LOCATOR_STRATEGIES = ["label", "name", "id", "aria", "dom"] as const;
export type LocatorStrategy = (typeof LOCATOR_STRATEGIES)[number];

export interface FieldLocator {
  strategy: LocatorStrategy;
  value: string;
}

export type FieldKind = "text" | "textarea" | "email" | "phone" | "url" | "number" | "date" | "select" | "radio" | "checkbox" | "file" | "unknown";

/** A form field as detected on an application page. */
export interface DetectedField {
  label: string;
  kind: FieldKind;
  required: boolean;
  options?: string[];
  pageIndex: number;
  /** Candidate locators, best first. */
  locators: FieldLocator[];
}

/** The result of mapping one detected field onto the Master Profile schema. */
export interface FieldMapping {
  field: DetectedField;
  detectedLabel: string;
  mappedField: ProfileFieldKey;
  value: string | null;
  /** 0..100 */
  confidence: number;
  source: "profile" | "library" | "ai" | "user";
}

/** Sort locators by the preferred strategy order. */
export function orderLocators(locators: FieldLocator[]): FieldLocator[] {
  return [...locators].sort((a, b) => LOCATOR_STRATEGIES.indexOf(a.strategy) - LOCATOR_STRATEGIES.indexOf(b.strategy));
}

/** Whether a mapping must go to a human before it is used. */
export function requiresReview(mapping: FieldMapping, thresholdPercent: number): boolean {
  if (mapping.mappedField === "unknown") return true;
  if (mapping.field.required && (mapping.value == null || mapping.value === "")) return true;
  return mapping.confidence < thresholdPercent;
}
