import { describe, expect, it } from "vitest";
import { findMatches, replaceInText, type FindOptions } from "./find";

const PLAIN: FindOptions = { matchCase: false, wholeWord: false, regex: false };
const cues = [
  { id: "a", text: "The Café opens. The cafe closes." },
  { id: "b", text: "cafeteria" },
];

describe("findMatches", () => {
  it("ignores case and accents by default", () => {
    expect(findMatches(cues, "CAFE", PLAIN).matches).toEqual([
      { cueId: "a", start: 4, end: 8 },
      { cueId: "a", start: 20, end: 24 },
      { cueId: "b", start: 0, end: 4 },
    ]);
  });

  it("matches the exact text with Match case", () => {
    expect(
      findMatches(cues, "Café", { ...PLAIN, matchCase: true }).matches,
    ).toEqual([{ cueId: "a", start: 4, end: 8 }]);
  });

  it("skips matches inside longer words with Whole word", () => {
    expect(
      findMatches(cues, "cafe", { ...PLAIN, wholeWord: true }).matches.map(
        (match) => match.cueId,
      ),
    ).toEqual(["a", "a"]);
  });

  it("runs regular expressions and reports a broken one", () => {
    const regex = { ...PLAIN, regex: true };
    expect(findMatches(cues, "c\\w+s", regex).matches).toEqual([
      { cueId: "a", start: 25, end: 31 },
    ]);
    expect(findMatches(cues, "(", regex)).toEqual({
      matches: [],
      error: "Not a valid regular expression",
    });
  });

  it("finds nothing for an empty query or an empty match", () => {
    expect(findMatches(cues, "", PLAIN).matches).toEqual([]);
    expect(findMatches(cues, "x*", { ...PLAIN, regex: true }).matches).toEqual(
      [],
    );
  });
});

describe("replaceInText", () => {
  it("replaces every given match, keeping earlier positions right", () => {
    const text = cues[0].text;
    const { matches } = findMatches([cues[0]], "cafe", PLAIN);
    expect(replaceInText(text, matches, "cafe", "bar", PLAIN)).toBe(
      "The bar opens. The bar closes.",
    );
  });

  it("fills in a regular expression's groups", () => {
    const regex = { ...PLAIN, regex: true };
    const text = "Dr. Okafor and Dr. Smith";
    const { matches } = findMatches([{ id: "a", text }], "Dr\\. (\\w+)", regex);
    expect(
      replaceInText(text, matches, "Dr\\. (\\w+)", "Doctor $1", regex),
    ).toBe("Doctor Okafor and Doctor Smith");
  });

  it("lets a regular expression look at the text around its match", () => {
    const regex = { ...PLAIN, regex: true };
    const text = "Mr. Smith. Done.";
    const query = "(?<=Mr)\\.";
    const { matches } = findMatches([{ id: "a", text }], query, regex);
    expect(matches).toHaveLength(1);
    expect(replaceInText(text, matches, query, "", regex)).toBe(
      "Mr Smith. Done.",
    );
  });
});
