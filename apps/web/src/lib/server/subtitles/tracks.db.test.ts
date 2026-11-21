import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { db } from "#lib/server/db/index.ts";
import {
  cues,
  subtitleTracks,
  transcriptionRuns,
} from "#lib/server/db/schema.ts";
import { seedProject } from "#lib/server/db/testing/fixtures.ts";
import { listProjectTracks } from "#lib/server/subtitles/tracks.ts";

function seedTranscript(
  projectId: string,
  fields: {
    language: string;
    createdAt: Date;
    metadata?: { audioTrack: number };
  },
): string {
  return db
    .insert(subtitleTracks)
    .values({ projectId, name: "whisperx · small", ...fields })
    .returning({ id: subtitleTracks.id })
    .get().id;
}

describe("listProjectTracks", () => {
  it("lists a project's transcripts oldest first, with their audio track", () => {
    const project = seedProject();
    const other = seedProject();
    const spanish = seedTranscript(project.projectId, {
      language: "es",
      createdAt: new Date(2_000),
      metadata: { audioTrack: 1 },
    });
    const english = seedTranscript(project.projectId, {
      language: "en",
      createdAt: new Date(1_000),
    });
    seedTranscript(other.projectId, { language: "de", createdAt: new Date(0) });
    db.insert(cues)
      .values(
        ["Hola", "Adiós"].map((text, position) => ({
          trackId: spanish,
          position,
          startUs: position * 1_000,
          endUs: position * 1_000 + 500,
          text,
        })),
      )
      .run();

    expect(listProjectTracks(db, project.projectId)).toEqual([
      {
        id: english,
        name: "whisperx · small",
        language: "en",
        cueCount: 0,
        revision: 0,
        runId: null,
        madeBy: null,
        modelKey: null,
        audioTrack: null,
        translatedFrom: null,
        createdAt: new Date(1_000),
      },
      expect.objectContaining({ id: spanish, cueCount: 2, audioTrack: 1 }),
    ]);
  });

  it("names the model that made each transcript, and a translation's source", () => {
    const project = seedProject();
    const runId = db
      .insert(transcriptionRuns)
      .values({
        projectId: project.projectId,
        adapterId: "whisperx",
        modelId: "small",
        createdBy: project.userId,
      })
      .returning({ id: transcriptionRuns.id })
      .get().id;
    const original = db
      .insert(subtitleTracks)
      .values({
        projectId: project.projectId,
        sourceRunId: runId,
        name: "whisperx · small",
        language: "en",
        revision: 3,
      })
      .returning({ id: subtitleTracks.id })
      .get().id;
    const translated = (language: string, local: boolean) =>
      db
        .insert(subtitleTracks)
        .values({
          projectId: project.projectId,
          name: "Translation",
          language,
          kind: "translation",
          metadata: {
            adapter: local
              ? { id: "madlad", version: "1", modelId: "madlad-400-3b" }
              : { id: "remote", version: "1", modelId: "gpt-test" },
            translation: {
              jobId: randomUUID(),
              sourceTrackId: original,
              sourceRevision: 2,
              sourceLanguage: "en",
              modelLabel: "Model",
              local,
            },
          },
        })
        .run();
    translated("es", true);
    translated("de", false);

    expect(
      listProjectTracks(db, project.projectId).map(
        ({ language, modelKey, translatedFrom }) => ({
          language,
          modelKey,
          translatedFrom,
        }),
      ),
    ).toEqual([
      { language: "en", modelKey: "whisperx:small", translatedFrom: null },
      {
        language: "es",
        modelKey: "madlad:madlad-400-3b",
        translatedFrom: { trackId: original, revision: 2 },
      },
      {
        language: "de",
        modelKey: "provider",
        translatedFrom: { trackId: original, revision: 2 },
      },
    ]);
  });

  it("keeps the order they were made in when two share a moment", () => {
    const project = seedProject();
    const createdAt = new Date(1_000);
    const first = seedTranscript(project.projectId, {
      language: "en",
      createdAt,
    });
    const second = seedTranscript(project.projectId, {
      language: "es",
      createdAt,
    });

    expect(
      listProjectTracks(db, project.projectId).map(({ id }) => id),
    ).toEqual([first, second]);
  });
});
