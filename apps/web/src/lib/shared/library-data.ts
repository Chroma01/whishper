import type {
  JobState,
  LibraryUploadStatus,
  ProbeState,
  RunStatus,
} from "./project-status";
import type { TextSegment } from "./search-query";

export const LIBRARY_STATUSES = ["ready", "active", "attention"] as const;
export type LibraryStatus = (typeof LIBRARY_STATUSES)[number];

export const LIBRARY_ADDED = ["week", "month", "year"] as const;
export type LibraryAdded = (typeof LIBRARY_ADDED)[number];

export const LIBRARY_SORTS = [
  "relevance",
  "activity",
  "added",
  "name",
] as const;
export type LibrarySort = (typeof LIBRARY_SORTS)[number];

export type LibrarySearch = {
  query: string;
  language: string | null;
  status: LibraryStatus | null;
  added: LibraryAdded | null;
  // Relevance only applies while there is a query.
  sort: LibrarySort;
};

export type TranscriptHit = {
  cueId: string;
  trackId: string;
  language: string;
  startUs: number;
  segments: TextSegment[];
};

export type ProjectMatch = {
  nameSegments: TextSegment[] | null;
  hitCount: number;
  languages: { language: string; count: number }[];
  // The first hits in time order, up to a limit.
  hits: TranscriptHit[];
};

export type WorkspaceSummary = {
  id: string;
  name: string;
  projectCount: number;
  readySourceCount: number;
};

export type ProjectSummary = {
  id: string;
  name: string;
  createdAt: Date;
  activityAt: Date;
  runStatus: RunStatus | null;
  jobState: JobState | null;
  progress: number | null;
  progressMessage: string | null;
  uploadStatus: LibraryUploadStatus | null;
  originalFilename: string | null;
  sizeBytes: number | null;
  receivedBytes: number | null;
  mediaDurationUs: number | null;
  mediaPreparationStatus: ProbeState;
  mediaType: string | null;
  hasThumbnail: boolean;
  languages: string[];
  // Null when there is no query.
  match: ProjectMatch | null;
};

// What changes while a project processes, polled without running the search
// again.
export type LibraryProjectStatus = Pick<
  ProjectSummary,
  | "id"
  | "runStatus"
  | "jobState"
  | "progress"
  | "progressMessage"
  | "uploadStatus"
  | "receivedBytes"
  | "sizeBytes"
  | "mediaPreparationStatus"
  | "mediaDurationUs"
  | "hasThumbnail"
>;

export type LibraryResults = {
  projects: ProjectSummary[];
  // How many projects the query matches with no filters, for the no-results
  // state.
  unfilteredCount: number;
  // A query of only excluded words has nothing to look for.
  needsTerm: boolean;
};

export type LibraryData = LibraryResults & {
  workspace: WorkspaceSummary | null;
  search: LibrarySearch;
  // Every transcript language in the workspace, for the language filter.
  languages: string[];
};
