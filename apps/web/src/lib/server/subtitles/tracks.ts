import { and, asc, count, eq, sql } from "drizzle-orm";

import type { Executor } from "#lib/server/db/index.ts";
import { cues, subtitleTracks } from "#lib/server/db/schema.ts";
import { transcriptAudioTrack } from "#lib/shared/audio-tracks.ts";
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
      runId: subtitleTracks.sourceRunId,
      createdAt: subtitleTracks.createdAt,
    })
    .from(subtitleTracks)
    .leftJoin(cues, eq(cues.trackId, subtitleTracks.id))
    .where(eq(subtitleTracks.projectId, projectId))
    .groupBy(subtitleTracks.id)
    .orderBy(asc(subtitleTracks.createdAt), asc(sql`${subtitleTracks}.rowid`))
    .all()
    .map(({ metadata, ...track }) => ({
      ...track,
      audioTrack: transcriptAudioTrack(metadata),
    }));
}
