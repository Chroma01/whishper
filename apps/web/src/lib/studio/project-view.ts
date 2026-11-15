import type { MediaDerivativeKind } from "@anysub/contracts";

import type { EditorCue } from "#lib/editor/cues.ts";
import {
  isPreparationActive,
  isRunActive,
} from "#lib/shared/project-status.ts";
import type {
  SubtitleCueSnapshot,
  SubtitleTrackSummary,
} from "#lib/shared/subtitles.ts";
import type {
  StudioData,
  StudioPreparation,
  StudioStatus,
} from "#lib/shared/studio-data.ts";

export function editorCues(cues: readonly SubtitleCueSnapshot[]): EditorCue[] {
  return cues.map((cue) => ({
    id: cue.id,
    position: cue.position,
    start_us: cue.startUs,
    end_us: cue.endUs,
    text: cue.text,
  }));
}

export function derivativeUrl(
  derivatives: StudioData["derivatives"],
  kind: MediaDerivativeKind,
  audioTrack = 0,
): string | null {
  return (
    derivatives.find(
      (derivative) =>
        derivative.kind === kind && derivative.audioTrack === audioTrack,
    )?.url ?? null
  );
}

// Every file with audio gets a waveform, so it marks a track ready to play.
export function preparedAudioTracks(
  derivatives: StudioData["derivatives"],
): Set<number> {
  return new Set(
    derivatives
      .filter((derivative) => derivative.kind === "waveform")
      .map((derivative) => derivative.audioTrack),
  );
}

export type AudioTrackState =
  | { kind: "ready" }
  | { kind: "preparing"; progress: number | null }
  | { kind: "failed"; message: string }
  | { kind: "missing" };

// A rebuild of a ready track shows as preparing, though the track still plays.
export function audioTrackState(
  audioTrack: number,
  prepared: ReadonlySet<number>,
  preparations: readonly StudioPreparation[],
): AudioTrackState {
  const preparation = preparations.find(
    (candidate) => candidate.audioTrack === audioTrack,
  );
  if (preparation && isPreparationActive(preparation)) {
    return { kind: "preparing", progress: preparation.progress };
  }
  if (prepared.has(audioTrack)) return { kind: "ready" };
  if (preparation?.state === "failed") {
    const message = preparation.error?.message;
    return {
      kind: "failed",
      message:
        typeof message === "string"
          ? message
          : "The track could not be prepared.",
    };
  }
  return { kind: "missing" };
}

// The wanted track plays once it is ready. Until then the current one keeps
// playing, or else the first ready one. A file nothing is ready for plays its
// source, which is the first track.
export function playableAudioTrack(
  wanted: number,
  current: number,
  prepared: ReadonlySet<number>,
): number {
  if (prepared.has(wanted)) return wanted;
  if (prepared.has(current)) return current;
  return prepared.size > 0 ? Math.min(...prepared) : 0;
}

// The run that finished between two polls.
export function finishedRun(
  previous: StudioStatus,
  next: StudioStatus,
): string | null {
  const run = previous.run;
  return run &&
    isRunActive(run) &&
    next.run?.id === run.id &&
    next.run.status === "completed"
    ? run.id
    : null;
}

// The transcript a finished run made, unless it is already open.
export function unopenedTranscript(
  tracks: readonly SubtitleTrackSummary[],
  openTrackId: string | undefined,
  runId: string | null,
): SubtitleTrackSummary | null {
  const made = runId ? tracks.find((track) => track.runId === runId) : null;
  return made && made.id !== openTrackId ? made : null;
}

// Progress within a state is shown from the status alone. A new run or a
// changed state can bring a new transcript or a track's waveform and preview,
// so it reloads the whole studio.
export function processingStateChanged(
  previous: StudioStatus,
  next: StudioStatus,
): boolean {
  return (
    previous.run?.id !== next.run?.id ||
    previous.run?.status !== next.run?.status ||
    preparationStates(previous) !== preparationStates(next)
  );
}

function preparationStates(status: StudioStatus): string {
  return status.preparations
    .map(({ audioTrack, state }) => `${audioTrack}:${state}`)
    .sort()
    .join(",");
}
