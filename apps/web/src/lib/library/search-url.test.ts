import { describe, expect, it } from "vitest";
import { libraryUrl } from "./search-url";

const EMPTY = {
  query: "",
  language: null,
  status: null,
  added: null,
  sort: "activity",
} as const;

describe("libraryUrl", () => {
  it("leaves out everything at its default", () => {
    expect(libraryUrl(EMPTY)).toBe("/");
    expect(libraryUrl({ ...EMPTY, query: "crew", sort: "relevance" })).toBe(
      "/?q=crew",
    );
  });

  it("keeps the filters and a sort other than the default", () => {
    expect(
      libraryUrl({
        query: "crew call",
        language: "es",
        status: "ready",
        added: "week",
        sort: "name",
      }),
    ).toBe("/?q=crew+call&language=es&status=ready&added=week&sort=name");
  });
});
