import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  cancelTranscription,
  startTranscription,
  transcriptionForUser,
} from "#lib/server/api/transcriptions.ts";
import { TranscriptionRequestSchema } from "#lib/server/api/schemas.ts";
import { db } from "#lib/server/db/index.ts";
import {
  jobs,
  projects,
  subtitleTracks,
  transcriptionRuns,
} from "#lib/server/db/schema.ts";
import { seedMember, seedProject } from "#lib/server/db/testing/fixtures.ts";
import {
  connectWorker,
  remoteWorker,
  seedRemoteModel,
} from "#lib/server/db/testing/remote.ts";
import { updateInstanceSettings } from "#lib/server/settings/instance.ts";
import { REMOTE_ADAPTER_ID } from "#lib/shared/transcription-models.ts";

function readyProject() {
  connectWorker(remoteWorker(true));
  const { modelId } = seedRemoteModel(6_000);
  const project = seedProject({ mediaOriginalKey: "media/source.mp4" });
  return { ...project, model: `${REMOTE_ADAPTER_ID}:${modelId}` };
}

describe("API transcriptions", () => {
  it("start with the server's defaults for options left out", async () => {
    const project = readyProject();
    updateInstanceSettings({ maxLineLength: 36, language: "de" });

    const run = await startTranscription(project.userId, project.projectId, {
      model: project.model,
    });

    expect(run).toMatchObject({ status: "queued", model: project.model });
    const job = db.select().from(jobs).where(eq(jobs.runId, run.id)).get();
    if (job?.payload.kind !== "transcribe") throw new Error("Expected a job");
    expect(job.payload).toMatchObject({
      language: "de",
      options: { maxLineLength: 36 },
    });
  });

  it("send a trimmed prompt, and leave out a blank one", async () => {
    const project = readyProject();
    const optionsFor = async (prompt: string) => {
      const run = await startTranscription(
        project.userId,
        project.projectId,
        TranscriptionRequestSchema.parse({ model: project.model, prompt }),
      );
      cancelTranscription(project.userId, project.projectId, run.id);
      const job = db.select().from(jobs).where(eq(jobs.runId, run.id)).get();
      if (job?.payload.kind !== "transcribe") throw new Error("Expected a job");
      return job.payload.options;
    };

    expect(await optionsFor("  Anysub, WhisperX ")).toMatchObject({
      prompt: "Anysub, WhisperX",
    });
    expect(await optionsFor("   ")).not.toHaveProperty("prompt");
  });

  it("transcribe the audio track asked for", async () => {
    const project = readyProject();
    const audio = { type: "audio", codec: "aac" };
    db.update(projects)
      .set({
        mediaFilename: "source.mp4",
        mediaProbe: {
          streams: [
            { index: 1, ...audio },
            { index: 2, ...audio },
          ],
        },
      })
      .where(eq(projects.id, project.projectId))
      .run();

    const run = await startTranscription(
      project.userId,
      project.projectId,
      TranscriptionRequestSchema.parse({ model: project.model, audioTrack: 1 }),
    );

    const job = db.select().from(jobs).where(eq(jobs.runId, run.id)).get();
    expect(job?.payload).toMatchObject({ audioTrack: 1 });
    expect(() =>
      TranscriptionRequestSchema.parse({
        model: project.model,
        audioTrack: -1,
      }),
    ).toThrow();
  });

  it("refuse options the model does not take", async () => {
    const project = readyProject();

    await expect(
      startTranscription(project.userId, project.projectId, {
        model: project.model,
        alignment: true,
      }),
    ).rejects.toThrow("alignment:");
  });

  it("refuse models no connected worker offers", async () => {
    const project = readyProject();

    await expect(
      startTranscription(project.userId, project.projectId, {
        model: "whisperx:large-v3",
      }),
    ).rejects.toThrow("No connected worker offers that model");
  });

  it("are visible to workspace members only", async () => {
    const project = readyProject();
    const member = seedMember(project.workspaceId, "member");
    const stranger = seedProject();
    const run = await startTranscription(member, project.projectId, {
      model: project.model,
    });

    expect(
      transcriptionForUser(project.userId, project.projectId, run.id).id,
    ).toBe(run.id);
    expect(() =>
      transcriptionForUser(stranger.userId, project.projectId, run.id),
    ).toThrow("Project not found.");
  });

  it("report their track and estimated cost once completed", async () => {
    const project = readyProject();
    const run = await startTranscription(project.userId, project.projectId, {
      model: project.model,
    });
    db.update(transcriptionRuns)
      .set({
        status: "completed",
        estimatedCostMicros: 15_000,
        completedAt: new Date(),
      })
      .where(eq(transcriptionRuns.id, run.id))
      .run();
    const track = db
      .insert(subtitleTracks)
      .values({
        projectId: project.projectId,
        sourceRunId: run.id,
        name: "T",
        language: "en",
      })
      .returning({ id: subtitleTracks.id })
      .get();

    expect(
      transcriptionForUser(project.userId, project.projectId, run.id),
    ).toMatchObject({
      status: "completed",
      trackId: track.id,
      estimatedCostUsd: 0.015,
    });
  });

  it("cancel only while active", async () => {
    const project = readyProject();
    const run = await startTranscription(project.userId, project.projectId, {
      model: project.model,
    });

    expect(
      cancelTranscription(project.userId, project.projectId, run.id).status,
    ).toBe("cancelled");
    expect(() =>
      cancelTranscription(project.userId, project.projectId, run.id),
    ).toThrow("already finished");
  });
});
