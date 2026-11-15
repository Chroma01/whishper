import { describe, expect, it } from "vitest";

import { seedProject, seedTrack } from "#lib/server/db/testing/fixtures.ts";
import { exportTrackForUser } from "#lib/server/subtitles/export.ts";

function exportedFilename(format: string, mediaFilename?: string) {
  const project = seedProject({ mediaFilename });
  const trackId = seedTrack(project.projectId);
  return exportTrackForUser(
    project.userId,
    project.projectId,
    trackId,
    format,
  ).headers.get("Content-Disposition");
}

describe("track export file names", () => {
  it("names an LRC file after the uploaded song so players find it", () => {
    expect(exportedFilename("lrc", "01 Don't Stop (Live).mp3")).toBe(
      `attachment; filename="01 Don't Stop (Live).lrc"; filename*=UTF-8''01%20Don%27t%20Stop%20%28Live%29.lrc`,
    );
  });

  it("names other formats after the project and language", () => {
    expect(exportedFilename("srt", "01 Don't Stop (Live).mp3")).toBe(
      `attachment; filename="Project-en.srt"; filename*=UTF-8''Project-en.srt`,
    );
  });

  it("names an LRC file after the project without an uploaded file name", () => {
    expect(exportedFilename("lrc")).toBe(
      `attachment; filename="Project-en.lrc"; filename*=UTF-8''Project-en.lrc`,
    );
  });

  it("keeps quotes and accents out of the plain file name", () => {
    expect(exportedFilename("lrc", 'Café "Live".flac')).toBe(
      `attachment; filename="Cafe- -Live.lrc"; filename*=UTF-8''Caf%C3%A9%20%22Live%22.lrc`,
    );
  });
});
