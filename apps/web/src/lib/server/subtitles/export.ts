import { extname } from "node:path";

import { db } from "#lib/server/db/index.ts";
import { notFound } from "#lib/server/http/errors.ts";
import {
  requireMemberProject,
  type MemberProject,
} from "#lib/server/projects/access.ts";
import { listTrackCues } from "#lib/server/subtitles/cues.ts";
import { trackForProject } from "#lib/server/subtitles/tracks.ts";
import {
  isTrackExportFormat,
  type TrackExportFormat,
} from "#lib/shared/routes.ts";
import {
  renderLrc,
  renderPlainText,
  renderSrt,
  renderWebVtt,
  type SubtitleCueSnapshot,
  type SubtitleTrack,
} from "#lib/shared/subtitles.ts";

const JSON_EXPORT_SCHEMA_VERSION = "1.0";

export function exportTrackForUser(
  userId: string,
  projectId: string,
  trackId: string,
  format: string,
): Response {
  if (!isTrackExportFormat(format)) throw notFound("Unknown export format.");
  const project = requireMemberProject(db, projectId, userId);
  const track = trackForProject(db, projectId, trackId);
  if (!track) throw notFound("Track not found.");
  return trackExportResponse(
    format,
    project,
    track,
    listTrackCues(db, trackId, { includeWords: true }),
  );
}

function trackExportResponse(
  format: TrackExportFormat,
  project: Pick<MemberProject, "id" | "name" | "mediaFilename">,
  track: SubtitleTrack,
  cues: SubtitleCueSnapshot[],
): Response {
  const baseName = downloadName(format, project, track);
  const asciiName =
    baseName
      .normalize("NFKD")
      .replace(/(?:[^\x20-\x7e]|["\\])+/g, "-")
      .replace(/^-+|-+$/g, "") || "subtitles";
  const output = exportBody(format, project, track, cues);
  return new Response(output.body, {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": `attachment; filename="${asciiName}.${format}"; filename*=UTF-8''${encodeFilenameParameter(`${baseName}.${format}`)}`,
      "Content-Type": output.contentType,
    },
  });
}

function exportBody(
  format: TrackExportFormat,
  project: Pick<MemberProject, "id" | "name">,
  track: SubtitleTrack,
  cues: SubtitleCueSnapshot[],
) {
  if (format === "srt") {
    return {
      body: renderSrt(cues),
      contentType: "application/x-subrip; charset=utf-8",
    };
  }
  if (format === "vtt") {
    return { body: renderWebVtt(cues), contentType: "text/vtt; charset=utf-8" };
  }
  if (format === "lrc") {
    return { body: renderLrc(cues), contentType: "text/plain; charset=utf-8" };
  }
  if (format === "txt") {
    return {
      body: renderPlainText(cues),
      contentType: "text/plain; charset=utf-8",
    };
  }
  return {
    body: `${JSON.stringify(
      {
        schemaVersion: JSON_EXPORT_SCHEMA_VERSION,
        project: { id: project.id, name: project.name },
        track: {
          id: track.id,
          name: track.name,
          language: track.language,
          revision: track.revision,
          metadata: track.metadata,
        },
        cues,
      },
      null,
      2,
    )}\n`,
    contentType: "application/json; charset=utf-8",
  };
}

// Music players find lyrics by the song's file name, so an LRC file takes the
// uploaded file's name and can sit next to it.
function downloadName(
  format: TrackExportFormat,
  project: Pick<MemberProject, "name" | "mediaFilename">,
  track: SubtitleTrack,
): string {
  const filename = project.mediaFilename;
  if (format === "lrc" && filename) {
    return filename.slice(0, filename.length - extname(filename).length);
  }
  return safeFilename(`${project.name}-${track.language}`);
}

// RFC 5987 also escapes ' ( ) and *, which encodeURIComponent leaves as is.
function encodeFilenameParameter(value: string): string {
  return encodeURIComponent(value).replace(
    /['()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function safeFilename(value: string): string {
  return (
    value
      .normalize("NFC")
      .replace(/[^\p{L}\p{N}._-]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 120) || "subtitles"
  );
}
