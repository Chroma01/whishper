import type { ApiTrack, ApiTrackSummary } from "#lib/server/api/schemas.ts";
import { db, type Executor } from "#lib/server/db/index.ts";
import { notFound } from "#lib/server/http/errors.ts";
import { requireMemberProject } from "#lib/server/projects/access.ts";
import { listTrackCues } from "#lib/server/subtitles/cues.ts";
import { listProjectTracks } from "#lib/server/subtitles/tracks.ts";
import { isRecord } from "#lib/shared/is-record.ts";

export function trackSummaries(
  executor: Executor,
  projectId: string,
): ApiTrackSummary[] {
  return listProjectTracks(executor, projectId).map(({ runId, ...track }) => ({
    ...track,
    transcriptionId: runId,
    createdAt: track.createdAt.toISOString(),
  }));
}

export function tracksForUser(
  userId: string,
  projectId: string,
): ApiTrackSummary[] {
  requireMemberProject(db, projectId, userId);
  return trackSummaries(db, projectId);
}

export function trackForUser(
  userId: string,
  projectId: string,
  trackId: string,
): ApiTrack {
  const summary = tracksForUser(userId, projectId).find(
    (track) => track.id === trackId,
  );
  if (!summary) throw notFound("Track not found.");
  return {
    ...summary,
    cues: listTrackCues(db, trackId, { includeWords: true }).map((cue) => ({
      id: cue.id,
      startUs: cue.startUs,
      endUs: cue.endUs,
      text: cue.text,
      words: (cue.words ?? []).flatMap(apiWord),
    })),
  };
}

// Words are stored as the worker sent them; only well-formed ones are listed.
function apiWord(
  word: Record<string, unknown>,
): ApiTrack["cues"][number]["words"] {
  if (
    !isRecord(word) ||
    typeof word.text !== "string" ||
    typeof word.startUs !== "number" ||
    typeof word.endUs !== "number"
  ) {
    return [];
  }
  return [
    {
      text: word.text,
      startUs: word.startUs,
      endUs: word.endUs,
      confidence: typeof word.confidence === "number" ? word.confidence : null,
    },
  ];
}
