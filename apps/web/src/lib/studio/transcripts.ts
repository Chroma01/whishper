import type { SubtitleTrackSummary } from "#lib/shared/subtitles.ts";

type Track = SubtitleTrackSummary;

export const transcriptDate = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

// Made from the audio, so it can be translated.
export function isOriginal(track: Track): boolean {
  return track.translatedFrom === null;
}

// Where a translation of this transcript starts: the transcript itself, or
// the original a translation came from. The newest original stands in when
// that one is gone.
export function translationSourceFor(
  tracks: readonly Track[],
  trackId: string,
): Track | null {
  const originals = tracks.filter(isOriginal);
  const wanted =
    tracks.find((track) => track.id === trackId)?.translatedFrom?.trackId ??
    trackId;
  return (
    originals.find((track) => track.id === wanted) ?? originals.at(-1) ?? null
  );
}

// Languages the source already has a translation in that is as new as the
// source itself.
export function currentTranslationLanguages(
  tracks: readonly Track[],
  source: Track,
): string[] {
  return tracks
    .filter(
      (track) =>
        track.translatedFrom?.trackId === source.id &&
        track.translatedFrom.revision === source.revision,
    )
    .map((track) => track.language);
}

// A later translation of the same original into the same language.
export function newerTranslation(
  tracks: readonly Track[],
  trackId: string,
): Track | null {
  const index = tracks.findIndex((track) => track.id === trackId);
  const translation = tracks[index];
  if (!translation?.translatedFrom) return null;
  const { trackId: sourceId } = translation.translatedFrom;
  return (
    tracks
      .slice(index + 1)
      .findLast(
        (track) =>
          track.language === translation.language &&
          track.translatedFrom?.trackId === sourceId,
      ) ?? null
  );
}

// The newest translation's model, which the next one starts on.
export function lastTranslationModelKey(
  tracks: readonly Track[],
): string | null {
  return tracks.findLast((track) => !isOriginal(track))?.modelKey ?? null;
}

// An original the same model made from the same audio track, in the chosen
// language. With the language left to detection, any language matches.
export function matchingTranscript(
  tracks: readonly Track[],
  wanted: { modelKey: string; language: string | null; audioTrack: number },
): Track | null {
  return (
    tracks.find(
      (track) =>
        isOriginal(track) &&
        track.modelKey === wanted.modelKey &&
        (track.audioTrack ?? 0) === wanted.audioTrack &&
        (wanted.language === null || track.language === wanted.language),
    ) ?? null
  );
}
