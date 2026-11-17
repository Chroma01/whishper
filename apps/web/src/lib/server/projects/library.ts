import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";

import type { Executor } from "#lib/server/db/index.ts";
import {
  jobs,
  mediaDerivatives,
  mediaUploads,
  memberships,
  projects,
  subtitleTracks,
  transcriptionRuns,
  workspaces,
} from "#lib/server/db/schema.ts";
import { projectForUser } from "#lib/server/projects/access.ts";
import { IDLE_BEFORE_RETRY_MS } from "#lib/server/uploads/maintenance.ts";
import { truncateText } from "#lib/shared/format.ts";
import {
  LIBRARY_ADDED,
  LIBRARY_SORTS,
  LIBRARY_STATUSES,
  type LibraryAdded,
  type LibraryProjectStatus,
  type LibraryResults,
  type LibrarySearch,
  type ProjectSummary,
  type WorkspaceSummary,
} from "#lib/shared/library-data.ts";
import { LANGUAGE_TAG } from "#lib/shared/languages.ts";
import {
  PROJECT_SEARCH_MAX_LENGTH,
  PROJECT_TITLE_MAX_LENGTH,
} from "#lib/shared/limits.ts";
import {
  libraryStatus,
  type LibraryUploadStatus,
  type RunStatus,
  type UploadStatus,
} from "#lib/shared/project-status.ts";
import {
  highlightQuery,
  isEmptyQuery,
  matchesQuery,
  parseSearchQuery,
  searchesTranscripts,
  type SearchQuery,
} from "#lib/shared/search-query.ts";
import {
  projectLanguages,
  searchTranscripts,
  type TranscriptMatches,
} from "./library-search";

const DAY_MS = 24 * 60 * 60 * 1000;
const ADDED_WITHIN_DAYS: Record<LibraryAdded, number> = {
  week: 7,
  month: 30,
  year: 365,
};

function oneOf<T extends string>(
  values: readonly T[],
  value: string | null,
): T | null {
  return values.find((candidate) => candidate === value) ?? null;
}

export function parseProjectLibrarySearch(
  searchParams: URLSearchParams,
): LibrarySearch {
  const query = truncateText(
    (searchParams.get("q") ?? "").trim(),
    PROJECT_SEARCH_MAX_LENGTH,
  );
  const language = searchParams.get("language");
  const sort = oneOf(LIBRARY_SORTS, searchParams.get("sort"));
  return {
    query,
    language: language && LANGUAGE_TAG.test(language) ? language : null,
    status: oneOf(LIBRARY_STATUSES, searchParams.get("status")),
    added: oneOf(LIBRARY_ADDED, searchParams.get("added")),
    sort: sort ?? (query ? "relevance" : "activity"),
  };
}

export function normalizeProjectTitle(
  value: FormDataEntryValue | null,
): string {
  const title = String(value ?? "")
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return truncateText(title, PROJECT_TITLE_MAX_LENGTH);
}

export function primaryWorkspaceForUser(
  executor: Executor,
  userId: string,
): WorkspaceSummary | null {
  const workspace = executor
    .select({
      id: workspaces.id,
      name: workspaces.name,
      projectCount: sql<number>`count(distinct ${projects.id})`,
      readySourceCount: sql<number>`count(distinct case when ${mediaUploads.status} = 'completed' then ${projects.id} end)`,
    })
    .from(workspaces)
    .innerJoin(memberships, eq(memberships.workspaceId, workspaces.id))
    .leftJoin(projects, eq(projects.workspaceId, workspaces.id))
    .leftJoin(mediaUploads, eq(mediaUploads.projectId, projects.id))
    .where(eq(memberships.userId, userId))
    .groupBy(workspaces.id)
    .orderBy(asc(workspaces.createdAt))
    .limit(1)
    .get();
  return workspace ?? null;
}

function latestSubtitleEdits(
  executor: Executor,
  workspaceId: string,
): Map<string, Date> {
  const rows = executor
    .select({
      projectId: subtitleTracks.projectId,
      updatedAt: sql<number>`max(${subtitleTracks.updatedAt})`,
    })
    .from(subtitleTracks)
    .innerJoin(projects, eq(projects.id, subtitleTracks.projectId))
    .where(eq(projects.workspaceId, workspaceId))
    .groupBy(subtitleTracks.projectId)
    .all();
  return new Map(rows.map((row) => [row.projectId, new Date(row.updatedAt)]));
}

type RunProgress = Pick<
  ProjectSummary,
  "runStatus" | "jobState" | "progress" | "progressMessage"
>;

