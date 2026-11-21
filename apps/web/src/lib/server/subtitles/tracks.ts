import { and, asc, count, eq, sql } from "drizzle-orm";

import type { Executor } from "#lib/server/db/index.ts";
import {
  cues,
  subtitleTracks,
  transcriptionRuns,
} from "#lib/server/db/schema.ts";
import { transcriptAudioTrack } from "#lib/shared/audio-tracks.ts";
import { isRecord } from "#lib/shared/is-record.ts";
import { modelKey } from "#lib/shared/transcription-models.ts";
import {
  PROVIDER_TRANSLATION,
  translationOrigin,
  type TranslationOrigin,
} from "#lib/shared/translation.ts";
import type {
  SubtitleTrack,
  SubtitleTrackSummary,
} from "#lib/shared/subtitles.ts";

const TRACK_COLUMNS = {
  id: subtitleTracks.id,
  name: subtitleTracks.name,
  language: subtitleTracks.language,
  metadata: subtitleTracks.metadata,
  revision: subtitleTracks.revision,
};

export function trackForProject(
  executor: Executor,
  projectId: string,
  trackId: string,
): SubtitleTrack | null {
  const track = executor
    .select(TRACK_COLUMNS)
    .from(subtitleTracks)
    .where(
      and(
        eq(subtitleTracks.projectId, projectId),
        eq(subtitleTracks.id, trackId),
      ),
    )
    .get();
  return track ?? null;
}

// Oldest first. Two tracks can share a millisecond, so insertion order breaks
// the tie.
export function listProjectTracks(
  executor: Executor,
  projectId: string,
): SubtitleTrackSummary[] {
  return executor
    .select({
      id: subtitleTracks.id,
      name: subtitleTracks.name,
      language: subtitleTracks.language,
      metadata: subtitleTracks.metadata,
      cueCount: count(cues.id),
      revision: subtitleTracks.revision,
      runId: subtitleTracks.sourceRunId,
      runAdapterId: transcriptionRuns.adapterId,
      runModelId: transcriptionRuns.modelId,
      createdAt: subtitleTracks.createdAt,
    })
    .from(subtitleTracks)
    .leftJoin(cues, eq(cues.trackId, subtitleTracks.id))
    .leftJoin(
      transcriptionRuns,
      eq(transcriptionRuns.id, subtitleTracks.sourceRunId),
    )
    .where(eq(subtitleTracks.projectId, projectId))
    .groupBy(subtitleTracks.id)
    .orderBy(asc(subtitleTracks.createdAt), asc(sql`${subtitleTracks}.rowid`))
    .all()
    .map(({ metadata, runAdapterId, runModelId, ...track }) => {
      const origin = translationOrigin(metadata);
      return {
        ...track,
        madeBy: track.runId ?? origin?.jobId ?? null,
        modelKey:
          runAdapterId && runModelId
            ? modelKey(runAdapterId, runModelId)
            : origin && translationModelKey(metadata, origin),
        audioTrack: transcriptAudioTrack(metadata),
        translatedFrom: origin && {
          trackId: origin.sourceTrackId,
          revision: origin.sourceRevision,
        },
      };
    });
}

// Every provider translation is offered as one choice, whichever chat model
// the administrator picked.
function translationModelKey(
  metadata: Record<string, unknown>,
  origin: TranslationOrigin,
): string | null {
  if (!origin.local) return PROVIDER_TRANSLATION;
  const adapter = metadata.adapter;
  return isRecord(adapter) &&
    typeof adapter.id === "string" &&
    typeof adapter.modelId === "string"
    ? modelKey(adapter.id, adapter.modelId)
    : null;
}
