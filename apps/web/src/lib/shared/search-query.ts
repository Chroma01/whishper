import { normalizeSearchText } from "./search";

export type SearchTerm = { text: string; phrase: boolean };

// "Exact phrases" and -excluded words are the only syntax. Anything else in
// the box, such as a colon or an asterisk, is plain text to look for.
export type SearchQuery = {
  terms: SearchTerm[];
  excluded: SearchTerm[];
  // The last word is still being typed, so it matches as a prefix.
  typingLastTerm: boolean;
};

export type TextSegment = { text: string; match: boolean };

const TOKEN = /(-?)"([^"]*)"?|(-?)([^\s"]+)/g;
const SEARCHABLE = /[\p{L}\p{N}]/u;
// Scripts written without spaces between words, which the full-text index
// cannot split. Korean puts spaces between words, so it is left out.
const UNSPACED_SCRIPT =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;

export const HIGHLIGHT_START = "\u0001";
export const HIGHLIGHT_END = "\u0002";

export function parseSearchQuery(input: string): SearchQuery {
  const terms: SearchTerm[] = [];
  const excluded: SearchTerm[] = [];
  for (const [, phraseNot, phrase, wordNot, word] of input.matchAll(TOKEN)) {
    const isPhrase = phrase !== undefined;
    const text = (isPhrase ? phrase : word).trim().replace(/\s+/g, " ");
    if (!SEARCHABLE.test(text)) continue;
    const isExcluded = (isPhrase ? phraseNot : wordNot) === "-";
    (isExcluded ? excluded : terms).push({ text, phrase: isPhrase });
  }
  const last = terms.at(-1);
  return {
    terms,
    excluded,
    typingLastTerm: last !== undefined && !last.phrase && !/\s$/.test(input),
  };
}

export function isEmptyQuery(query: SearchQuery): boolean {
  return query.terms.length === 0 && query.excluded.length === 0;
}

export function needsSubstringSearch(query: SearchQuery): boolean {
  return [...query.terms, ...query.excluded].some((term) =>
    UNSPACED_SCRIPT.test(term.text),
  );
}

// A single letter matches most lines and tells nothing apart, so transcripts
// are searched from the second one. In Chinese or Japanese one character is
// often a whole word.
export function searchesTranscripts(query: SearchQuery): boolean {
  return (
    needsSubstringSearch(query) ||
    query.terms.some((term) => [...term.text].length >= 2)
  );
}

function quoted(text: string): string {
  return `"${text.replaceAll('"', '""')}"`;
}

// Builds an FTS5 MATCH expression. Each term is quoted, so the user's text
// never reaches FTS5 as syntax. Null when there is nothing to look for, since
// FTS5 refuses an expression made only of exclusions.
export function ftsMatchExpression(query: SearchQuery): string | null {
  if (query.terms.length === 0) return null;
  const lastIndex = query.terms.length - 1;
  const included = query.terms
    .map((term, index) =>
      index === lastIndex && query.typingLastTerm
        ? `${quoted(term.text)}*`
        : quoted(term.text),
    )
    .join(" ");
  return [
    `(${included})`,
    ...query.excluded.map((term) => quoted(term.text)),
  ].join(" NOT ");
}

// The same rules in plain code, for project names and for scripts the index
// cannot split. Words match anywhere inside a word, phrases match as typed.
export function matchesQuery(text: string, query: SearchQuery): boolean {
  if (query.terms.length === 0) return false;
  const normalized = normalizeSearchText(text);
  const contains = (term: SearchTerm) =>
    normalized.includes(normalizeSearchText(term.text));
  return query.terms.every(contains) && !query.excluded.some(contains);
}

// Lowercasing a whole word turns a final capital Σ into ς, but one letter at a
// time gives σ, so both count as σ when positions matter.
function foldFinalSigma(text: string): string {
  return text.replaceAll("ς", "σ");
}

export type NormalizedText = { text: string; originalIndex: number[] };

// Normalizes one character at a time, remembering where each normalized
// character came from, so matches found in normalized text map back.
export function normalizeWithPositions(text: string): NormalizedText {
  let normalized = "";
  const originalIndex: number[] = [];
  let index = 0;
  for (const character of text) {
    const folded = foldFinalSigma(
      character.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase(),
    );
    for (let unit = 0; unit < folded.length; unit += 1) {
      originalIndex.push(index);
    }
    normalized += folded;
    index += character.length;
  }
  originalIndex.push(index);
  return { text: normalized, originalIndex };
}

export function highlightQuery(
  text: string,
  query: SearchQuery,
): TextSegment[] {
  const { text: normalized, originalIndex } = normalizeWithPositions(text);
  const ranges: [number, number][] = [];
  for (const term of query.terms) {
    const needle = foldFinalSigma(normalizeSearchText(term.text));
    if (!needle) continue;
    let from = normalized.indexOf(needle);
    while (from >= 0) {
      ranges.push([originalIndex[from], originalIndex[from + needle.length]]);
      from = normalized.indexOf(needle, from + needle.length);
    }
  }
  return segmentsFromRanges(text, ranges);
}

function segmentsFromRanges(
  text: string,
  ranges: [number, number][],
): TextSegment[] {
  const merged: [number, number][] = [];
  for (const [start, end] of ranges.toSorted((a, b) => a[0] - b[0])) {
    const previous = merged.at(-1);
    if (previous && start <= previous[1]) {
      previous[1] = Math.max(previous[1], end);
    } else {
      merged.push([start, end]);
    }
  }
  const segments: TextSegment[] = [];
  let cursor = 0;
  for (const [start, end] of merged) {
    if (start > cursor) {
      segments.push({ text: text.slice(cursor, start), match: false });
    }
    segments.push({ text: text.slice(start, end), match: true });
    cursor = end;
  }
  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), match: false });
  }
  return segments;
}

// Reads text that FTS5's highlight() marked with HIGHLIGHT_START and
// HIGHLIGHT_END.
export function segmentsFromMarkers(marked: string): TextSegment[] {
  const segments: TextSegment[] = [];
  for (const part of marked.split(HIGHLIGHT_START)) {
    const [inside, after] = part.includes(HIGHLIGHT_END)
      ? part.split(HIGHLIGHT_END, 2)
      : [null, part];
    if (inside) segments.push({ text: inside, match: true });
    if (after) segments.push({ text: after, match: false });
  }
  return segments;
}
