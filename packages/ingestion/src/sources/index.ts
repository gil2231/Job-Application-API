import type { JobSourceAdapter } from "../types";
import { fileImportSource } from "./file";
import { jobBoardSearchSource } from "./job-boards";
import { urlListSource } from "./url-list";

export { fileImportSource, ImportFileError, type FileInput } from "./file";
export { urlListSource, extractUrls, companyFromUrl } from "./url-list";
export {
  jobBoardSearchSource,
  searchJobBoards,
  parseBoardRef,
  parseBoardList,
  boardKey,
  boardUrl,
  BoardSearchError,
  BOARD_PROVIDERS,
  BOARD_PROVIDER_LABELS,
  MAX_BOARDS_PER_SEARCH,
  MAX_BOARD_RESULTS,
  type BoardRef,
  type BoardProvider,
  type BoardSearchInput,
  type BoardSearchHit,
  type BoardSearchResult,
} from "./job-boards";

/** Every registered job source. Add new sources here; the pipeline and UI work with any of them. */
export const JOB_SOURCES = {
  file: fileImportSource,
  urls: urlListSource,
  jobBoards: jobBoardSearchSource,
} satisfies Record<string, JobSourceAdapter<never>>;
