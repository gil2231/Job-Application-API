import type { DetectedField, FieldMapping } from "@autoapply/automation";
import type { AutomationMode, FailureType, Platform } from "@autoapply/shared";

/**
 * What an adapter receives from the worker. The browser page type is left
 * generic so this package's contract doesn't depend on Playwright; the worker
 * binds it to a Playwright Page.
 */
export interface AdapterContext<TPage = unknown> {
  page: TPage;
  applicationId: string;
  mode: AutomationMode;
  /** Field-mapping confidence threshold (0-100) from the user's settings. */
  confidenceThreshold: number;
  /** Index of the form page being filled (0 for the first). */
  pageIndex: number;
  /** Aborted when the user stops the queue; adapters should stop promptly. */
  signal: AbortSignal;
  /**
   * Turn a detected field into a value from the Master Profile, Answer Library
   * or the user's approved answers. Adapters never invent values themselves.
   */
  resolveField(field: DetectedField): Promise<FieldMapping>;
  /** Record a timeline event. */
  log(event: { type: string; message: string; level?: "INFO" | "WARNING" | "ERROR"; data?: unknown }): Promise<void>;
  /** Save a screenshot and return its storage key. */
  screenshot(caption: string): Promise<string>;
}

export interface ValidationResult {
  ok: boolean;
  errors: Array<{ label: string; message: string }>;
}

export type HumanStep = "CAPTCHA" | "MFA" | "AUTH_REQUIRED";

export type AdapterStatus =
  | {
      state: "in_progress";
      page: number;
      isFinalPage: boolean;
      hasForm: boolean;
      /** The site scores submissions in the background (invisible reCAPTCHA), so the final Submit is always the person's own click. */
      humanSubmitOnly?: boolean;
    }
  | { state: "needs_human"; reason: HumanStep; detail: string }
  | { state: "submitted"; confirmation?: string }
  | { state: "failed"; failure: FailureType; message: string };

export interface DocumentsToUpload {
  resume?: { path: string; fileName: string };
  coverLetter?: { path: string; fileName: string };
}

export type PageAdvance = { moved: true } | { moved: false; validation: ValidationResult };

/**
 * Contract every ATS integration implements. The worker drives these steps
 * page by page; adapters never decide on their own to bypass a CAPTCHA, MFA or
 * other security control. They report needs_human instead.
 */
export interface ApplicationAdapter<TPage = unknown> {
  readonly platform: Platform;
  readonly displayName: string;
  /** Whether this adapter may submit without a person watching (Auto mode), subject to every other safety check. */
  readonly supportsAutoSubmit: boolean;
  /** Return 0-100 confidence that this adapter handles the page. */
  detect(url: string, html?: string): number | Promise<number>;
  /** Get from the landing page to the first page of the form (e.g. past an "Apply" button). */
  initialize(ctx: AdapterContext<TPage>): Promise<void>;
  /** Detect the fields on the current page and resolve a value for each. */
  mapFields(ctx: AdapterContext<TPage>): Promise<{ fields: DetectedField[]; mappings: FieldMapping[] }>;
  /** Fill fields mapped to the Master Profile. */
  fillFields(ctx: AdapterContext<TPage>, mappings: FieldMapping[]): Promise<void>;
  uploadDocuments(ctx: AdapterContext<TPage>, documents: DocumentsToUpload, mappings: FieldMapping[]): Promise<void>;
  /** Fill application questions answered from the Answer Library or by the user. */
  answerQuestions(ctx: AdapterContext<TPage>, mappings: FieldMapping[]): Promise<void>;
  /** Check the current page for invalid or missing values without submitting it. */
  validate(ctx: AdapterContext<TPage>): Promise<ValidationResult>;
  /** Go to the next page of a multi-page form. */
  nextPage(ctx: AdapterContext<TPage>): Promise<PageAdvance>;
  /** Only called when the mode and the safety checks permit submission. */
  submit(ctx: AdapterContext<TPage>): Promise<{ confirmation?: string } | { validation: ValidationResult }>;
  /** Where the application stands: a security check, a confirmation page, or which form page. */
  getStatus(ctx: AdapterContext<TPage>): Promise<AdapterStatus>;
  handleFailure(ctx: AdapterContext<TPage>, error: unknown): Promise<AdapterStatus>;
}
