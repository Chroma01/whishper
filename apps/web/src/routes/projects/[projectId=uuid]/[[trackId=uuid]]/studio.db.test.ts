import { isActionFailure, isRedirect } from "@sveltejs/kit";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { db } from "#lib/server/db/index.ts";
import { jobs, projects, subtitleTracks } from "#lib/server/db/schema.ts";
import {
  seedProject,
  type SeededProject,
} from "#lib/server/db/testing/fixtures.ts";

import { actions, load } from "./+page.server";

type LoadEvent = Parameters<typeof load>[0];
type ActionEvent = Parameters<typeof actions.prepareMedia>[0];

function seedTranscript(projectId: string, createdAt: number): string {
  return db
    .insert(subtitleTracks)
    .values({
      projectId,
      name: "whisperx · small",
      language: "en",
      createdAt: new Date(createdAt),
    })
    .returning({ id: subtitleTracks.id })
    .get().id;
}

async function open(
  project: SeededProject,
  trackId?: string,
): Promise<unknown> {
  try {
    return await load({
      locals: { user: { id: project.userId } },
      params: { projectId: project.projectId, trackId },
    } as unknown as LoadEvent);
  } catch (cause) {
    return cause;
  }
}

async function submit(
  action: (event: ActionEvent) => unknown,
  project: SeededProject,
  trackId: string,
  body: FormData,
): Promise<unknown> {
  try {
    return await action({
      locals: { user: { id: project.userId } },
      params: { projectId: project.projectId, trackId },
      request: new Request("http://localhost/", { method: "POST", body }),
    } as unknown as ActionEvent);
  } catch (cause) {
    return cause;
  }
}

describe("studio page", () => {
  it("opens the newest transcript when the address names none", async () => {
    const project = seedProject();
    seedTranscript(project.projectId, 1_000);
    const newest = seedTranscript(project.projectId, 2_000);

    expect(await open(project)).toMatchObject({
      status: 303,
      location: `/projects/${project.projectId}/${newest}`,
    });
  });

  it("opens the named transcript and lists every one, oldest first", async () => {
    const project = seedProject();
    const oldest = seedTranscript(project.projectId, 1_000);
    const newest = seedTranscript(project.projectId, 2_000);

    const data = await open(project, oldest);

    expect(data).toMatchObject({
      track: { id: oldest },
      tracks: [{ id: oldest }, { id: newest }],
    });
  });

  it("goes back to the project when the transcript is gone", async () => {
    const project = seedProject();
    const other = seedProject();
    const elsewhere = seedTranscript(other.projectId, 1_000);

    const result = await open(project, elsewhere);

    expect(isRedirect(result) && result.location).toBe(
      `/projects/${project.projectId}`,
    );
  });

  it("shows a project without transcripts as it is", async () => {
    const project = seedProject();

    expect(await open(project)).toMatchObject({ track: null, tracks: [] });
  });

  it("goes to the next newest transcript after deleting the open one", async () => {
    const project = seedProject();
    const older = seedTranscript(project.projectId, 1_000);
    const newest = seedTranscript(project.projectId, 2_000);
    const body = new FormData();
    body.set("trackId", newest);

    const result = await submit(
      actions.deleteTranscript,
      project,
      newest,
      body,
    );

    expect(result).toMatchObject({
      status: 303,
      location: `/projects/${project.projectId}`,
    });
    expect(await open(project)).toMatchObject({
      location: `/projects/${project.projectId}/${older}`,
    });
  });

  it("stays on the open transcript after preparing the media again", async () => {
    const project = seedProject({
      mediaOriginalKey: "originals/film.mkv",
      mediaFilename: "film.mkv",
    });
    seedTranscript(project.projectId, 2_000);
    const older = seedTranscript(project.projectId, 1_000);

    expect(
      await submit(actions.prepareMedia, project, older, new FormData()),
    ).toMatchObject({
      status: 303,
      location: `/projects/${project.projectId}/${older}`,
    });
  });

  it("prepares a chosen audio track and stays on the open transcript", async () => {
    const project = seedProject({
      mediaOriginalKey: "originals/film.mkv",
      mediaFilename: "film.mkv",
    });
    const audio = { type: "audio", codec: "aac" };
    db.update(projects)
      .set({
        mediaProbe: {
          streams: [
            { index: 1, ...audio },
            { index: 2, ...audio },
          ],
        },
      })
      .where(eq(projects.id, project.projectId))
      .run();
    const trackId = seedTranscript(project.projectId, 1_000);
    const prepare = (audioTrack: string) => {
      const body = new FormData();
      body.set("audioTrack", audioTrack);
      return submit(actions.prepareMedia, project, trackId, body);
    };

    expect(isActionFailure(await prepare("first"))).toBe(true);
    expect(await prepare("1")).toMatchObject({
      status: 303,
      location: `/projects/${project.projectId}/${trackId}`,
    });
    expect(
      db
        .select({ payload: jobs.payload })
        .from(jobs)
        .where(eq(jobs.projectId, project.projectId))
        .all(),
    ).toEqual([{ payload: expect.objectContaining({ audioTrack: 1 }) }]);
  });
});
