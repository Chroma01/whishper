import { describe, expect, it } from "vitest";

import type { SubtitleTrackSummary } from "#lib/shared/subtitles.ts";
import {
  currentTranslationLanguages,
  lastTranslationModelKey,
  matchingTranscript,
  newerTranslation,
  translationSourceFor,
} from "./transcripts.ts";

function original(
  id: string,
  overrides: Partial<SubtitleTrackSummary> = {},
): SubtitleTrackSummary {
  return {
    id,
    name: "Tinfoil · whisper-large-v3-turbo",
    language: "en",
    cueCount: 40,
    revision: 0,
    runId: `run-${id}`,
    madeBy: `run-${id}`,
    modelKey: "remote:whisper",
    audioTrack: 0,
    translatedFrom: null,
    createdAt: new Date(0),
    ...overrides,
  };
}

function translation(
  id: string,
  source: SubtitleTrackSummary,
  language: string,
  overrides: Partial<SubtitleTrackSummary> = {},
): SubtitleTrackSummary {
  return original(id, {
    language,
    runId: null,
    madeBy: `job-${id}`,
    modelKey: "madlad:madlad-400-3b",
    translatedFrom: { trackId: source.id, revision: source.revision },
    ...overrides,
  });
}

describe("translationSourceFor", () => {
  const first = original("first");
  const second = original("second", { language: "fr" });
  const spanish = translation("spanish", first, "es");

  it("starts from the open original", () => {
    expect(translationSourceFor([first, second, spanish], "first")).toBe(first);
  });

  it("starts a translation from the original it came from", () => {
    expect(translationSourceFor([first, second, spanish], "spanish")).toBe(
      first,
    );
  });

  it("falls back to the newest original when the source is gone", () => {
    expect(translationSourceFor([second, spanish], "spanish")).toBe(second);
  });

  it("finds nothing without an original", () => {
    expect(translationSourceFor([spanish], "spanish")).toBeNull();
  });
});

describe("currentTranslationLanguages", () => {
  it("lists only translations made from the source as it is now", () => {
    const source = original("source", { revision: 2 });
    const tracks = [
      source,
      translation("stale", { ...source, revision: 1 }, "de"),
      translation("current", source, "es"),
      translation("other", original("other"), "fr"),
    ];
    expect(currentTranslationLanguages(tracks, source)).toEqual(["es"]);
  });
});

describe("newerTranslation", () => {
  const source = original("source");
  const older = translation("older", source, "ca");
  const newer = translation("newer", source, "ca");
  const spanish = translation("spanish", source, "es");

  it("points an older translation to the newest one in its language", () => {
    expect(newerTranslation([source, older, spanish, newer], "older")).toBe(
      newer,
    );
  });

  it("finds nothing for the newest translation or an original", () => {
    expect(newerTranslation([source, older, newer], "newer")).toBeNull();
    expect(newerTranslation([source, older, newer], "source")).toBeNull();
  });

  it("ignores a translation of another original", () => {
    const other = translation("other", original("elsewhere"), "ca");
    expect(newerTranslation([source, older, other], "older")).toBeNull();
  });
});

describe("lastTranslationModelKey", () => {
  it("uses the newest translation's model", () => {
    const source = original("source");
    expect(
      lastTranslationModelKey([
        source,
        translation("local", source, "es"),
        translation("provider", source, "ca", { modelKey: "provider" }),
      ]),
    ).toBe("provider");
  });

  it("has nothing to offer before the first translation", () => {
    expect(lastTranslationModelKey([original("source")])).toBeNull();
  });
});

describe("matchingTranscript", () => {
  const english = original("english");
  const tracks = [english, translation("spanish", english, "es")];
  const wanted = { modelKey: "remote:whisper", language: "en", audioTrack: 0 };

  it("finds an original from the same model, language and audio track", () => {
    expect(matchingTranscript(tracks, wanted)).toBe(english);
  });

  it("matches any language when the language is detected", () => {
    expect(matchingTranscript(tracks, { ...wanted, language: null })).toBe(
      english,
    );
  });

  it("ignores another model, language, audio track or a translation", () => {
    expect(
      matchingTranscript(tracks, { ...wanted, modelKey: "whisperx:small" }),
    ).toBeNull();
    expect(
      matchingTranscript(tracks, { ...wanted, language: "fr" }),
    ).toBeNull();
    expect(matchingTranscript(tracks, { ...wanted, audioTrack: 1 })).toBeNull();
    expect(
      matchingTranscript(tracks, {
        modelKey: "madlad:madlad-400-3b",
        language: "es",
        audioTrack: 0,
      }),
    ).toBeNull();
  });

  it("treats a transcript from before audio tracks as the first track", () => {
    expect(
      matchingTranscript([original("old", { audioTrack: null })], wanted),
    ).not.toBeNull();
  });
});
