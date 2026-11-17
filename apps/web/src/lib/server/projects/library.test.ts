import { describe, expect, it } from "vitest";

import {
  normalizeProjectTitle,
  parseProjectLibrarySearch,
} from "#lib/server/projects/library.ts";
import {
  PROJECT_SEARCH_MAX_LENGTH,
  PROJECT_TITLE_MAX_LENGTH,
} from "#lib/shared/limits.ts";

describe("project library inputs", () => {
  it("reads the query and filters, sorting by relevance only while searching", () => {
    expect(
      parseProjectLibrarySearch(
        new URLSearchParams(
          "q=%20rough+cut%20&language=es&status=active&added=week",
        ),
      ),
    ).toEqual({
      query: "rough cut",
      language: "es",
      status: "active",
      added: "week",
      sort: "relevance",
    });
    expect(parseProjectLibrarySearch(new URLSearchParams()).sort).toBe(
      "activity",
    );
  });

  it("ignores filter values it does not know", () => {
    expect(
      parseProjectLibrarySearch(
        new URLSearchParams("language=<x>&status=done&added=ever&sort=size"),
      ),
    ).toEqual({
      query: "",
      language: null,
      status: null,
      added: null,
      sort: "activity",
    });
  });

  it("bounds search input without treating punctuation as syntax", () => {
    const query = `${"a".repeat(PROJECT_SEARCH_MAX_LENGTH)}%_`;
    expect(
      parseProjectLibrarySearch(new URLSearchParams({ q: query })).query,
    ).toBe("a".repeat(PROJECT_SEARCH_MAX_LENGTH));
  });

  it("normalizes project titles and enforces their storage limit", () => {
    expect(normalizeProjectTitle("  Assembly\n  cut  ")).toBe("Assembly cut");
    expect(normalizeProjectTitle("e\u0301pisode")).toBe("épisode");
    expect(
      normalizeProjectTitle("x".repeat(PROJECT_TITLE_MAX_LENGTH + 1)),
    ).toHaveLength(PROJECT_TITLE_MAX_LENGTH);
  });

  it("never cuts an emoji in half at the title limit", () => {
    const fill = "x".repeat(PROJECT_TITLE_MAX_LENGTH - 1);
    expect(normalizeProjectTitle(`${fill}\u{1F600}`)).toBe(fill);
  });
});
