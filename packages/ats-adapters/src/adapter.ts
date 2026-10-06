import type { DetectedField, FieldMapping } from "@autoapply/automation";
import type { AutomationMode, FailureType, Platform } from "@autoapply/shared";

/**
 * What an adapter receives from the worker. The browser page type is left
 * generic so this package does not depend on Playwright; the worker binds it.
 */
export interface AdapterContext<TPage = unknown> {
  page: TPage;
  applicationId: string;
  mode: AutomationMode;
  /** Field-mapping confidence threshold (0-100) from the user's settings. */
  confidenceThreshold: number;
  /** Record a timeline event. */
  log(event: { type: string; message: string; level?: "INFO" | "WARNING" | "ERROR"; data?: unknown }): Promise<void>;
  /** Save a screenshot and return its storage key. */
  screenshot(caption: string): Promise<string>;
}

export interface ValidationResult {
  ok: boolean;
  errors: Array<{ label: string; message: string }>;
}

export type AdapterStatus =
  | { state: "in_progress"; page: number; totalPages?: number }
  | { state: "needs_human"; reason: "CAPTCHA" | "MFA" | "AUTH_REQUIRED" | "QUESTION_REVIEW" | "FINAL_REVIEW"; detail: string }
  | { state: "submitted"; confirmation?: string }
  | { state: "failed"; failure: FailureType; message: string };

export interface DocumentsToUpload {
  resume?: { path: string; fileName: string };
  coverLetter?: { path: string; fileName: string };
}

/**
 * Contract every ATS integration implements. The worker drives these steps in
 * order; adapters never decide on their own to bypass a CAPTCHA, MFA or other
 * security control — they report needs_human instead.
 */
export interface ApplicationAdapter<TPage = unknown> {
  readonly platform: Platform;
  readonly displayName: string;
  /** Return 0-100 confidence that this adapter handles the page. */
  detect(url: string, html?: string): number | Promise<number>;
  initialize(ctx: AdapterContext<TPage>): Promise<void>;
  mapFields(ctx: AdapterContext<TPage>): Promise<{ fields: DetectedField[]; mappings: FieldMapping[] }>;
  fillFields(ctx: AdapterContext<TPage>, mappings: FieldMapping[]): Promise<void>;
  uploadDocuments(ctx: AdapterContext<TPage>, documents: DocumentsToUpload): Promise<void>;
  answerQuestions(ctx: AdapterContext<TPage>, mappings: FieldMapping[]): Promise<void>;
  validate(ctx: AdapterContext<TPage>): Promise<ValidationResult>;
  /** Only called when the mode and the safety checks permit submission. */
  submit(ctx: AdapterContext<TPage>): Promise<{ confirmation?: string }>;
  getStatus(ctx: AdapterContext<TPage>): Promise<AdapterStatus>;
  handleFailure(ctx: AdapterContext<TPage>, error: unknown): Promise<AdapterStatus>;
}
