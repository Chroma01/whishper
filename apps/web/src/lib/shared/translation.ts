import { isRecord } from "./is-record";

export const MAX_TARGET_LANGUAGES = 10;
// Over 100 hours of speech, far more than a subtitle file holds. Each queued
// language keeps its own copy of the text.
export const MAX_TRANSLATION_CHARACTERS = 500_000;

// The form value that picks the provider's chat model set up in
// Administration. Local models use their model key.
export const PROVIDER_TRANSLATION = "provider";

export type TranslationTask = {
  jobId: string;
  sourceTrackId: string;
  targetLanguage: string;
  state: "queued" | "leased" | "failed";
  progress: number;
  progressMessage: string | null;
  error: string | null;
};

// Kept in a translated track's metadata.
export type TranslationOrigin = {
  jobId: string;
  sourceTrackId: string;
  // The source's revision when it was translated, so a later edit to the
  // source can be pointed out.
  sourceRevision: number;
  sourceLanguage: string;
  modelLabel: string;
  local: boolean;
};

export function translationOrigin(
  metadata: Record<string, unknown>,
): TranslationOrigin | null {
  const origin = metadata.translation;
  if (
    !isRecord(origin) ||
    typeof origin.jobId !== "string" ||
    typeof origin.sourceTrackId !== "string" ||
    typeof origin.sourceRevision !== "number" ||
    typeof origin.sourceLanguage !== "string" ||
    typeof origin.modelLabel !== "string" ||
    typeof origin.local !== "boolean"
  ) {
    return null;
  }
  return {
    jobId: origin.jobId,
    sourceTrackId: origin.sourceTrackId,
    sourceRevision: origin.sourceRevision,
    sourceLanguage: origin.sourceLanguage,
    modelLabel: origin.modelLabel,
    local: origin.local,
  };
}
