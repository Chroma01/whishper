import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const testState = vi.hoisted(() => ({ dataRoot: "" }));

vi.mock("#lib/server/env.ts", () => ({
  privateEnv: {
    databaseFile: ":memory:",
    get dataRoot() {
      return testState.dataRoot;
    },
  },
}));

import { db } from "#lib/server/db/index.ts";
import { jobs, mediaDerivatives } from "#lib/server/db/schema.ts";
import {
  seedMember,
  seedProject,
  type SeededProject,
} from "#lib/server/db/testing/fixtures.ts";
import { removeAudioTrackCopyForUser } from "#lib/server/media/derivatives.ts";

beforeAll(async () => {
  testState.dataRoot = await mkdtemp(join(tmpdir(), "anysub-derivatives-"));
});
afterAll(() => rm(testState.dataRoot, { recursive: true, force: true }));

function seedDerivative(
  project: SeededProject,
  kind: "waveform" | "proxy" | "thumbnail",
  audioTrack: number,
): void {
  db.insert(mediaDerivatives)
    .values({
      projectId: project.projectId,
      kind,
      audioTrack,
      storageKey: `projects/${project.projectId}/${kind}/${audioTrack}`,
      sourceStorageKey: `projects/${project.projectId}/original.mkv`,
      mediaType: "application/octet-stream",
      sizeBytes: 1_024,
      schemaVersion: "1",
      generatorVersion: "1",
    })
    .run();
}

function remaining(): { kind: string; audioTrack: number }[] {
  return db
    .select({
      kind: mediaDerivatives.kind,
      audioTrack: mediaDerivatives.audioTrack,
    })
    .from(mediaDerivatives)
    .all();
}

function seedTwoTracks(): SeededProject {
  const project = seedProject();
  seedDerivative(project, "thumbnail", 0);
  seedDerivative(project, "waveform", 0);
  seedDerivative(project, "waveform", 1);
  seedDerivative(project, "proxy", 1);
  return project;
}

describe("removeAudioTrackCopyForUser", () => {
  it("refuses a plain member who did not create the project", async () => {
    const project = seedTwoTracks();
    const member = seedMember(project.workspaceId, "member");

    await expect(
      removeAudioTrackCopyForUser(project.projectId, 1, member),
    ).resolves.toBe(false);
    expect(remaining()).toHaveLength(4);
  });

  it("removes one track's waveform and preview and keeps the rest", async () => {
    const project = seedTwoTracks();

    await expect(
      removeAudioTrackCopyForUser(project.projectId, 1, project.userId),
    ).resolves.toBe(true);
    expect(remaining()).toEqual([
      { kind: "thumbnail", audioTrack: 0 },
      { kind: "waveform", audioTrack: 0 },
    ]);
  });

  it("stops the track's preparation so it does not come back", async () => {
    const project = seedTwoTracks();
    const queue = (audioTrack: number) =>
      db
        .insert(jobs)
        .values({
          workspaceId: project.workspaceId,
          projectId: project.projectId,
          kind: "media_prepare",
          payload: {
            kind: "media_prepare",
            projectId: project.projectId,
            sourceStorageKey: "original.mkv",
            sourceFilename: "original.mkv",
            audioTrack,
          },
        })
        .run();
    queue(0);
    queue(1);

    await removeAudioTrackCopyForUser(project.projectId, 1, project.userId);

    expect(
      db
        .select({ state: jobs.state, payload: jobs.payload })
        .from(jobs)
        .all()
        .map(({ state, payload }) => [
          (payload as { audioTrack?: number }).audioTrack,
          state,
        ])
        .sort(),
    ).toEqual([
      [0, "queued"],
      [1, "cancelled"],
    ]);
  });
});
