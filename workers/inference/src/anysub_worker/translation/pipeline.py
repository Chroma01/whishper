from __future__ import annotations

from collections.abc import Awaitable, Callable

from ..adapter import ProgressReporter
from ..models import TranslatedCue, TranslationJobPayload
from .errors import TranslationError
from .fit import fit_translation
from .sentences import group_sentences

TranslateTexts = Callable[[list[str], ProgressReporter], Awaitable[list[str]]]


async def translate_cues(
    payload: TranslationJobPayload, translate: TranslateTexts, report: ProgressReporter
) -> tuple[TranslatedCue, ...]:
    sentences = group_sentences(payload.cues, payload.source_language)
    if not sentences:
        raise TranslationError("The transcript has no text to translate.", retryable=False)
    translations = await translate([sentence.text for sentence in sentences], report)
    if len(translations) != len(sentences):
        raise TranslationError(
            f"The model returned {len(translations)} translations for {len(sentences)} sentences.",
            retryable=False,
        )
    return tuple(
        cue
        for sentence, translation in zip(sentences, translations, strict=True)
        for cue in fit_translation(
            sentence, translation, payload.target_language, payload.max_line_length
        )
    )
