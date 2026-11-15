import type { MediaPreparationJobPayload } from "@anysub/contracts";
import { and, desc, eq } from "drizzle-orm";

import type { Executor } from "#lib/server/db/index.ts";
import { jobs, mediaUploads, projects } from "#lib/server/db/schema.ts";
import { withTransaction } from "#lib/server/db/transaction.ts";
import { badRequest, conflict, notFound } from "#lib/server/http/errors.ts";
import {
  isActiveJob,
  isMediaPrepareJob,
  isUnreadMedia,
  preparationAudioTrack,
} from "#lib/server/jobs/predicates.ts";
import { cancelActiveJobs } from "#lib/server/jobs/release.ts";
import { cleanupStagedMediaArtifacts } from "#lib/server/media/artifact-staging.ts";
import { projectForUser } from "#lib/server/projects/access.ts";
import { audioTracksOf } from "#lib/shared/audio-tracks.ts";

// The payload is built from the project row read in the same transaction, so
// it always describes the source the job will read.
export function enqueueMediaPreparation(
  tx: Executor,
  input: {
    workspaceId: string;
    projectId: string;
    sourceStorageKey: string;
    audioTrack: number;
  },
): string {
  const source = tx
    .select({
      storageKey: projects.mediaOriginalKey,
      filename: projects.mediaFilename,
      mediaType: mediaUploads.mediaType,
    })
    .from(projects)
    .leftJoin(mediaUploads, eq(mediaUploads.projectId, projects.id))
    .where(eq(projects.id, input.projectId))
    .get();
  if (
    !source ||
    source.storageKey !== input.sourceStorageKey ||
    source.filename === null
  ) {
    throw new Error("Project source changed before media preparation queued.");
  }
  const existing = activePreparation(tx, input.projectId, input.audioTrack);
  if (existing) return existing.id;

  const payload: MediaPreparationJobPayload = {
    kind: "media_prepare",
    projectId: input.projectId,
    sourceStorageKey: input.sourceStorageKey,
    sourceFilename: source.filename,
    ...(source.mediaType ? { sourceMediaType: source.mediaType } : {}),
    audioTrack: input.audioTrack,
  };
  const job = tx
    .insert(jobs)
    .values({
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      kind: "media_prepare",
      payload,
    })
    .returning({ id: jobs.id })
    .get();
  tx.update(projects)
    .set({ mediaPreparationStatus: "queued" })
    .where(and(eq(projects.id, input.projectId), isUnreadMedia))
    .run();
  return job.id;
}

export function activePreparation(
  executor: Executor,
  projectId: string,
  audioTrack: number,
): { id: string } | undefined {
  return executor
    .select({ id: jobs.id })
    .from(jobs)
    .where(
      and(
        eq(jobs.projectId, projectId),
        isMediaPrepareJob,
        isActiveJob,
        eq(preparationAudioTrack, audioTrack),
      ),
    )
    .orderBy(desc(jobs.createdAt))
    .limit(1)
    .get();
}

export function mediaProbeOf(
  executor: Executor,
  projectId: string,
): Record<string, unknown> | null {
  return (
    executor
      .select({ probe: projects.mediaProbe })
      .from(projects)
      .where(eq(projects.id, projectId))
      .get()?.probe ?? null
  );
}

// Until the file has been read, only the first track is known to exist.
export function checkAudioTrack(
  probe: Record<string, unknown> | null,
  audioTrack: number,
): void {
  const count = probe ? audioTracksOf(probe).length : 1;
  if (count === 0) throw badRequest("The file has no audio.");
  if (audioTrack >= count) {
    throw badRequest(`The file has no audio track ${audioTrack + 1}.`);
  }
}

export function requestMediaPreparationForUser(
  projectId: string,
  userId: string,
  audioTrack: number,
): void {
  withTransaction((tx) => {
    const project = projectForUser(tx, projectId, userId);
    if (!project) throw notFound("Project not found.");
    if (!project.mediaOriginalKey) {
      throw conflict("The source upload is not complete yet.");
    }
    checkAudioTrack(mediaProbeOf(tx, projectId), audioTrack);
    enqueueMediaPreparation(tx, {
      workspaceId: project.workspaceId,
      projectId,
      sourceStorageKey: project.mediaOriginalKey,
      audioTrack,
    });
  });
}

export async function cancelMediaPreparationForUser(
  projectId: string,
  userId: string,
  audioTrack: number,
): Promise<boolean> {
  const jobId = withTransaction((tx) => {
    const project = projectForUser(tx, projectId, userId);
    if (!project) return null;
    const job = activePreparation(tx, projectId, audioTrack);
    if (!job) return null;
    cancelActiveJobs(tx, eq(jobs.id, job.id));
    tx.update(projects)
      .set({
        mediaPreparationStatus:
          mediaProbeOf(tx, projectId) === null ? "not_started" : "completed",
      })
      .where(eq(projects.id, projectId))
      .run();
    return job.id;
  });
  if (!jobId) return false;
  await cleanupStagedMediaArtifacts(jobId);
  return true;
}
