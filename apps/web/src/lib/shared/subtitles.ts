export type SubtitleTrack = {
  id: string;
  name: string;
  language: string;
  metadata: Record<string, unknown>;
  revision: number;
};

export type SubtitleTrackSummary = {
  id: string;
  name: string;
  language: string;
  cueCount: number;
  runId: string | null;
  // Null for transcripts made before Anysub recorded the audio track.
  audioTrack: number | null;
  createdAt: Date;
};

export type SubtitleCueSnapshot = {
  id: string;
  position: number;
  startUs: number;
  endUs: number;
  text: string;
  words?: Record<string, unknown>[];
};

// Long enough for an instrumental break, so a breath between sung lines keeps
// the previous line up instead of adding a blank one.
const MIN_LRC_PAUSE_US = 5_000_000;

export function formatEditorTime(microseconds: number): string {
  return formatSubtitleTime(microseconds, ".");
}

// Accepts plain seconds ("62.5") as well as MM:SS and HH:MM:SS forms, so
// times pasted from other tools parse without retyping.
export function parseEditorTime(value: string): number | null {
  const match = value
    .trim()
    .match(/^(?:(?:(\d+):)?(\d{1,2}):)?(\d+)(?:[.,](\d{1,3}))?$/);
  if (!match) return null;
  const [, hoursPart, minutesPart, secondsPart, fractionPart] = match;
  const hours = Number(hoursPart ?? 0);
  const minutes = Number(minutesPart ?? 0);
  const seconds = Number(secondsPart);
  const milliseconds = Number((fractionPart ?? "0").padEnd(3, "0"));
  if (minutes > 59) return null;
  if (minutesPart !== undefined && (secondsPart.length !== 2 || seconds > 59)) {
    return null;
  }
  return (
    ((hours * 3_600 + minutes * 60 + seconds) * 1_000 + milliseconds) * 1_000
  );
}

export function renderSrt(cues: SubtitleCueSnapshot[]): string {
  return `${cues
    .map(
      (cue, index) =>
        `${index + 1}\n${formatSubtitleTime(cue.startUs, ",")} --> ${formatSubtitleTime(cue.endUs, ",")}\n${normalizeCueText(cue.text).replaceAll("-->", "->")}`,
    )
    .join("\n\n")}\n`;
}

export function renderWebVtt(cues: SubtitleCueSnapshot[]): string {
  return `WEBVTT\n\n${cues
    .map(
      (cue) =>
        `${formatSubtitleTime(cue.startUs, ".")} --> ${formatSubtitleTime(cue.endUs, ".")}\n${escapeWebVttText(normalizeCueText(cue.text))}`,
    )
    .join("\n\n")}\n`;
}

export function renderPlainText(cues: SubtitleCueSnapshot[]): string {
  const lines = cues.map((cue) => singleLineText(cue.text)).filter(Boolean);
  return lines.length ? `${lines.join("\n")}\n` : "";
}

// An LRC line has no end time and shows until the next timestamp. A blank
// timestamped line clears a cue's text when a pause follows it.
export function renderLrc(cues: SubtitleCueSnapshot[]): string {
  const timed = cues
    .map((cue) => ({ ...cue, text: singleLineText(cue.text) }))
    .filter((cue) => cue.text)
    .sort((first, second) => first.startUs - second.startUs);
  const lines = timed.flatMap((cue, index) => {
    const line = `${formatLrcTime(cue.startUs)}${cue.text}`;
    const next = timed[index + 1];
    const pausesAfter = !next || next.startUs - cue.endUs >= MIN_LRC_PAUSE_US;
    return pausesAfter ? [line, formatLrcTime(cue.endUs)] : [line];
  });
  return lines.length ? `${lines.join("\n")}\n` : "";
}

function formatSubtitleTime(
  microseconds: number,
  separator: "." | ",",
): string {
  const milliseconds = Math.max(0, Math.floor(microseconds / 1_000));
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const seconds = Math.floor((milliseconds % 60_000) / 1_000);
  const remainder = milliseconds % 1_000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}${separator}${String(remainder).padStart(3, "0")}`;
}

function formatLrcTime(microseconds: number): string {
  const centiseconds = Math.max(0, Math.floor(microseconds / 10_000));
  const minutes = Math.floor(centiseconds / 6_000);
  const seconds = Math.floor((centiseconds % 6_000) / 100);
  return `[${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(centiseconds % 100).padStart(2, "0")}]`;
}

// Cue line breaks only exist for subtitle wrapping, so transcripts and lyrics
// read as one line per cue.
function singleLineText(value: string): string {
  return normalizeCueText(value).replace(/\s*\n\s*/g, " ");
}

function normalizeCueText(value: string): string {
  return value
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .replace(/\n[ \t]*(?:\n[ \t]*)+/g, "\n")
    .trim();
}

function escapeWebVttText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
