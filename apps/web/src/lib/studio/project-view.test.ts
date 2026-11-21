import { describe, expect, it } from "vitest";

import {
  audioTrackState,
  derivativeUrl,
  editorCues,
  finishedRun,
  finishedTranslations,
  playableAudioTrack,
  preparedAudioTracks,
  processingStateChanged,
  unopenedTranscript,
} from "./project-view";
import type { StudioData } from "#lib/shared/studio-data.ts";

describe("editorCues", () => {
  it("maps stored cues to editor cues", () => {
    expect(
      editorCues([
        { id: "a", position: 0, startUs: 1, endUs: 2, text: "Hi", words: [] },
      ]),
    ).toEqual([{ id: "a", position: 0, start_us: 1, end_us: 2, text: "Hi" }]);
  });
});

function derivative(
  kind: "waveform" | "proxy" | "thumbnail",
  audioTrack: number,
): StudioData["derivatives"][number] {
  return {
    kind,
    audioTrack,
    mediaType: "application/octet-stream",
    sizeBytes: 1,
    metadata: {},
    url: `/${kind}/${audioTrack}`,
  };
}

describe("derivativeUrl", () => {
  const derivatives = [derivative("waveform", 0), derivative("waveform", 1)];

  it("finds the url of a ready derivative for an audio track", () => {
    expect(derivativeUrl(derivatives, "waveform")).toBe("/waveform/0");
    expect(derivativeUrl(derivatives, "waveform", 1)).toBe("/waveform/1");
  });

  it("is null when the derivative is missing", () => {
    expect(derivativeUrl(derivatives, "proxy")).toBeNull();
    expect(derivativeUrl(derivatives, "waveform", 2)).toBeNull();
  });
});

describe("preparedAudioTracks", () => {
  it("lists the tracks that have a waveform", () => {
    expect(
      preparedAudioTracks([
        derivative("thumbnail", 0),
        derivative("waveform", 2),
        derivative("proxy", 1),
      ]),
    ).toEqual(new Set([2]));
  });
});

describe("audioTrackState", () => {
  const preparation = {
    audioTrack: 1,
    state: "leased",
    progress: 0.4,
    progressMessage: null,
    error: null,
  };

  it("shows an active preparation, even for a ready track", () => {
    expect(audioTrackState(1, new Set([1]), [preparation])).toEqual({
      kind: "preparing",
      progress: 0.4,
    });
  });

  it("tells ready, failed and missing tracks apart", () => {
    const failed = {
      ...preparation,
      state: "failed",
      error: { message: "No decoder." },
    };
    expect(audioTrackState(0, new Set([0]), [failed])).toEqual({
      kind: "ready",
    });
    expect(audioTrackState(1, new Set([0]), [failed])).toEqual({
      kind: "failed",
      message: "No decoder.",
    });
    expect(audioTrackState(2, new Set([0]), [failed])).toEqual({
      kind: "missing",
    });
  });
});

describe("playableAudioTrack", () => {
  it("plays the wanted track once it is ready", () => {
    expect(playableAudioTrack(1, 0, new Set([0, 1]))).toBe(1);
  });

  it("keeps the current track while the wanted one is prepared", () => {
    expect(playableAudioTrack(2, 1, new Set([0, 1]))).toBe(1);
  });

  it("falls back to the first ready track, or the source", () => {
    expect(playableAudioTrack(2, 3, new Set([1, 0]))).toBe(0);
    expect(playableAudioTrack(2, 1, new Set())).toBe(0);
  });
});

