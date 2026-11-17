import { describe, expect, it } from "vitest";
import {
  ftsMatchExpression,
  HIGHLIGHT_END,
  HIGHLIGHT_START,
  highlightQuery,
  matchesQuery,
  needsSubstringSearch,
  parseSearchQuery,
  searchesTranscripts,
  segmentsFromMarkers,
} from "./search-query";

describe("parseSearchQuery", () => {
  it("reads words, phrases and exclusions", () => {
    expect(parseSearchQuery('space "crew call" -draft -"old cut"')).toEqual({
      terms: [
        { text: "space", phrase: false },
        { text: "crew call", phrase: true },
      ],
      excluded: [
        { text: "draft", phrase: false },
        { text: "old cut", phrase: true },
      ],
      typingLastTerm: false,
    });
  });

  it("treats the last word as still being typed until a space follows it", () => {
    expect(parseSearchQuery("crew ca").typingLastTerm).toBe(true);
    expect(parseSearchQuery("crew ca ").typingLastTerm).toBe(false);
    expect(parseSearchQuery('"crew ca"').typingLastTerm).toBe(false);
  });

  it("drops pieces with no letters or digits and keeps an unclosed phrase", () => {
    expect(parseSearchQuery('- * : "half open').terms).toEqual([
      { text: "half open", phrase: true },
    ]);
  });
});

describe("ftsMatchExpression", () => {
  it("quotes every term so typed syntax stays text", () => {
    expect(
      ftsMatchExpression(parseSearchQuery("text:crew *star OR NEAR")),
    ).toBe('("text:crew" "*star" "OR" "NEAR"*)');
  });

  it("matches the word being typed as a prefix", () => {
    expect(ftsMatchExpression(parseSearchQuery("crew ca"))).toBe(
      '("crew" "ca"*)',
    );
  });

  it("leaves out excluded words", () => {
    expect(ftsMatchExpression(parseSearchQuery("crew -draft -test "))).toBe(
      '("crew") NOT "draft" NOT "test"',
    );
  });

  it("has nothing to match for exclusions alone", () => {
    expect(ftsMatchExpression(parseSearchQuery("-draft"))).toBeNull();
  });
});

describe("matchesQuery", () => {
  it("needs every word, ignoring case and accents, and none excluded", () => {
    const query = parseSearchQuery("cafe crew -draft");
    expect(matchesQuery("Crew at the Café", query)).toBe(true);
    expect(matchesQuery("Crew at the Café (draft)", query)).toBe(false);
    expect(matchesQuery("Café", query)).toBe(false);
  });
});

describe("needsSubstringSearch", () => {
  it("is needed for scripts written without spaces", () => {
    expect(needsSubstringSearch(parseSearchQuery("宇宙"))).toBe(true);
    expect(needsSubstringSearch(parseSearchQuery("ステーション"))).toBe(true);
    expect(needsSubstringSearch(parseSearchQuery("우주 정거장"))).toBe(false);
    expect(needsSubstringSearch(parseSearchQuery("station"))).toBe(false);
  });
});

describe("searchesTranscripts", () => {
  it("starts at the second letter, or the first Chinese or Japanese one", () => {
    expect(searchesTranscripts(parseSearchQuery("t"))).toBe(false);
    expect(searchesTranscripts(parseSearchQuery("th"))).toBe(true);
    expect(searchesTranscripts(parseSearchQuery("a b"))).toBe(false);
    expect(searchesTranscripts(parseSearchQuery("宇"))).toBe(true);
  });
});

describe("highlightQuery", () => {
  it("marks every match in the original text, accents included", () => {
    expect(highlightQuery("Café crew, CAFE", parseSearchQuery("cafe"))).toEqual(
      [
        { text: "Café", match: true },
        { text: " crew, ", match: false },
        { text: "CAFE", match: true },
      ],
    );
  });

  it("highlights a Greek word ending in a capital sigma", () => {
    expect(highlightQuery("ΟΔΥΣΣΕΥΣ", parseSearchQuery("οδυσσευς"))).toEqual([
      { text: "ΟΔΥΣΣΕΥΣ", match: true },
    ]);
  });

  it("joins overlapping matches", () => {
    expect(
      highlightQuery("spacecraft", parseSearchQuery("space craft")),
    ).toEqual([{ text: "spacecraft", match: true }]);
  });
});

describe("segmentsFromMarkers", () => {
  it("reads highlight() output", () => {
    expect(
      segmentsFromMarkers(
        `The ${HIGHLIGHT_START}crew${HIGHLIGHT_END} and ${HIGHLIGHT_START}station${HIGHLIGHT_END}`,
      ),
    ).toEqual([
      { text: "The ", match: false },
      { text: "crew", match: true },
      { text: " and ", match: false },
      { text: "station", match: true },
    ]);
  });
});
