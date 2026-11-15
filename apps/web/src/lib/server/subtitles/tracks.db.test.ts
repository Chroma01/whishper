import { describe, expect, it } from "vitest";

import { db } from "#lib/server/db/index.ts";
import { cues, subtitleTracks } from "#lib/server/db/schema.ts";
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
        runId: null,
        audioTrack: null,
        createdAt: new Date(1_000),
      },
      expect.objectContaining({ id: spanish, cueCount: 2, audioTrack: 1 }),
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
