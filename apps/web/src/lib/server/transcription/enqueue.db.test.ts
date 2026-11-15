import { randomUUID } from "node:crypto";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { AdapterModel, TranscriptionJobPayload } from "@anysub/contracts";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { db } from "#lib/server/db/index.ts";
import { jobs, projects, transcriptionRuns } from "#lib/server/db/schema.ts";
import { seedProject } from "#lib/server/db/testing/fixtures.ts";
import { updateInstanceSettings } from "#lib/server/settings/instance.ts";
import { enqueueTranscription } from "#lib/server/transcription/enqueue.ts";
import {
  connectWorker as connectManifest,
  enqueueRemote,
  onlyJob,
  remoteWorker,
  seedRemoteModel,
  TEST_API_KEY,
} from "#lib/server/db/testing/remote.ts";
import { workerArtifactsPath } from "#lib/server/storage/paths.ts";
import { recordWorkerPresence } from "#lib/server/workers/presence.ts";

function connectWorker(optionsSchema: Record<string, unknown>): void {
  const model: AdapterModel = {
    id: "small",
    displayName: "Small",
    capabilities: ["transcribe"],
    languages: "all",
    description: null,
    parameterCount: null,
    requiredVramBytes: null,
    recommendedRamBytes: null,
    downloadSizeBytes: null,
    downloaded: true,
    optionsSchema,
  };
  recordWorkerPresence(db, {
    protocolVersion: "1.1",
    workerId: randomUUID(),
    name: "local-worker",
    version: "1.0.0",
    architecture: "x86_64",
    capabilities: {
      mediaPreparation: null,
      modelCache: null,
      remoteTranscription: null,
    },
    adapters: [
      {
        protocolVersion: "1.1",
        id: "whisperx",
        displayName: "WhisperX",
        version: "1.0.0",
        description: null,
        models: [model],
      },
    ],
    hardware: null,
    modelStorage: null,
  });
}

async function transcribe(): Promise<TranscriptionJobPayload["options"]> {
  const project = seedProject({ mediaOriginalKey: "media/source.wav" });
  await enqueueTranscription(project.projectId, project.userId, {
    adapterId: "whisperx",
    modelId: "small",
    language: null,
    audioTrack: null,
    options: { alignment: true, maxLineLength: 42 },
  });
  const job = db.select({ payload: jobs.payload }).from(jobs).get();
  if (job?.payload.kind !== "transcribe") throw new Error("Expected a job");
  return job.payload.options;
}

describe("enqueueTranscription", () => {
  it("applies the administrator's precision to adapters that offer it", async () => {
    connectWorker({ properties: { precision: { type: "string" } } });
    updateInstanceSettings({ precision: "precise" });

    expect(await transcribe()).toEqual({
      alignment: true,
      maxLineLength: 42,
      precision: "precise",
    });
  });

  it("leaves precision out for adapters without it", async () => {
    connectWorker({ properties: {} });
    updateInstanceSettings({ precision: "memory" });

    expect(await transcribe()).not.toHaveProperty("precision");
  });
});

function projectWithTwoAudioTracks() {
  const project = seedProject({ mediaOriginalKey: "media/episode.mkv" });
  const audio = (index: number, language: string) => ({
    index,
    type: "audio",
    codec: "aac",
    language,
    title: null,
    audio: { channels: 2, channelLayout: "stereo" },
  });
  db.update(projects)
    .set({
      mediaFilename: "episode.mkv",
      mediaPreparationStatus: "completed",
      mediaProbe: { streams: [audio(1, "jpn"), audio(2, "eng")] },
    })
    .where(eq(projects.id, project.projectId))
    .run();
  return project;
}

function transcribeTrack(
  project: { projectId: string; userId: string },
  audioTrack: number | null,
) {
  return enqueueTranscription(project.projectId, project.userId, {
    adapterId: "whisperx",
    modelId: "small",
    language: null,
    audioTrack,
    options: { alignment: true, maxLineLength: 42 },
  });
}

