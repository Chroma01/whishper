from __future__ import annotations

import re
from dataclasses import dataclass

from ..models import SourceCue
from ..transcripts.line_length import UNSPACED_LANGUAGES

# Closing quotes and brackets that may follow the end of a sentence or clause.
CLOSING_MARKS = "['\"\u2019\u201d\u00bb)\\]\u300d\u300f]*"
# Ends a sentence, before any closing quotes or brackets. An ellipsis usually
# means the sentence goes on in the next cue, so it does not count.
SENTENCE_END = re.compile(
    "(?<!\\.\\.)(?<!\u2026)[.!?\u3002\uff01\uff1f\u061f\u0964]" + CLOSING_MARKS + "$"
)
# A pause this long ends a sentence even without punctuation, which many
# transcripts leave out.
MAX_JOIN_GAP_US = 2_000_000
MAX_CUES_PER_SENTENCE = 8
MAX_SENTENCE_CHARACTERS = 400


@dataclass(frozen=True)
class Sentence:
    text: str
    cues: tuple[SourceCue, ...]


# Cues split sentences wherever the line ran out, and a fragment translated
# on its own loses the grammar of the rest. Whole sentences translate well,
# and fit.py spreads each one back over the cues it came from.
def group_sentences(cues: tuple[SourceCue, ...], language: str) -> list[Sentence]:
    separator = "" if base_language(language) in UNSPACED_LANGUAGES else " "
    sentences: list[Sentence] = []
    current: list[SourceCue] = []
    for cue in cues:
        if not cue.text.strip():
            continue
        if current and _starts_new_sentence(current, cue, separator):
            sentences.append(_sentence(current, separator))
            current = []
        current.append(cue)
    if current:
        sentences.append(_sentence(current, separator))
    return sentences


def _starts_new_sentence(current: list[SourceCue], cue: SourceCue, separator: str) -> bool:
    previous = current[-1]
    joined_length = sum(len(part.text.strip()) for part in current) + len(cue.text.strip())
    return (
        SENTENCE_END.search(previous.text.strip()) is not None
        or cue.start_us - previous.end_us > MAX_JOIN_GAP_US
        or len(current) >= MAX_CUES_PER_SENTENCE
        or joined_length + len(separator) * len(current) > MAX_SENTENCE_CHARACTERS
    )


def _sentence(cues: list[SourceCue], separator: str) -> Sentence:
    return Sentence(separator.join(cue.text.strip() for cue in cues), tuple(cues))


def base_language(language: str) -> str:
    return language.split("-", 1)[0].lower()
