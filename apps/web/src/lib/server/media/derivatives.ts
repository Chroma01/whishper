import { unlink } from "node:fs/promises";

import type { MediaDerivativeKind } from "@anysub/contracts";
import { and, eq, inArray } from "drizzle-orm";

import { db, type Executor } from "#lib/server/db/index.ts";
import { jobs, mediaDerivatives } from "#lib/server/db/schema.ts";
import { withTransaction } from "#lib/server/db/transaction.ts";
import { cancelActiveJobs } from "#lib/server/jobs/release.ts";
import { cleanupStagedMediaArtifacts } from "#lib/server/media/artifact-staging.ts";
import { activePreparation } from "#lib/server/media/preparation.ts";
import { manageableProjectForUser } from "#lib/server/projects/access.ts";
import { resolveDataPath } from "#lib/server/storage/paths.ts";
import { GIB, MAX_UPLOAD_LIMIT_GIB } from "#lib/shared/instance-settings.ts";

type DerivativeFormat = {
  directory: string;
  maxBytes: number;
  extensionByMediaType: Readonly<Record<string, string>>;
};

export const DERIVATIVE_FORMATS: Record<MediaDerivativeKind, DerivativeFormat> =
  {
    waveform: {
      directory: "waveform",
      maxBytes: 64 * 1024 * 1024,
      extensionByMediaType: { "application/vnd.anysub.waveform+json": ".json" },
    },
    thumbnail: {
      directory: "thumbnails",
      maxBytes: 16 * 1024 * 1024,
      extensionByMediaType: { "image/jpeg": ".jpg" },
    },
    proxy: {
      directory: "proxy",
      // A preview is never larger than the largest source an upload may be.
      maxBytes: MAX_UPLOAD_LIMIT_GIB * GIB,
      extensionByMediaType: { "video/mp4": ".mp4", "audio/mpeg": ".mp3" },
    },
  };

// The thumbnail comes from the picture alone, so it is stored as track 0.
export const AUDIO_DERIVATIVE_KINDS: MediaDerivativeKind[] = [
  "waveform",
  "proxy",
];

export function derivativeAudioTrack(
  kind: MediaDerivativeKind,
  audioTrack: number,
): number {
  return AUDIO_DERIVATIVE_KINDS.includes(kind) ? audioTrack : 0;
}

// Every file with audio gets a waveform, so it marks a prepared track.
export function hasAudioTrackCopy(
  executor: Executor,
  projectId: string,
  audioTrack: number,
): boolean {
  return (
    executor
      .select({ id: mediaDerivatives.id })
      .from(mediaDerivatives)
      .where(
        and(
          eq(mediaDerivatives.projectId, projectId),
          eq(mediaDerivatives.kind, "waveform"),
          eq(mediaDerivatives.audioTrack, audioTrack),
          eq(mediaDerivatives.status, "ready"),
        ),
      )
      .get() !== undefined
  );
}

export function isMediaDerivativeKind(
  value: string,
): value is MediaDerivativeKind {
  return Object.hasOwn(DERIVATIVE_FORMATS, value);
}

export function derivativeExtension(
  kind: MediaDerivativeKind,
  mediaType: string,
): string | null {
  const { extensionByMediaType } = DERIVATIVE_FORMATS[kind];
  return Object.hasOwn(extensionByMediaType, mediaType)
    ? extensionByMediaType[mediaType]
    : null;
}

export function derivativeMediaType(
  kind: MediaDerivativeKind,
  stored: string,
): string {
  return derivativeExtension(kind, stored) === null
    ? "application/octet-stream"
    : stored;
}

export function readyDerivativeFile(
  projectId: string,
  kind: MediaDerivativeKind,
  audioTrack: number,
): { storageKey: string; mediaType: string } | null {
  const derivative = db
    .select({
      storageKey: mediaDerivatives.storageKey,
      mediaType: mediaDerivatives.mediaType,
    })
    .from(mediaDerivatives)
    .where(
      and(
        eq(mediaDerivatives.projectId, projectId),
        eq(mediaDerivatives.kind, kind),
        eq(mediaDerivatives.audioTrack, derivativeAudioTrack(kind, audioTrack)),
        eq(mediaDerivatives.status, "ready"),
      ),
    )
    .get();
  return derivative ?? null;
}

// Removes a track's waveform and preview, and stops a preparation that would
// bring them back. The track can be prepared again.
export async function removeAudioTrackCopyForUser(
  projectId: string,
  audioTrack: number,
  userId: string,
): Promise<boolean> {
  const removed = withTransaction((tx) => {
    if (!manageableProjectForUser(tx, projectId, userId)) return null;
    const preparation = activePreparation(tx, projectId, audioTrack);
    if (preparation) cancelActiveJobs(tx, eq(jobs.id, preparation.id));
    const storageKeys = tx
      .delete(mediaDerivatives)
      .where(
        and(
          eq(mediaDerivatives.projectId, projectId),
          inArray(mediaDerivatives.kind, AUDIO_DERIVATIVE_KINDS),
          eq(mediaDerivatives.audioTrack, audioTrack),
        ),
      )
      .returning({ storageKey: mediaDerivatives.storageKey })
      .all()
      .map(({ storageKey }) => storageKey);
    return { storageKeys, cancelledJob: preparation?.id ?? null };
  });
  if (!removed) return false;
  const { storageKeys, cancelledJob } = removed;
  await Promise.all([
    ...storageKeys.map((storageKey) =>
      unlink(resolveDataPath(storageKey)).catch(() => undefined),
    ),
    cancelledJob ? cleanupStagedMediaArtifacts(cancelledJob) : null,
  ]);
  return storageKeys.length > 0 || cancelledJob !== null;
}