function jobsOf(projectId: string, kind: "transcribe" | "media_prepare") {
  return db
    .select({ state: jobs.state, payload: jobs.payload })
    .from(jobs)
    .where(and(eq(jobs.projectId, projectId), eq(jobs.kind, kind)))
    .all();
}

function queuePreparation(
  project: { workspaceId: string; projectId: string },
  audioTrack: number,
): string {
  return db
    .insert(jobs)
    .values({
      workspaceId: project.workspaceId,
      projectId: project.projectId,
      kind: "media_prepare",
      payload: {
        kind: "media_prepare",
        projectId: project.projectId,
        sourceStorageKey: "media/episode.mkv",
        sourceFilename: "episode.mkv",
        audioTrack,
      },
    })
    .returning({ id: jobs.id })
    .get().id;
}

describe("enqueueTranscription with an audio track", () => {
  it("prepares the chosen track and leaves other preparations running", async () => {
    connectWorker({ properties: {} });
    const project = projectWithTwoAudioTracks();
    const running = queuePreparation(project, 0);
    const staged = workerArtifactsPath(running);
    await mkdir(staged, { recursive: true });
    await writeFile(join(staged, "preview.mp4"), "partial");

    await transcribeTrack(project, 1);

    expect(jobsOf(project.projectId, "media_prepare")).toEqual([
      expect.objectContaining({
        state: "queued",
        payload: expect.objectContaining({ audioTrack: 0 }),
      }),
      expect.objectContaining({
        state: "queued",
        payload: expect.objectContaining({ audioTrack: 1 }),
      }),
    ]);
    expect(jobsOf(project.projectId, "transcribe")).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({ audioTrack: 1 }),
      }),
    ]);
    await expect(stat(staged)).resolves.toBeDefined();
  });

  it("transcribes the first track when the request names none", async () => {
    connectWorker({ properties: {} });
    const project = projectWithTwoAudioTracks();
    queuePreparation(project, 0);

    await transcribeTrack(project, null);

    expect(jobsOf(project.projectId, "media_prepare")).toHaveLength(1);
    expect(jobsOf(project.projectId, "transcribe")).toEqual([
      expect.objectContaining({
        payload: expect.objectContaining({ audioTrack: 0 }),
      }),
    ]);
  });

  it("waits for media preparation to read the file's tracks", async () => {
    connectWorker({ properties: {} });
    const project = seedProject({ mediaOriginalKey: "media/episode.mkv" });

    await expect(transcribeTrack(project, 1)).rejects.toThrow(
      "not known until media preparation reads it",
    );
  });

  it("refuses a track the file does not have", async () => {
    connectWorker({ properties: {} });
    const project = projectWithTwoAudioTracks();

    await expect(transcribeTrack(project, 2)).rejects.toThrow(
      "The file has no audio track 3.",
    );

    expect(
      db
        .select()
        .from(transcriptionRuns)
        .where(eq(transcriptionRuns.projectId, project.projectId))
        .all(),
    ).toEqual([]);
  });
});

describe("enqueueTranscription of a file without audio", () => {
  it("says the file has no audio", async () => {
    connectWorker({ properties: {} });
    const project = projectWithTwoAudioTracks();
    db.update(projects)
      .set({ mediaProbe: { streams: [{ index: 0, type: "video" }] } })
      .where(eq(projects.id, project.projectId))
      .run();

    await expect(transcribeTrack(project, 0)).rejects.toThrow(
      "The file has no audio.",
    );
  });
});

describe("enqueueTranscription with a remote model", () => {
  it("queue with only the options they take", async () => {
    connectManifest(remoteWorker(true));
    const { modelId } = seedRemoteModel();

    await enqueueRemote(modelId);

    const job = onlyJob();
    if (job.payload.kind !== "transcribe") throw new Error("Expected a job");
    expect(job.payload.options).toEqual({ maxLineLength: 32 });
    expect(JSON.stringify(job.payload)).not.toContain(TEST_API_KEY);
  });
});
