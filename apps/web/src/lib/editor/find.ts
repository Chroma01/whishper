import {
  normalizeWithPositions,
  type NormalizedText,
} from "#lib/shared/search-query.ts";

export type FindOptions = {
  matchCase: boolean;
  wholeWord: boolean;
  regex: boolean;
};

export type FindMatch = { cueId: string; start: number; end: number };

export type FindResult = { matches: FindMatch[]; error: string | null };

type CueText = { id: string; text: string };

const WORD_CHARACTER = /[\p{L}\p{N}_]/u;

function isWholeWord(text: string, start: number, end: number): boolean {
  return (
    !WORD_CHARACTER.test(text.charAt(start - 1)) &&
    !WORD_CHARACTER.test(text.charAt(end))
  );
}

function patternFlags(options: FindOptions, global: boolean): string {
  return `${global ? "g" : ""}u${options.matchCase ? "" : "i"}`;
}

function compiledPattern(query: string, options: FindOptions): RegExp {
  return new RegExp(query, patternFlags(options, true));
}

// Finding runs again on every edit while the bar is open, and most lines are
// unchanged, so their normalized text is kept. Clearing it now and then keeps
// edited lines from piling up.
const NORMALIZED_CACHE_LIMIT = 20_000;
const normalizedCache = new Map<string, NormalizedText>();

function normalized(text: string): NormalizedText {
  let entry = normalizedCache.get(text);
  if (!entry) {
    if (normalizedCache.size >= NORMALIZED_CACHE_LIMIT) normalizedCache.clear();
    entry = normalizeWithPositions(text);
    normalizedCache.set(text, entry);
  }
  return entry;
}

// Without Match case, case and accents are ignored, as in the library's
// search, so a line found there is found here too.
function textRanges(
  text: string,
  query: string,
  options: FindOptions,
): [number, number][] {
  const ranges: [number, number][] = [];
  if (options.matchCase) {
    let from = text.indexOf(query);
    while (from >= 0) {
      ranges.push([from, from + query.length]);
      from = text.indexOf(query, from + query.length);
    }
    return ranges;
  }
  const needle = normalizeWithPositions(query).text;
  if (!needle) return ranges;
  const { text: haystack, originalIndex } = normalized(text);
  let from = haystack.indexOf(needle);
  while (from >= 0) {
    ranges.push([originalIndex[from], originalIndex[from + needle.length]]);
    from = haystack.indexOf(needle, from + needle.length);
  }
  return ranges;
}

function patternRanges(text: string, pattern: RegExp): [number, number][] {
  const ranges: [number, number][] = [];
  for (const match of text.matchAll(pattern)) {
    // An empty match marks nothing and cannot be replaced usefully.
    if (match[0].length > 0) {
      ranges.push([match.index, match.index + match[0].length]);
    }
  }
  return ranges;
}

export function findMatches(
  cues: readonly CueText[],
  query: string,
  options: FindOptions,
): FindResult {
  if (!query) return { matches: [], error: null };
  let pattern: RegExp | null = null;
  if (options.regex) {
    try {
      pattern = compiledPattern(query, options);
    } catch {
      return { matches: [], error: "Not a valid regular expression" };
    }
  }
  const matches: FindMatch[] = [];
  for (const cue of cues) {
    const ranges = pattern
      ? patternRanges(cue.text, pattern)
      : textRanges(cue.text, query, options);
    for (const [start, end] of ranges) {
      if (options.wholeWord && !isWholeWord(cue.text, start, end)) continue;
      matches.push({ cueId: cue.id, start, end });
    }
  }
  return { matches, error: null };
}

// What one match becomes. A regular expression's replacement can refer to
// its groups as $1, $2... and runs on the whole text from the match, so
// lookarounds see the text around it.
function replacementFor(
  text: string,
  match: FindMatch,
  query: string,
  replacement: string,
  options: FindOptions,
): string {
  if (!options.regex) return replacement;
  const sticky = new RegExp(query, `y${patternFlags(options, false)}`);
  sticky.lastIndex = match.start;
  const replaced = text.replace(sticky, replacement);
  return replaced.slice(
    match.start,
    replaced.length - (text.length - match.end),
  );
}

// Replaces the given matches of one cue's text. Every replacement is worked
// out on the original text, then applied from the last one back so the
// earlier positions stay valid.
export function replaceInText(
  text: string,
  matches: readonly FindMatch[],
  query: string,
  replacement: string,
  options: FindOptions,
): string {
  const replacements = matches.map((match) => ({
    match,
    text: replacementFor(text, match, query, replacement, options),
  }));
  let result = text;
  for (const { match, text: replaced } of replacements.toSorted(
    (a, b) => b.match.start - a.match.start,
  )) {
    result = result.slice(0, match.start) + replaced + result.slice(match.end);
  }
  return result;
}
