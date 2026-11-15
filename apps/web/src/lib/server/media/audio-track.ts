import { conflict } from "#lib/server/http/errors.ts";
import type { Executor } from "#lib/server/db/index.ts";
import { hasAudioTrackCopy } from "#lib/server/media/derivatives.ts";
import {
  checkAudioTrack,
  enqueueMediaPreparation,
  mediaProbeOf,
} from "#lib/server/media/preparation.ts";

// A transcript plays the audio it came from, so that track's waveform and
// preview are prepared next to the run. Other tracks keep theirs.
export function prepareTranscriptAudio(
  tx: Executor,
  project: { id: string; workspaceId: string; sourceStorageKey: string },
  audioTrack: number,
): void {
  const probe = mediaProbeOf(tx, project.id);
  // The first preparation, which reads the file, builds the first track.
  if (!probe) {
    if (audioTrack === 0) return;
    throw conflict(
      "The file's audio tracks are not known until media preparation reads it.",
    );
  }
  checkAudioTrack(probe, audioTrack);
  if (hasAudioTrackCopy(tx, project.id, audioTrack)) return;
  enqueueMediaPreparation(tx, {
    workspaceId: project.workspaceId,
    projectId: project.id,
    sourceStorageKey: project.sourceStorageKey,
    audioTrack,
  });
}
