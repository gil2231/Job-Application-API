import type { ProfileFieldKey } from "@autoapply/shared";

/** Selector strategies, in the order the worker prefers them. Never screen coordinates. */
export const LOCATOR_STRATEGIES = ["label", "name", "id", "aria", "dom"] as const;
export type LocatorStrategy = (typeof LOCATOR_STRATEGIES)[number];

export interface FieldLocator {
  strategy: LocatorStrategy;
  value: string;
}

export type FieldKind = "text" | "textarea" | "email" | "phone" | "url" | "number" | "date" | "select" | "radio" | "checkbox" | "file" | "unknown";

/** Attributes read from the element, used as extra mapping signals. */
export interface FieldHints {
  name?: string;
  id?: string;
  placeholder?: string;
  /** The HTML autocomplete token (e.g. "given-name", "tel"), a strong signal when present. */
  autocomplete?: string;
  inputType?: string;
  accept?: string;
  /**
   * How the control is operated when it isn't a native element: a typeahead
   * dropdown (combobox), a button that opens a list (listbox), a row of answer
   * buttons, or a text box that suggests values as you type (autocomplete).
   */
  widget?: "native" | "combobox" | "listbox" | "buttons" | "autocomplete";
}

/** A form field as detected on an application page. */
export interface DetectedField {
  label: string;
  kind: FieldKind;
  required: boolean;
  options?: string[];
  /** The value attribute behind each option, in the same order (radios and checkboxes). */
  optionValues?: string[];
  /** Checkbox groups that allow several answers. */
  multiple?: boolean;
  pageIndex: number;
  /** Candidate locators, best first. */
  locators: FieldLocator[];
  hints?: FieldHints;
  /** Stable per-page key (normalized label, de-duplicated). */
  key?: string;
}

export type MappingStatus = "ANSWERED" | "NEEDS_REVIEW" | "SKIPPED";

/**
 * The result of mapping one detected field onto the Master Profile schema:
 * detected label, mapped field, value and confidence, plus what to do with it.
 */
export interface FieldMapping {
  field: DetectedField;
  detectedLabel: string;
  mappedField: ProfileFieldKey;
  /** Text to type, the option to pick, or for checkbox groups the options to tick. */
  value: string | string[] | null;
  /** 0..100 */
  confidence: number;
  source: "profile" | "library" | "ai" | "user" | "none";
  /** ANSWERED: fill it. NEEDS_REVIEW: a person must confirm it. SKIPPED: leave it blank. */
  status: MappingStatus;
  /** Why a person needs to look at it. */
  reviewReason?: string;
  /** Standard question this matched, when it came from the Answer Library. */
  questionKey?: string;
  libraryAnswerId?: string;
  sensitive?: boolean;
  /** False when the value came from an answer the user didn't allow to be submitted unattended. */
  autoSubmitAllowed: boolean;
}

/** Sort locators by the preferred strategy order. */
export function orderLocators(locators: FieldLocator[]): FieldLocator[] {
  return [...locators].sort((a, b) => LOCATOR_STRATEGIES.indexOf(a.strategy) - LOCATOR_STRATEGIES.indexOf(b.strategy));
}

const isEmpty = (value: FieldMapping["value"]) => value == null || value === "" || (Array.isArray(value) && value.length === 0);

/** Whether a mapping must go to a human before it is used. */
export function requiresReview(mapping: Pick<FieldMapping, "mappedField" | "field" | "value" | "confidence" | "source">, thresholdPercent: number): boolean {
  if (mapping.source === "user") return false;
  if (mapping.mappedField === "unknown") return mapping.field.required || !isEmpty(mapping.value);
  if (mapping.field.required && isEmpty(mapping.value)) return true;
  return mapping.confidence < thresholdPercent;
}
