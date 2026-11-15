import { mkdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { db } from "#lib/server/db/index.ts";
import { jobs, projects } from "#lib/server/db/schema.ts";
import { withTransaction } from "#lib/server/db/transaction.ts";
import {
  seedProject,
  type SeededProject,
} from "#lib/server/db/testing/fixtures.ts";
import {
  cancelMediaPreparationForUser,
  enqueueMediaPreparation,
  requestMediaPreparationForUser,
} from "#lib/server/media/preparation.ts";
import { workerArtifactsPath } from "#lib/server/storage/paths.ts";

const SOURCE = "originals/episode.mkv";
const AUDIO = { type: "audio", codec: "aac" };

function seedMediaProject(read: boolean): SeededProject {
  const project = seedProject({
    mediaOriginalKey: SOURCE,
    mediaFilename: "episode.mkv",
  });
  if (read) {
    db.update(projects)
      .set({
        mediaPreparationStatus: "completed",
        mediaProbe: {
          streams: [
            { index: 0, ...AUDIO },
            { index: 1, ...AUDIO },
          ],
        },
      })
      .where(eq(projects.id, project.projectId))
      .run();
  }
  return project;
}

function enqueue(project: SeededProject, audioTrack: number): string {
  return withTransaction((tx) =>
    enqueueMediaPreparation(tx, {
      workspaceId: project.workspaceId,
      projectId: project.projectId,
      sourceStorageKey: SOURCE,
      audioTrack,
    }),
  );
}

function preparationStatus(projectId: string) {
  return db
    .select({ status: projects.mediaPreparationStatus })
    .from(projects)
    .where(eq(projects.id, projectId))
    .get()?.status;
}

function jobStates(projectId: string) {
  return db
    .select({ state: jobs.state, payload: jobs.payload })
    .from(jobs)
    .where(and(eq(jobs.projectId, projectId), eq(jobs.kind, "media_prepare")))
    .all()
    .map(({ state, payload }) => ({
      state,
      audioTrack: (payload as { audioTrack?: number }).audioTrack,
    }));
}

describe("enqueueMediaPreparation", () => {
  it("queues one preparation per audio track", () => {
    const project = seedMediaProject(true);

    const first = enqueue(project, 1);
    expect(enqueue(project, 1)).toBe(first);
    expect(enqueue(project, 0)).not.toBe(first);

    expect(jobStates(project.projectId)).toEqual([
      { state: "queued", audioTrack: 1 },
      { state: "queued", audioTrack: 0 },
    ]);
  });

  it("keeps a read project ready while a track prepares", () => {
    const read = seedMediaProject(true);
    const unread = seedMediaProject(false);

    enqueue(read, 1);
    enqueue(unread, 0);

    expect(preparationStatus(read.projectId)).toBe("completed");
    expect(preparationStatus(unread.projectId)).toBe("queued");
  });
});

describe("requestMediaPreparationForUser", () => {
  it("refuses a track the file does not have", () => {
    const read = seedMediaProject(true);
    const unread = seedMediaProject(false);

    expect(() =>
      requestMediaPreparationForUser(read.projectId, read.userId, 2),
    ).toThrow("The file has no audio track 3.");
    expect(() =>
      requestMediaPreparationForUser(unread.projectId, unread.userId, 1),
    ).toThrow("The file has no audio track 2.");
    expect(jobStates(read.projectId)).toEqual([]);
  });
});

describe("cancelMediaPreparationForUser", () => {
  it("cancels only that track's preparation and removes its staged files", async () => {
    const project = seedMediaProject(true);
    const jobId = enqueue(project, 1);
    enqueue(project, 0);
    const staged = workerArtifactsPath(jobId);
    await mkdir(staged, { recursive: true });
    await writeFile(join(staged, "preview.mp4"), "partial");

    await expect(
      cancelMediaPreparationForUser(project.projectId, project.userId, 1),
    ).resolves.toBe(true);

    expect(jobStates(project.projectId)).toEqual([
      { state: "cancelled", audioTrack: 1 },
      { state: "queued", audioTrack: 0 },
    ]);
    expect(preparationStatus(project.projectId)).toBe("completed");
    await expect(stat(staged)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("returns a file nothing has read to not started", async () => {
    const project = seedMediaProject(false);
    enqueue(project, 0);

    await cancelMediaPreparationForUser(project.projectId, project.userId, 0);

    expect(preparationStatus(project.projectId)).toBe("not_started");
  });

  it("reports when the track has no preparation under way", async () => {
    const project = seedMediaProject(true);
    enqueue(project, 0);

    await expect(
      cancelMediaPreparationForUser(project.projectId, project.userId, 1),
    ).resolves.toBe(false);
  });
});