function latestRunProgress(
  executor: Executor,
  projectIds: string[],
): Map<string, RunProgress> {
  const latestRuns = new Map<string, { id: string; status: RunStatus }>();
  for (const run of executor
    .select({
      id: transcriptionRuns.id,
      projectId: transcriptionRuns.projectId,
      status: transcriptionRuns.status,
    })
    .from(transcriptionRuns)
    .where(inArray(transcriptionRuns.projectId, projectIds))
    .orderBy(desc(transcriptionRuns.createdAt), desc(sql`rowid`))
    .all()) {
    if (!latestRuns.has(run.projectId)) latestRuns.set(run.projectId, run);
  }

  const latestJobs = new Map<string, RunProgress>();
  const runIds = [...latestRuns.values()].map((run) => run.id);
  for (const job of executor
    .select({
      runId: jobs.runId,
      state: jobs.state,
      progress: jobs.progress,
      progressMessage: jobs.progressMessage,
    })
    .from(jobs)
    .where(inArray(jobs.runId, runIds))
    .orderBy(desc(jobs.createdAt), desc(sql`rowid`))
    .all()) {
    if (job.runId && !latestJobs.has(job.runId)) {
      latestJobs.set(job.runId, {
        runStatus: null,
        jobState: job.state,
        progress: job.progress,
        progressMessage: job.progressMessage,
      });
    }
  }

  const progress = new Map<string, RunProgress>();
  for (const [projectId, run] of latestRuns) {
    const job = latestJobs.get(run.id);
    progress.set(projectId, {
      runStatus: run.status,
      jobState: job?.jobState ?? null,
      progress: job?.progress ?? null,
      progressMessage: job?.progressMessage ?? null,
    });
  }
  return progress;
}

function thumbnailProjects(executor: Executor, projectIds: string[]) {
  return new Set(
    executor
      .select({ projectId: mediaDerivatives.projectId })
      .from(mediaDerivatives)
      .where(
        and(
          inArray(mediaDerivatives.projectId, projectIds),
          eq(mediaDerivatives.kind, "thumbnail"),
          eq(mediaDerivatives.status, "ready"),
        ),
      )
      .all()
      .map((row) => row.projectId),
  );
}

// The sweep treats an upload this idle as abandoned by its client too.
function libraryUploadStatus(
  status: UploadStatus | null,
  updatedAt: Date | null,
  now: Date,
): LibraryUploadStatus | null {
  const idle =
    updatedAt !== null &&
    now.getTime() - updatedAt.getTime() >= IDLE_BEFORE_RETRY_MS;
  return status === "uploading" && idle ? "paused" : status;
}

const NO_RUN: RunProgress = {
  runStatus: null,
  jobState: null,
  progress: null,
  progressMessage: null,
};

function projectMatch(
  name: string,
  query: SearchQuery,
  transcript: TranscriptMatches | undefined,
): ProjectSummary["match"] {
  const nameMatches = matchesQuery(name, query);
  if (!nameMatches && !transcript) return null;
  return {
    nameSegments: nameMatches ? highlightQuery(name, query) : null,
    hitCount: transcript?.hitCount ?? 0,
    languages: [...(transcript?.languages ?? [])]
      .map(([language, count]) => ({ language, count }))
      .toSorted((a, b) => b.count - a.count),
    hits: transcript?.hits ?? [],
  };
}

function byActivity(a: ProjectSummary, b: ProjectSummary): number {
  return (
    b.activityAt.getTime() - a.activityAt.getTime() ||
    b.createdAt.getTime() - a.createdAt.getTime()
  );
}

// Name matches first, then the strongest transcript match, then the most hits.
function byRelevance(
  scores: Map<string, number>,
): (a: ProjectSummary, b: ProjectSummary) => number {
  const nameRank = (project: ProjectSummary) =>
    project.match?.nameSegments ? 0 : 1;
  return (a, b) =>
    nameRank(a) - nameRank(b) ||
    (scores.get(a.id) ?? 0) - (scores.get(b.id) ?? 0) ||
    (b.match?.hitCount ?? 0) - (a.match?.hitCount ?? 0) ||
    byActivity(a, b);
}

const COMPARE_NAMES = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
}).compare;

