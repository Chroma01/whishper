import { LANGUAGES } from "./languages";

export type AudioTrack = {
  // Counts audio streams only, from 0, the way ffmpeg's "0:a:N" does.
  index: number;
  codec: string;
  channels: number | null;
  channelLayout: string | null;
  // A language subtag such as "ja", from the file's own track tag.
  language: string | null;
  title: string | null;
};

type ProbeStream = {
  type?: unknown;
  codec?: unknown;
  language?: unknown;
  title?: unknown;
  audio?: { channels?: unknown; channelLayout?: unknown } | null;
};

// Whisper predates a few of the codes Intl.Locale settles on.
const WHISPER_LANGUAGE_CODES: Record<string, string> = {
  fil: "tl",
  jv: "jw",
  nb: "no",
};
const TRANSCRIPTION_LANGUAGES = new Set(
  LANGUAGES.map((language) => language.code),
);
const languageNames = new Intl.DisplayNames(["en"], { type: "language" });

export function transcriptAudioTrack(
  metadata: Record<string, unknown>,
): number | null {
  return typeof metadata.audioTrack === "number" ? metadata.audioTrack : null;
}

// Probes stored before tracks had tags lack language and title.
export function audioTracksOf(
  probe: Record<string, unknown> | null,
): AudioTrack[] {
  const streams = Array.isArray(probe?.streams)
    ? (probe.streams as ProbeStream[])
    : [];
  return streams
    .filter((stream) => stream.type === "audio")
    .map((stream, index) => ({
      index,
      codec: typeof stream.codec === "string" ? stream.codec : "unknown",
      channels:
        typeof stream.audio?.channels === "number"
          ? stream.audio.channels
          : null,
      channelLayout:
        typeof stream.audio?.channelLayout === "string"
          ? stream.audio.channelLayout
          : null,
      language: canonicalLanguage(stream.language),
      title:
        typeof stream.title === "string" ? stream.title.trim() || null : null,
    }));
}

export function audioTrackName(track: AudioTrack): string {
  const number = `Track ${track.index + 1}`;
  const language = languageName(track);
  return language ? `${number} · ${language}` : number;
}

export function audioTrackDetails(track: AudioTrack): string {
  const language = languageName(track)?.toLowerCase();
  const title =
    track.title && track.title.toLowerCase() !== language ? track.title : null;
  return [title, codecName(track.codec), channelsName(track)]
    .filter(Boolean)
    .join(" · ");
}

// The transcription language for a track's tag, when Whisper knows it.
export function transcriptionLanguageOf(track: AudioTrack): string | null {
  if (!track.language) return null;
  const code = WHISPER_LANGUAGE_CODES[track.language] ?? track.language;
  return TRANSCRIPTION_LANGUAGES.has(code) ? code : null;
}

function canonicalLanguage(tag: unknown): string | null {
  if (typeof tag !== "string" || !tag.trim()) return null;
  try {
    return new Intl.Locale(tag.trim()).language;
  } catch {
    return null;
  }
}

function languageName(track: AudioTrack): string | null {
  if (!track.language) return null;
  const name = languageNames.of(track.language);
  return name && name !== track.language ? name : null;
}

function codecName(codec: string): string {
  return codec.startsWith("pcm_") ? "PCM" : codec.toUpperCase();
}

function channelsName({ channels, channelLayout }: AudioTrack): string | null {
  if (channelLayout === "mono") return "Mono";
  if (channelLayout === "stereo") return "Stereo";
  const layout = channelLayout?.match(/^\d+\.\d+/)?.[0];
  if (layout) return layout;
  if (channels === 1) return "Mono";
  return channels ? `${channels} channels` : null;
}
