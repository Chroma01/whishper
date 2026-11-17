import { randomUUID } from "node:crypto";

import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { db } from "#lib/server/db/index.ts";
import {
  cues,
  mediaUploads,
  projects as projectsTable,
  subtitleTracks,
} from "#lib/server/db/schema.ts";
import { seedProject, seedTrack } from "#lib/server/db/testing/fixtures.ts";
import {
  listLibraryProjects,
  primaryWorkspaceForUser,
  renameProjectForUser,
} from "#lib/server/projects/library.ts";
import type { LibrarySearch } from "#lib/shared/library-data.ts";

const NO_SEARCH: LibrarySearch = {
  query: "",
  language: null,
  status: null,
  added: null,
  sort: "activity",
};

function projectName(projectId: string): string | undefined {
  return db
    .select({ name: projectsTable.name })
    .from(projectsTable)
    .where(eq(projectsTable.id, projectId))
    .get()?.name;
}

describe("renameProjectForUser", () => {
  it("renames a project for a workspace member", async () => {
    const project = await seedProject();

    expect(
      renameProjectForUser(db, project.projectId, project.userId, "Final"),
    ).toBe(true);
    expect(projectName(project.projectId)).toBe("Final");
  });

  it("leaves a project of another workspace untouched", async () => {
    const project = await seedProject();
    const outsider = await seedProject();

    expect(
      renameProjectForUser(db, project.projectId, outsider.userId, "Mine"),
    ).toBe(false);
    expect(projectName(project.projectId)).toBe("Project");
  });
});

describe("project library", () => {
  it("reports an upload without progress for ten minutes as paused", async () => {
    const project = await seedProject();
    const lastProgressAt = new Date("2026-01-01T12:00:00Z");
    db.insert(mediaUploads)
      .values({
        id: randomUUID(),
        workspaceId: project.workspaceId,
        projectId: project.projectId,
        createdBy: project.userId,
        originalFilename: "interview.mp4",
        sizeBytes: 1_000,
        receivedBytes: 400,
        updatedAt: lastProgressAt,
      })
      .run();
    const uploadStatusAt = (minutesLater: number) =>
      listLibraryProjects(
        db,
        project.workspaceId,
        NO_SEARCH,
        new Date(lastProgressAt.getTime() + minutesLater * 60_000),
      ).projects[0].uploadStatus;

    expect(uploadStatusAt(9)).toBe("uploading");
    expect(uploadStatusAt(10)).toBe("paused");
  });

  it("counts and lists the projects of the user's workspace", async () => {
    const project = await seedProject();
    db.update(projectsTable)
      .set({ mediaDurationUs: 7_200_000_000 })
      .where(eq(projectsTable.id, project.projectId))
      .run();

    expect(primaryWorkspaceForUser(db, project.userId)).toMatchObject({
      id: project.workspaceId,
      projectCount: 1,
      readySourceCount: 0,
    });
    const { projects } = listLibraryProjects(
      db,
      project.workspaceId,
      NO_SEARCH,
    );
    expect(projects).toHaveLength(1);
    expect(projects[0]).toMatchObject({
      id: project.projectId,
      mediaDurationUs: 7_200_000_000,
    });
  });
});

