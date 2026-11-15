import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { discardDeletedTrackJournals } from "./autosave.svelte";
import {
  cue,
  newEditor,
  restoreEditorGlobals,
  stubEditorGlobals,
  trackA,
} from "./testing";

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = stubEditorGlobals();
});

afterEach(restoreEditorGlobals);

const journalKeyA = "anysub:editor:project-a:track-a";
const secondTrack = { projectId: "project-a", trackId: "track-a2" };

function storeJournal(text: string, revision = 1): void {
  localStorage.setItem(
    journalKeyA,
    JSON.stringify({ revision, cues: [cue("a", text)], updatedAt: 0 }),
  );
}

describe("CueEditor switching transcripts", () => {
  it("saves the edits of the transcript it leaves", () => {
    const editor = newEditor();
    editor.loadTrack(trackA, [cue("a", "server")], 1);
    editor.setText(0, "edited");

    editor.loadTrack(secondTrack, [cue("b", "second transcript")], 1);

    expect(editor.cues[0].text).toBe("second transcript");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toBe(
      "/api/projects/project-a/tracks/track-a",
    );
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      cues: [{ text: "edited" }],
    });
  });

  it("keeps the journal when the save of the transcript it leaves fails", async () => {
    fetchMock.mockResolvedValueOnce({
      status: 500,
      ok: false,
      json: async () => ({ message: "Down." }),
    });
    const editor = newEditor();
    editor.loadTrack(trackA, [cue("a", "server")], 1);
    editor.setText(0, "edited");

    editor.loadTrack(secondTrack, [cue("b", "second transcript")], 1);
    await vi.advanceTimersByTimeAsync(0);

    expect(JSON.parse(localStorage.getItem(journalKeyA) ?? "{}")).toMatchObject(
      { revision: 1, cues: [{ text: "edited" }] },
    );
  });

  it("tells when the last save of a transcript it left has landed", async () => {
    let respond: (value: unknown) => void = () => {};
    fetchMock.mockImplementationOnce(
      () => new Promise((resolve) => (respond = resolve)),
    );
    const editor = newEditor();
    editor.loadTrack(trackA, [cue("a", "server")], 1);
    editor.setText(0, "edited");
    editor.loadTrack(secondTrack, [cue("b", "second transcript")], 1);
    let landed = false;
    void editor.leftSave("track-a").then(() => (landed = true));

    await vi.advanceTimersByTimeAsync(0);
    expect(landed).toBe(false);
    respond({ status: 200, ok: true, json: async () => ({ revision: 2 }) });
    await vi.advanceTimersByTimeAsync(0);

    expect(landed).toBe(true);
    await expect(editor.leftSave("track-a2")).resolves.toBeUndefined();
  });

  it("keeps another transcript's unsaved edits until it opens again", () => {
    storeJournal("unsaved edit");
    const editor = newEditor();

    editor.loadTrack(secondTrack, [cue("b", "second transcript")], 1);
    expect(localStorage.getItem(journalKeyA)).not.toBeNull();
    expect(editor.autosave.notice).toBeNull();

    editor.loadTrack(trackA, [cue("a", "server")], 1);
    expect(editor.cues[0].text).toBe("unsaved edit");
    expect(editor.autosave.hasUnsavedChanges).toBe(true);
  });

  it("starts each transcript with its own undo history", () => {
    const editor = newEditor();
    editor.loadTrack(trackA, [cue("a", "server")], 1);
    editor.setText(0, "edited");

    editor.loadTrack(secondTrack, [cue("b", "second transcript")], 1);

    expect(editor.canUndo).toBe(false);
  });
});

describe("discardDeletedTrackJournals", () => {
  it("removes only the journals of transcripts the project no longer has", () => {
    storeJournal("kept");
    const deletedKey = "anysub:editor:project-a:track-deleted";
    const otherProjectKey = "anysub:editor:project-b:track-b";
    for (const key of [deletedKey, otherProjectKey]) {
      localStorage.setItem(
        key,
        JSON.stringify({ revision: 1, cues: [cue("x", "x")], updatedAt: 0 }),
      );
    }
    localStorage.setItem("anysub:theme", "dark");

    discardDeletedTrackJournals("project-a", ["track-a", "track-a2"]);

    expect(localStorage.getItem(journalKeyA)).not.toBeNull();
    expect(localStorage.getItem(deletedKey)).toBeNull();
    expect(localStorage.getItem(otherProjectKey)).not.toBeNull();
    expect(localStorage.getItem("anysub:theme")).toBe("dark");
  });
});
