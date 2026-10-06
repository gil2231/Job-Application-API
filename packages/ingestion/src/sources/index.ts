import type { JobSourceAdapter } from "../types";
import { fileImportSource } from "./file";
import { urlListSource } from "./url-list";

export { fileImportSource, ImportFileError, type FileInput } from "./file";
export { urlListSource, extractUrls, companyFromUrl } from "./url-list";

/** Every registered job source. Add new sources here; the pipeline and UI work with any of them. */
export const JOB_SOURCES = {
  file: fileImportSource,
  urls: urlListSource,
} satisfies Record<string, JobSourceAdapter<never>>;
