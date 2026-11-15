import type { MediaDerivativeKind } from "@anysub/contracts";

export const TRACK_EXPORT_FORMATS = [
  "srt",
  "vtt",
  "lrc",
  "txt",
  "json",
] as const;
export type TrackExportFormat = (typeof TRACK_EXPORT_FORMATS)[number];

export function isTrackExportFormat(value: string): value is TrackExportFormat {
  return (TRACK_EXPORT_FORMATS as readonly string[]).includes(value);
}

// Without a transcript, the studio opens the newest one.
export function projectPageUrl(projectId: string, trackId?: string): string {
  return trackId
    ? `/projects/${projectId}/${trackId}`
    : `/projects/${projectId}`;
}

function projectApiUrl(projectId: string): string {
  return `/api/projects/${projectId}`;
}

export function projectMediaUrl(projectId: string): string {
  return `${projectApiUrl(projectId)}/media`;
}

export function projectStatusUrl(projectId: string): string {
  return `${projectApiUrl(projectId)}/status`;
}

export function projectDerivativeUrl(
  projectId: string,
  kind: MediaDerivativeKind,
  audioTrack = 0,
): string {
  const url = `${projectApiUrl(projectId)}/derivatives/${kind}`;
  return audioTrack === 0 ? url : `${url}?audioTrack=${audioTrack}`;
}

export function trackUrl(projectId: string, trackId: string): string {
  return `${projectApiUrl(projectId)}/tracks/${trackId}`;
}

export function trackExportUrl(
  projectId: string,
  trackId: string,
  format: TrackExportFormat,
): string {
  return `${trackUrl(projectId, trackId)}/export/${format}`;
}
