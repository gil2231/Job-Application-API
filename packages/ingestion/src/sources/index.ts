import type { JobSourceAdapter } from "../types";
import { fileImportSource } from "./file";
import { browserPageSource } from "./browser-page";
import { foundJobsSource } from "./found-jobs";
import { jobBoardSearchSource } from "./job-boards";
export { searchEverywhere, type WideSearchInput, type WideSearchHit, type WideSearchResult } from "./wide-search";
export { searchAggregator, AGGREGATOR_NAME, AggregatorError, type AggregatorHit } from "./aggregator";
export { DIRECTORY_BOARDS } from "./board-directory";
export { foundJobsSource, type FoundJob } from "./found-jobs";
import { urlListSource } from "./url-list";

export { fileImportSource, ImportFileError, type FileInput } from "./file";
export { urlListSource, extractUrls, companyFromUrl } from "./url-list";
export { browserPageSource, isLinkedInUrl, type CapturedPage } from "./browser-page";
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
  BOARD_PROVIDER_LIST,
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
  foundJobs: foundJobsSource,
  extension: browserPageSource,
} satisfies Record<string, JobSourceAdapter<never>>;
