import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { db } from "#lib/server/db/index.ts";
import { jobs, mediaDerivatives, projects } from "#lib/server/db/schema.ts";
import { withTransaction } from "#lib/server/db/transaction.ts";
import {
  seedProject,
  type SeededProject,
} from "#lib/server/db/testing/fixtures.ts";
import { prepareTranscriptAudio } from "#lib/server/media/audio-track.ts";

const SOURCE = "originals/film.mkv";

function seedTwoTrackProject(read = true): SeededProject {
  const project = seedProject({
    mediaOriginalKey: SOURCE,
    mediaFilename: "film.mkv",
  });
  if (read) {
    const audio = { type: "audio", codec: "aac" };
    db.update(projects)
      .set({
        mediaPreparationStatus: "completed",
        mediaProbe: {
          streams: [
            { index: 1, ...audio },
            { index: 2, ...audio },
          ],
        },
      })
      .where(eq(projects.id, project.projectId))
      .run();
  }
  return project;
}

function seedWaveform(projectId: string, audioTrack: number): void {
  db.insert(mediaDerivatives)
    .values({
      projectId,
      kind: "waveform",
      audioTrack,
      storageKey: `projects/${projectId}/waveform/${audioTrack}.json`,
      sourceStorageKey: SOURCE,
      mediaType: "application/vnd.anysub.waveform+json",
      sizeBytes: 1_024,
      schemaVersion: "1",
      generatorVersion: "1",
    })
    .run();
}

function prepare(project: SeededProject, audioTrack: number): void {
  withTransaction((tx) =>
    prepareTranscriptAudio(
      tx,
      {
        id: project.projectId,
        workspaceId: project.workspaceId,
        sourceStorageKey: SOURCE,
      },
      audioTrack,
    ),
  );
}

function preparedTracks(projectId: string): unknown[] {
  return db
    .select({ payload: jobs.payload })
    .from(jobs)
    .where(and(eq(jobs.projectId, projectId), eq(jobs.kind, "media_prepare")))
    .all()
    .map(({ payload }) => (payload as { audioTrack?: number }).audioTrack);
}

describe("prepareTranscriptAudio", () => {
  it("prepares a track that has no waveform yet", () => {
    const project = seedTwoTrackProject();
    seedWaveform(project.projectId, 0);

    prepare(project, 1);

    expect(preparedTracks(project.projectId)).toEqual([1]);
    expect(
      db
        .select({ audioTrack: mediaDerivatives.audioTrack })
        .from(mediaDerivatives)
        .all(),
    ).toEqual([{ audioTrack: 0 }]);
  });

  it("leaves a prepared track alone", () => {
    const project = seedTwoTrackProject();
    seedWaveform(project.projectId, 1);

    prepare(project, 1);

    expect(preparedTracks(project.projectId)).toEqual([]);
  });

  it("leaves the first track to the preparation that reads the file", () => {
    const project = seedTwoTrackProject(false);

    prepare(project, 0);

    expect(preparedTracks(project.projectId)).toEqual([]);
    expect(() => prepare(project, 1)).toThrow(
      "The file's audio tracks are not known until media preparation reads it.",
    );
  });

  it("refuses a track the file does not have", () => {
    const project = seedTwoTrackProject();

    expect(() => prepare(project, 2)).toThrow("The file has no audio track 3.");
  });
});
