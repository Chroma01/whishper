from __future__ import annotations

import math
import re
from dataclasses import dataclass
from itertools import pairwise

from ..models import TranslatedCue
from ..transcripts.line_length import UNSPACED_LANGUAGES, clean_subtitle_text, join_tokens
from .sentences import CLOSING_MARKS, Sentence, base_language

# A split right after one of these reads better than one in mid-clause, so it
# wins over a slightly closer split elsewhere.
CLAUSE_END = re.compile(
    "[,;:.!?\u3001\uff0c\u3002\uff1b\uff1a\uff01\uff1f\u2026]" + CLOSING_MARKS + "$"
)
CLAUSE_PREFERENCE = 0.25
# A line past the limit costs more than moving a split far from its ideal
# place, so lines fit whenever the sentence allows it.
OVERFLOW_COST = 100.0
OVERFLOW_COST_PER_CHARACTER = 4.0
# Leaves a cue without words only when there are fewer words than cues.
EMPTY_COST = 1e6
# The search for the best splits takes time with the square of the words, so
# longer text, which a cue rarely holds, takes the nearest split instead.
MAX_SEARCHED_TOKENS = 120
# Chinese and Japanese characters each carry about as much as a short word,
# so their lines hold far fewer of them.
UNSPACED_LINE_SHARE = 0.4


@dataclass(frozen=True)
class _Piece:
    start_us: int
    end_us: int
    text: str


# Splits a translated sentence across the cues it came from, in proportion to
# how much of the original each cue held, so the translation keeps the timing
# of the speech. Splits move to keep every line within the limit, and a part
# that still does not fit becomes several evenly sized cues.
def fit_translation(
    sentence: Sentence, translation: str, language: str, max_line_length: int
) -> list[TranslatedCue]:
    language = base_language(language)
    text = clean_subtitle_text(translation, language)
    if not text:
        return []
    limit = line_limit(language, max_line_length)
    weights = [max(1, len(cue.text.strip())) for cue in sentence.cues]
    parts = _split(text, weights, language, limit)
    pieces = _merge_empty(
        [
            _Piece(cue.start_us, cue.end_us, part)
            for cue, part in zip(sentence.cues, parts, strict=True)
        ]
    )
    return [cue for piece in pieces for cue in _fit_line(piece, language, limit)]


def line_limit(language: str, max_line_length: int) -> int:
    if language in UNSPACED_LANGUAGES:
        return max(1, round(max_line_length * UNSPACED_LINE_SHARE))
    return max_line_length


class _Tokens:
    def __init__(self, text: str, language: str) -> None:
        self.unspaced = language in UNSPACED_LANGUAGES
        self.items = list(text) if self.unspaced else text.split(" ")
        self._ends: list[int] = []
        position = 0
        for index, token in enumerate(self.items):
            position += len(token) + (0 if self.unspaced or index == 0 else 1)
            self._ends.append(position)

    def offset(self, boundary: int) -> int:
        return self._ends[boundary - 1] if boundary else 0

    def length(self, start: int, stop: int) -> int:
        if start == stop:
            return 0
        gap = 0 if self.unspaced or start == 0 else 1
        return self.offset(stop) - self.offset(start) - gap

    def ends_clause(self, boundary: int) -> bool:
        return boundary > 0 and CLAUSE_END.search(self.items[boundary - 1]) is not None