describe("processingStateChanged", () => {
  const progress = {
    progress: 0.2,
    progressMessage: "Transcribing",
    error: null,
  };
  const run = {
    ...progress,
    id: "run",
    status: "running",
    adapterId: "whisperx",
    modelId: "small",
    audioTrack: 0,
    language: null,
    jobState: "leased",
  };
  const preparation = { ...progress, state: "leased", audioTrack: 1 };
  const status = { run, preparations: [preparation], translations: [] };

  it("ignores progress within the same state", () => {
    expect(
      processingStateChanged(status, {
        run: { ...run, progress: 0.6, progressMessage: "Aligning" },
        preparations: [{ ...preparation, progress: 0.9 }],
        translations: [],
      }),
    ).toBe(false);
  });

  it("notices a finished run, a new run or a changed preparation", () => {
    expect(
      processingStateChanged(status, {
        ...status,
        run: { ...run, status: "completed" },
      }),
    ).toBe(true);
    expect(
      processingStateChanged(status, {
        ...status,
        run: { ...run, id: "next" },
      }),
    ).toBe(true);
    expect(
      processingStateChanged(status, {
        ...status,
        preparations: [{ ...preparation, state: "completed" }],
      }),
    ).toBe(true);
    expect(
      processingStateChanged(status, {
        ...status,
        preparations: [{ ...preparation, audioTrack: 2 }, preparation],
      }),
    ).toBe(true);
    expect(processingStateChanged(status, { ...status, run: null })).toBe(true);
  });
});

describe("finishedRun", () => {
  const run = {
    id: "run",
    status: "running",
    adapterId: "whisperx",
    modelId: "small",
    audioTrack: 0,
    language: null,
    jobState: "leased",
    progress: 0.5,
    progressMessage: null,
    error: null,
  };
  const status = { run, preparations: [], translations: [] };

  it("names a run that completed since the last poll", () => {
    expect(
      finishedRun(status, { ...status, run: { ...run, status: "completed" } }),
    ).toBe("run");
  });

  it("ignores a failed run, a still active one, or one seen finished", () => {
    expect(
      finishedRun(status, { ...status, run: { ...run, status: "failed" } }),
    ).toBeNull();
    expect(finishedRun(status, status)).toBeNull();
    const completed = { ...status, run: { ...run, status: "completed" } };
    expect(finishedRun(completed, completed)).toBeNull();
  });
});

describe("finishedTranslations", () => {
  const task = {
    jobId: "job",
    sourceTrackId: "track",
    targetLanguage: "es",
    state: "leased" as const,
    progress: 0.5,
    progressMessage: null,
    error: null,
  };
  const running = { run: null, preparations: [], translations: [task] };
  const idle = { ...running, translations: [] };

  it("names a translation that left the list since the last poll", () => {
    expect(finishedTranslations(running, idle)).toEqual(["job"]);
    expect(processingStateChanged(running, idle)).toBe(true);
  });

  it("ignores one still running or one that failed", () => {
    expect(finishedTranslations(running, running)).toEqual([]);
    const failed = {
      ...running,
      translations: [{ ...task, state: "failed" as const }],
    };
    expect(finishedTranslations(running, failed)).toEqual([]);
    expect(finishedTranslations(failed, idle)).toEqual([]);
  });
});

describe("unopenedTranscript", () => {
  const transcript = (id: string, madeBy: string | null) => ({
    id,
    name: "whisperx · small",
    language: "en",
    cueCount: 1,
    revision: 0,
    runId: madeBy,
    madeBy,
    modelKey: "whisperx:small",
    audioTrack: 0,
    translatedFrom: null,
    createdAt: new Date(0),
  });
  const tracks = [transcript("old", "first"), transcript("new", "second")];

  it("finds the transcript the run made while another is open", () => {
    expect(unopenedTranscript(tracks, "old", ["second"])?.id).toBe("new");
  });

  it("is null once that transcript is open, or without a finished run", () => {
    expect(unopenedTranscript(tracks, "new", ["second"])).toBeNull();
    expect(unopenedTranscript(tracks, "old", [])).toBeNull();
    expect(unopenedTranscript(tracks, "old", ["deleted"])).toBeNull();
  });

  it("skips a finished job that made no transcript, such as a cancelled one", () => {
    expect(unopenedTranscript(tracks, "old", ["cancelled", "second"])?.id).toBe(
      "new",
    );
  });
});
