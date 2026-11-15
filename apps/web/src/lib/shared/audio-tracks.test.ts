import { describe, expect, it } from "vitest";

import {
  audioTrackDetails,
  audioTrackName,
  audioTracksOf,
  transcriptionLanguageOf,
  type AudioTrack,
} from "#lib/shared/audio-tracks.ts";

const probe = {
  streams: [
    { index: 0, type: "video", codec: "h264" },
    {
      index: 1,
      type: "audio",
      codec: "aac",
      language: "jpn",
      title: "Japanese",
      audio: { channels: 2, channelLayout: "stereo" },
    },
    { index: 2, type: "subtitle", codec: "ass", language: "eng" },
    {
      index: 3,
      type: "audio",
      codec: "eac3",
      language: "eng",
      title: "Commentary",
      audio: { channels: 6, channelLayout: "5.1(side)" },
    },
    { index: 4, type: "audio", codec: "pcm_s16le", audio: { channels: 1 } },
  ],
};

function track(fields: Partial<AudioTrack>): AudioTrack {
  return {
    index: 0,
    codec: "aac",
    channels: null,
    channelLayout: null,
    language: null,
    title: null,
    ...fields,
  };
}

describe("audio tracks", () => {
  it("numbers the audio streams in file order and reads their tags", () => {
    expect(audioTracksOf(probe)).toEqual([
      {
        index: 0,
        codec: "aac",
        channels: 2,
        channelLayout: "stereo",
        language: "ja",
        title: "Japanese",
      },
      {
        index: 1,
        codec: "eac3",
        channels: 6,
        channelLayout: "5.1(side)",
        language: "en",
        title: "Commentary",
      },
      {
        index: 2,
        codec: "pcm_s16le",
        channels: 1,
        channelLayout: null,
        language: null,
        title: null,
      },
    ]);
    expect(audioTracksOf(null)).toEqual([]);
    expect(audioTracksOf({ streams: "broken" })).toEqual([]);
  });

  it("names a track by number and language, with details apart", () => {
    const [japanese, commentary, untagged] = audioTracksOf(probe);

    expect(audioTrackName(japanese)).toBe("Track 1 · Japanese");
    expect(audioTrackDetails(japanese)).toBe("AAC · Stereo");
    expect(audioTrackName(commentary)).toBe("Track 2 · English");
    expect(audioTrackDetails(commentary)).toBe("Commentary · EAC3 · 5.1");
    expect(audioTrackName(untagged)).toBe("Track 3");
    expect(audioTrackDetails(untagged)).toBe("PCM · Mono");
  });

  it("ignores a language tag that is not a language", () => {
    const [tagged] = audioTracksOf({
      streams: [{ type: "audio", codec: "aac", language: "not a tag" }],
    });

    expect(tagged.language).toBeNull();
    expect(audioTrackName(track({ language: "qaa" }))).toBe("Track 1");
  });

  it("maps a track's language to the code Whisper uses", () => {
    expect(transcriptionLanguageOf(track({ language: "ja" }))).toBe("ja");
    expect(transcriptionLanguageOf(track({ language: "jv" }))).toBe("jw");
    expect(transcriptionLanguageOf(track({ language: "fil" }))).toBe("tl");
    expect(transcriptionLanguageOf(track({ language: "nb" }))).toBe("no");
    expect(transcriptionLanguageOf(track({ language: "qaa" }))).toBeNull();
    expect(transcriptionLanguageOf(track({}))).toBeNull();
  });
});
