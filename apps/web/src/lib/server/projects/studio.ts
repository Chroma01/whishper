import { and, asc, desc, eq, sql } from "drizzle-orm";

import type { Executor } from "#lib/server/db/index.ts";
import {
  jobs,
  mediaDerivatives,
  mediaUploads,
  projects,
  transcriptionRuns,
  workspaces,
} from "#lib/server/db/schema.ts";
import {
  isMediaPrepareJob,
  preparationAudioTrack,
} from "#lib/server/jobs/predicates.ts";
import { audioTracksOf } from "#lib/shared/audio-tracks.ts";
import type {
  StudioDerivative,
  StudioPreparation,
  StudioProject,
  StudioRun,
  StudioStatus,
} from "#lib/shared/studio-data.ts";
import { translationTasks } from "#lib/server/translation/tasks.ts";

const JOB_PROGRESS = {
  progress: jobs.progress,
  progressMessage: jobs.progressMessage,
  error: jobs.error,
};

// Rows written within one millisecond keep their insertion order.
export const NEWEST_FIRST = [desc(sql`created_at`), desc(sql`rowid`)];

export function studioProject(
  executor: Executor,
  projectId: string,
): StudioProject | null {
  const row = executor
    .select({
      id: projects.id,
      name: projects.name,
      createdAt: projects.createdAt,
      workspaceName: workspaces.name,
      mediaFilename: projects.mediaFilename,
      mediaOriginalKey: projects.mediaOriginalKey,
      mediaType: mediaUploads.mediaType,
      uploadStatus: mediaUploads.status,
      sizeBytes: mediaUploads.sizeBytes,
      mediaDurationUs: projects.mediaDurationUs,
      mediaPreparationStatus: projects.mediaPreparationStatus,
      mediaProbe: projects.mediaProbe,
      mediaFrameRateNum: projects.mediaFrameRateNum,
      mediaFrameRateDen: projects.mediaFrameRateDen,
      mediaSeekable: projects.mediaSeekable,
      mediaProxyRecommended: projects.mediaProxyRecommended,
    })
    .from(projects)
    .innerJoin(workspaces, eq(workspaces.id, projects.workspaceId))
    .leftJoin(mediaUploads, eq(mediaUploads.projectId, projects.id))
    .where(eq(projects.id, projectId))
    .get();
  if (!row) return null;
  const { mediaOriginalKey, ...project } = row;
  return {
    ...project,
    hasSourceMedia: Boolean(mediaOriginalKey),
    audioTracks: audioTracksOf(project.mediaProbe),
  };
}

export function latestRun(
  executor: Executor,
  projectId: string,
): StudioRun | null {
  const run = executor
    .select({
      id: transcriptionRuns.id,
      status: transcriptionRuns.status,
      adapterId: transcriptionRuns.adapterId,
      modelId: transcriptionRuns.modelId,
    })
    .from(transcriptionRuns)
    .where(eq(transcriptionRuns.projectId, projectId))
    .orderBy(...NEWEST_FIRST)
    .limit(1)
    .get();
  if (!run) return null;
  const job = latestRunJob(executor, run.id);
  return {
    ...run,
    audioTrack: job?.audioTrack ?? 0,
    language: job?.language ?? null,
    jobState: job?.jobState ?? null,
    progress: job?.progress ?? null,
    progressMessage: job?.progressMessage ?? null,
    error: job?.error ?? null,
  };
}

export function latestRunJob(executor: Executor, runId: string) {
  return executor
    .select({
      jobState: jobs.state,
      audioTrack: sql<number>`coalesce(${jobs.payload} ->> 'audioTrack', 0)`,
      language: sql<string | null>`${jobs.payload} ->> 'language'`,
      ...JOB_PROGRESS,
    })
    .from(jobs)
    .where(eq(jobs.runId, runId))
    .orderBy(...NEWEST_FIRST)
    .limit(1)
    .get();
}

function mediaPreparationJobs(executor: Executor, projectId: string) {
  return executor
    .select({
      state: jobs.state,
      audioTrack: preparationAudioTrack,
      ...JOB_PROGRESS,
    })
    .from(jobs)
    .where(and(eq(jobs.projectId, projectId), isMediaPrepareJob))
    .orderBy(...NEWEST_FIRST);
}

export function latestMediaPreparation(
  executor: Executor,
  projectId: string,
): StudioPreparation | null {
  return mediaPreparationJobs(executor, projectId).limit(1).get() ?? null;
}

// The newest preparation of each audio track, newest first.
export function latestMediaPreparations(
  executor: Executor,
  projectId: string,
): StudioPreparation[] {
  const seen = new Set<number>();
  return mediaPreparationJobs(executor, projectId)
    .all()
    .filter(({ audioTrack }) => {
      if (seen.has(audioTrack)) return false;
      seen.add(audioTrack);
      return true;
    });
}

export function studioStatus(
  executor: Executor,
  projectId: string,
): StudioStatus {
  return {
    run: latestRun(executor, projectId),
    preparations: latestMediaPreparations(executor, projectId),
    translations: translationTasks(executor, projectId),
  };
}

export function readyDerivatives(
  executor: Executor,
  projectId: string,
): StudioDerivative[] {
  return executor
    .select({
      kind: mediaDerivatives.kind,
      audioTrack: mediaDerivatives.audioTrack,
      mediaType: mediaDerivatives.mediaType,
      sizeBytes: mediaDerivatives.sizeBytes,
      metadata: mediaDerivatives.metadata,
    })
    .from(mediaDerivatives)
    .where(
      and(
        eq(mediaDerivatives.projectId, projectId),
        eq(mediaDerivatives.status, "ready"),
      ),
    )
    .orderBy(asc(mediaDerivatives.kind), asc(mediaDerivatives.audioTrack))
    .all();
}