# Picks the boundaries for all cues together: each one close to its share of
# the text and after a clause where it can be, each part within the limit.
def _split(text: str, weights: list[int], language: str, limit: int) -> list[str]:
    if len(weights) == 1:
        return [text]
    tokens = _Tokens(text, language)
    count = len(tokens.items)
    total = tokens.offset(count)
    clause_bonus = CLAUSE_PREFERENCE * total / len(weights)
    targets = [total * sum(weights[: index + 1]) / sum(weights) for index in range(len(weights))]

    def boundary_cost(boundary: int, index: int) -> float:
        bonus = clause_bonus if tokens.ends_clause(boundary) else 0
        return abs(tokens.offset(boundary) - targets[index]) - bonus

    if count > MAX_SEARCHED_TOKENS:
        return _nearest_split(tokens, targets[:-1], language)

    def part_cost(start: int, stop: int) -> float:
        if start == stop:
            return EMPTY_COST
        overflow = tokens.length(start, stop) - limit
        if overflow <= 0:
            return 0.0
        return OVERFLOW_COST + OVERFLOW_COST_PER_CHARACTER * overflow

    # best[stop] is the cheapest way to fill the cues so far with the tokens
    # before stop, with the boundaries it used.
    best: list[tuple[float, list[int]]] = [(0.0, [0])] + [(math.inf, [])] * count
    for index in range(len(weights)):
        last = index == len(weights) - 1
        following: list[tuple[float, list[int]]] = [(math.inf, [])] * (count + 1)
        for stop in (count,) if last else range(count + 1):
            for start in range(stop + 1):
                cost, bounds = best[start]
                if cost == math.inf:
                    continue
                cost += part_cost(start, stop) + (0 if last else boundary_cost(stop, index))
                if cost < following[stop][0]:
                    following[stop] = (cost, [*bounds, stop])
        best = following
    bounds = best[count][1]
    return [join_tokens(tokens.items[start:stop], language) for start, stop in pairwise(bounds)]


def _nearest_split(tokens: _Tokens, targets: list[float], language: str) -> list[str]:
    bounds = [0]
    boundary = 0
    for target in targets:
        while boundary < len(tokens.items) and tokens.offset(boundary + 1) <= target:
            boundary += 1
        bounds.append(max(boundary, bounds[-1]))
    bounds.append(len(tokens.items))
    return [join_tokens(tokens.items[start:stop], language) for start, stop in pairwise(bounds)]


# A cue left without words gives its time to the cue before it, or to the
# one after when it is the first.
def _merge_empty(pieces: list[_Piece]) -> list[_Piece]:
    merged: list[_Piece] = []
    pending_start: int | None = None
    for piece in pieces:
        if not piece.text:
            if merged:
                last = merged[-1]
                merged[-1] = _Piece(last.start_us, piece.end_us, last.text)
            elif pending_start is None:
                pending_start = piece.start_us
            continue
        start = piece.start_us if pending_start is None else pending_start
        pending_start = None
        merged.append(_Piece(start, piece.end_us, piece.text))
    return merged


# Fills lines up to an even share of the text, so the last line is not left
# short, and never past the limit. A word longer than a line stays whole.
def _even_parts(text: str, language: str, limit: int) -> list[str]:
    tokens = list(text) if language in UNSPACED_LANGUAGES else text.split(" ")
    share = math.ceil(len(text) / math.ceil(len(text) / limit))
    parts: list[list[str]] = [[]]
    for token in tokens:
        current = join_tokens(parts[-1], language)
        joined = join_tokens([*parts[-1], token], language)
        if parts[-1] and (len(joined) > limit or len(current) >= share):
            parts.append([token])
        else:
            parts[-1].append(token)
    return [join_tokens(part, language) for part in parts]


# A part longer than a line splits into even cues, sharing its time by length.
def _fit_line(piece: _Piece, language: str, limit: int) -> list[TranslatedCue]:
    if len(piece.text) <= limit:
        return [TranslatedCue(startUs=piece.start_us, endUs=piece.end_us, text=piece.text)]
    parts = _even_parts(piece.text, language, limit)
    lengths = [max(1, len(part)) for part in parts]
    duration = piece.end_us - piece.start_us
    cues: list[TranslatedCue] = []
    start = piece.start_us
    for index, part in enumerate(parts):
        end = (
            piece.end_us
            if index == len(parts) - 1
            else piece.start_us + duration * sum(lengths[: index + 1]) // sum(lengths)
        )
        cues.append(TranslatedCue(startUs=start, endUs=end, text=part))
        start = end
    return cues