describe("project library search", () => {
  type CueSeed = { text: string; startUs?: number };

  function addProject(
    owner: { workspaceId: string; userId: string },
    name: string,
    tracks: Record<string, CueSeed[]> = {},
    createdAt = new Date(),
  ): string {
    const projectId = db
      .insert(projectsTable)
      .values({
        workspaceId: owner.workspaceId,
        name,
        createdBy: owner.userId,
        createdAt,
      })
      .returning({ id: projectsTable.id })
      .get().id;
    for (const [language, seeds] of Object.entries(tracks)) {
      const trackId = db
        .insert(subtitleTracks)
        .values({ projectId, name: language, language })
        .returning({ id: subtitleTracks.id })
        .get().id;
      db.insert(cues)
        .values(
          seeds.map((seed, position) => ({
            trackId,
            position,
            startUs: seed.startUs ?? position * 1_000_000,
            endUs: (seed.startUs ?? position * 1_000_000) + 900_000,
            text: seed.text,
          })),
        )
        .run();
    }
    return projectId;
  }

  function search(workspaceId: string, values: Partial<LibrarySearch>) {
    return listLibraryProjects(db, workspaceId, {
      ...NO_SEARCH,
      sort: values.query ? "relevance" : "activity",
      ...values,
    });
  }

  const names = (workspaceId: string, values: Partial<LibrarySearch>) =>
    search(workspaceId, values).projects.map((project) => project.name);

  it("searches names and transcripts, ignoring case and accents", () => {
    const owner = seedProject();
    addProject(owner, "Entrevista Café");
    addProject(owner, "Interview", {
      es: [{ text: "Él habló de la canción" }],
    });

    expect(names(owner.workspaceId, { query: "cafe" })).toEqual([
      "Entrevista Café",
    ]);
    expect(names(owner.workspaceId, { query: "CANCION" })).toEqual([
      "Interview",
    ]);
  });

  it("highlights the name and each matching line with its time", () => {
    const owner = seedProject();
    addProject(owner, "Crew call", {
      en: [
        { text: "Welcome aboard the station", startUs: 5_000_000 },
        { text: "Nothing here", startUs: 6_000_000 },
        { text: "The crew sleeps on the station", startUs: 9_000_000 },
      ],
    });

    const [project] = search(owner.workspaceId, { query: "station" }).projects;

    expect(project.match).toMatchObject({
      nameSegments: null,
      hitCount: 2,
      languages: [{ language: "en", count: 2 }],
    });
    expect(
      project.match?.hits.map((hit) => [hit.startUs, hit.segments]),
    ).toEqual([
      [
        5_000_000,
        [
          { text: "Welcome aboard the ", match: false },
          { text: "station", match: true },
        ],
      ],
      [
        9_000_000,
        [
          { text: "The crew sleeps on the ", match: false },
          { text: "station", match: true },
        ],
      ],
    ]);
    expect(
      search(owner.workspaceId, { query: "crew" }).projects[0].match
        ?.nameSegments,
    ).toEqual([
      { text: "Crew", match: true },
      { text: " call", match: false },
    ]);
  });

  it("counts a line repeated by another transcript of the project once", () => {
    const owner = seedProject();
    const projectId = addProject(owner, "Twice", {
      en: [{ text: "orbit", startUs: 2_000_000 }],
    });
    const trackId = db
      .insert(subtitleTracks)
      .values({ projectId, name: "Again", language: "en" })
      .returning({ id: subtitleTracks.id })
      .get().id;
    db.insert(cues)
      .values([
        {
          trackId,
          position: 0,
          startUs: 2_400_000,
          endUs: 3_000_000,
          text: "orbit",
        },
        {
          trackId,
          position: 1,
          startUs: 9_000_000,
          endUs: 9_500_000,
          text: "orbit",
        },
      ])
      .run();

    const { match } = search(owner.workspaceId, { query: "orbit" }).projects[0];

    expect(match?.hitCount).toBe(2);
    expect(match?.hits.map((hit) => hit.startUs)).toEqual([
      2_000_000, 9_000_000,
    ]);
  });

  it("fills the listed lines after collapsing repeats, not before", () => {
    const owner = seedProject();
    const lines = Array.from({ length: 25 }, (_, index) => ({
      text: `orbit ${index}`,
      startUs: index * 5_000_000,
    }));
    const projectId = addProject(owner, "Twice", { en: lines });
    const copyId = db
      .insert(subtitleTracks)
      .values({ projectId, name: "Copy", language: "en" })
      .returning({ id: subtitleTracks.id })
      .get().id;
    db.insert(cues)
      .values(
        lines.map((line, position) => ({
          trackId: copyId,
          position,
          startUs: line.startUs,
          endUs: line.startUs + 1_000_000,
          text: line.text,
        })),
      )
      .run();

    const { match } = search(owner.workspaceId, { query: "orbit" }).projects[0];

    expect(match?.hitCount).toBe(25);
    expect(match?.hits).toHaveLength(20);
  });

  it("keeps the triggers that update the index, which a table rebuild drops", () => {
    const triggers = db
      .all<{ name: string }>(
        sql`select name from sqlite_master where type = 'trigger' and tbl_name = 'cues' order by name`,
      )
      .map((row) => row.name);

    expect(triggers).toEqual([
      "cues_search_delete",
      "cues_search_insert",
      "cues_search_update",
    ]);
  });

  it("matches the word being typed, phrases as written, and leaves out excluded words", () => {
    const owner = seedProject();
    addProject(owner, "One", { en: [{ text: "the space station" }] });
    addProject(owner, "Two", { en: [{ text: "station of space" }] });

    expect(names(owner.workspaceId, { query: "spa" })).toHaveLength(2);
    expect(names(owner.workspaceId, { query: '"space station"' })).toEqual([
      "One",
    ]);
    expect(names(owner.workspaceId, { query: "station -the" })).toEqual([
      "Two",
    ]);
  });

  it("asks for a word when the query only excludes", () => {
    const owner = seedProject();
    addProject(owner, "One", { en: [{ text: "station" }] });

    expect(search(owner.workspaceId, { query: "-station" })).toMatchObject({
      projects: [],
      needsTerm: true,
    });
  });

  it("keeps the index in step with edited and deleted lines", () => {
    const owner = seedProject();
    const projectId = addProject(owner, "One", {
      en: [{ text: "old words" }],
    });

    db.update(cues).set({ text: "new words" }).run();
    expect(names(owner.workspaceId, { query: "old" })).toEqual([]);
    expect(names(owner.workspaceId, { query: "new" })).toEqual(["One"]);

    db.delete(subtitleTracks)
      .where(eq(subtitleTracks.projectId, projectId))
      .run();
    expect(names(owner.workspaceId, { query: "new" })).toEqual([]);
  });

  it("finds words inside Chinese and Japanese text", () => {
    const owner = seedProject();
    addProject(owner, "One", {
      ja: [{ text: "国際宇宙ステーションへようこそ" }],
    });

    const [project] = search(owner.workspaceId, { query: "宇宙" }).projects;

    expect(project.match?.hits[0].segments).toEqual([
      { text: "国際", match: false },
      { text: "宇宙", match: true },
      { text: "ステーションへようこそ", match: false },
    ]);
  });

  it("ranks name matches first, then the strongest transcript match", () => {
    const owner = seedProject();
    addProject(owner, "Once", { en: [{ text: "orbit" }] });
    addProject(owner, "Often", {
      en: [{ text: "orbit" }, { text: "orbit again" }, { text: "orbit" }],
    });
    addProject(owner, "Orbit notes");

    expect(names(owner.workspaceId, { query: "orbit" })).toEqual([
      "Orbit notes",
      "Often",
      "Once",
    ]);
    expect(names(owner.workspaceId, { query: "orbit", sort: "name" })).toEqual([
      "Often",
      "Once",
      "Orbit notes",
    ]);
  });

  it("filters by language, counting only that language's lines", () => {
    const owner = seedProject();
    addProject(owner, "Both", {
      en: [{ text: "station" }],
      es: [{ text: "station", startUs: 5_000_000 }],
    });
    addProject(owner, "English", { en: [{ text: "station" }] });

    const results = search(owner.workspaceId, {
      query: "station",
      language: "es",
    });

    expect(results.projects.map((project) => project.name)).toEqual(["Both"]);
    expect(results.projects[0].match).toMatchObject({
      hitCount: 1,
      languages: [{ language: "es", count: 1 }],
    });
    expect(results.projects[0].languages).toEqual(["en", "es"]);
  });

  it("filters by date added, and counts what the filters hide", () => {
    const owner = seedProject();
    const now = new Date("2026-06-01T00:00:00Z");
    addProject(
      owner,
      "Old",
      { en: [{ text: "orbit" }] },
      new Date("2025-01-01"),
    );

    const filtered = listLibraryProjects(
      db,
      owner.workspaceId,
      { ...NO_SEARCH, query: "orbit", added: "month", sort: "relevance" },
      now,
    );

    expect(filtered).toMatchObject({ projects: [], unfilteredCount: 1 });
  });

  it("only searches the user's workspace", () => {
    const owner = seedProject();
    const stranger = seedProject();
    addProject(stranger, "Theirs", { en: [{ text: "station" }] });

    expect(names(owner.workspaceId, { query: "station" })).toEqual([]);
  });
});