function sortProjects(
  projects: ProjectSummary[],
  search: LibrarySearch,
  scores: Map<string, number>,
): ProjectSummary[] {
  switch (search.sort) {
    case "relevance":
      return projects.toSorted(search.query ? byRelevance(scores) : byActivity);
    case "added":
      return projects.toSorted(
        (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
      );
    case "name":
      return projects.toSorted(
        (a, b) => COMPARE_NAMES(a.name, b.name) || byActivity(a, b),
      );
    case "activity":
      return projects.toSorted(byActivity);
  }
}

function passesFilters(
  project: ProjectSummary,
  search: LibrarySearch,
  now: Date,
): boolean {
  if (search.language && !project.languages.includes(search.language)) {
    return false;
  }
  if (search.status && libraryStatus(project) !== search.status) return false;
  if (search.added) {
    const since = now.getTime() - ADDED_WITHIN_DAYS[search.added] * DAY_MS;
    if (project.createdAt.getTime() < since) return false;
  }
  return true;
}

function hasFilters(search: LibrarySearch): boolean {
  return (
    search.language !== null || search.status !== null || search.added !== null
  );
}

export function listLibraryProjects(
  executor: Executor,
  workspaceId: string,
  search: LibrarySearch,
  now = new Date(),
): LibraryResults {
  const rows = executor
    .select({
      id: projects.id,
      name: projects.name,
      createdAt: projects.createdAt,
      updatedAt: projects.updatedAt,
      mediaDurationUs: projects.mediaDurationUs,
      mediaPreparationStatus: projects.mediaPreparationStatus,
      uploadStatus: mediaUploads.status,
      uploadUpdatedAt: mediaUploads.updatedAt,
      originalFilename: mediaUploads.originalFilename,
      mediaType: mediaUploads.mediaType,
      sizeBytes: mediaUploads.sizeBytes,
      receivedBytes: mediaUploads.receivedBytes,
    })
    .from(projects)
    .leftJoin(mediaUploads, eq(mediaUploads.projectId, projects.id))
    .where(eq(projects.workspaceId, workspaceId))
    .all();
  const projectIds = rows.map((row) => row.id);
  const subtitleEdits = latestSubtitleEdits(executor, workspaceId);
  const runs = latestRunProgress(executor, projectIds);
  const thumbnails = thumbnailProjects(executor, projectIds);
  const languages = projectLanguages(executor, workspaceId);
  const query = parseSearchQuery(search.query);
  const hasQuery = !isEmptyQuery(query);
  const needsTerm = hasQuery && query.terms.length === 0;
  const transcripts =
    hasQuery && !needsTerm && searchesTranscripts(query)
      ? searchTranscripts(executor, workspaceId, query, search.language)
      : new Map<string, TranscriptMatches>();

  const all: ProjectSummary[] = rows.map(
    ({ updatedAt, uploadUpdatedAt, ...row }) => {
      const subtitleEdit = subtitleEdits.get(row.id);
      const activityAt =
        subtitleEdit && subtitleEdit > updatedAt ? subtitleEdit : updatedAt;
      return {
        ...row,
        ...(runs.get(row.id) ?? NO_RUN),
        uploadStatus: libraryUploadStatus(
          row.uploadStatus,
          uploadUpdatedAt,
          now,
        ),
        activityAt,
        hasThumbnail: thumbnails.has(row.id),
        languages: languages.get(row.id) ?? [],
        match: hasQuery
          ? projectMatch(row.name, query, transcripts.get(row.id))
          : null,
      };
    },
  );
  const matching = hasQuery
    ? all.filter((project) => !needsTerm && project.match !== null)
    : all;
  const filtered = matching.filter((project) =>
    passesFilters(project, search, now),
  );
  const scores = new Map(
    [...transcripts].map(([id, match]) => [id, match.bestScore]),
  );
  return {
    projects: sortProjects(filtered, search, scores),
    unfilteredCount:
      filtered.length === 0 && hasFilters(search)
        ? unfilteredMatchCount(executor, workspaceId, query, all)
        : filtered.length,
    needsTerm,
  };
}

export function listLibraryStatuses(
  executor: Executor,
  workspaceId: string,
): LibraryProjectStatus[] {
  const everything: LibrarySearch = {
    query: "",
    language: null,
    status: null,
    added: null,
    sort: "activity",
  };
  return listLibraryProjects(executor, workspaceId, everything).projects.map(
    (project) => ({
      id: project.id,
      runStatus: project.runStatus,
      jobState: project.jobState,
      progress: project.progress,
      progressMessage: project.progressMessage,
      uploadStatus: project.uploadStatus,
      receivedBytes: project.receivedBytes,
      sizeBytes: project.sizeBytes,
      mediaPreparationStatus: project.mediaPreparationStatus,
      mediaDurationUs: project.mediaDurationUs,
      hasThumbnail: project.hasThumbnail,
    }),
  );
}

// Without the language filter a query can match more transcripts, so they
// are searched again.
function unfilteredMatchCount(
  executor: Executor,
  workspaceId: string,
  query: SearchQuery,
  all: ProjectSummary[],
): number {
  if (isEmptyQuery(query)) return all.length;
  if (query.terms.length === 0) return 0;
  const transcripts = searchesTranscripts(query)
    ? searchTranscripts(executor, workspaceId, query, null)
    : new Map<string, TranscriptMatches>();
  return all.filter(
    (project) =>
      transcripts.has(project.id) || matchesQuery(project.name, query),
  ).length;
}

export function renameProjectForUser(
  executor: Executor,
  projectId: string,
  userId: string,
  name: string,
): boolean {
  if (!projectForUser(executor, projectId, userId)) return false;
  executor
    .update(projects)
    .set({ name })
    .where(eq(projects.id, projectId))
    .run();
  return true;
}
