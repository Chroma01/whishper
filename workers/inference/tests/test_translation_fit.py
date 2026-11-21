import time
from itertools import pairwise

from anysub_worker.models import SourceCue
from anysub_worker.translation.fit import fit_translation
from anysub_worker.translation.sentences import Sentence


def sentence(*parts: tuple[float, float, str]) -> Sentence:
    cues = tuple(
        SourceCue(startUs=round(start * 1e6), endUs=round(end * 1e6), text=text)
        for start, end, text in parts
    )
    return Sentence(" ".join(cue.text for cue in cues), cues)


def test_one_cue_keeps_its_timing() -> None:
    [translated] = fit_translation(sentence((1, 2, "Good morning.")), " Buenos  días. ", "es", 42)

    assert (translated.start_us, translated.end_us, translated.text) == (
        1_000_000,
        2_000_000,
        "Buenos días.",
    )


def test_a_sentence_spreads_over_its_cues_in_proportion() -> None:
    source = sentence((0, 2, "When we reached the station"), (2, 3, "it was gone."))

    cues = fit_translation(source, "Cuando llegamos a la estación ya se había ido.", "es", 42)

    assert [cue.text for cue in cues] == ["Cuando llegamos a la estación ya", "se había ido."]
    assert [(cue.start_us, cue.end_us) for cue in cues] == [(0, 2_000_000), (2_000_000, 3_000_000)]


def test_a_split_prefers_the_end_of_a_clause() -> None:
    source = sentence((0, 1, "If it rains tomorrow"), (1, 2, "we stay at home and read."))

    cues = fit_translation(source, "Si llueve mañana, nos quedamos en casa a leer.", "es", 42)

    assert cues[0].text == "Si llueve mañana,"


def test_a_cue_left_without_words_gives_its_time_to_a_neighbour() -> None:
    source = sentence((0, 1, "Yes"), (1, 2, "yes"), (2, 3, "yes."))

    cues = fit_translation(source, "Sí, sí.", "es", 42)

    assert [(cue.text, cue.start_us, cue.end_us) for cue in cues] == [
        ("Sí,", 0, 2_000_000),
        ("sí.", 2_000_000, 3_000_000),
    ]


def test_splits_move_so_every_line_fits_instead_of_leaving_a_word_alone() -> None:
    source = sentence(
        (0, 2, "Each one brings our unique perspectives,"),
        (2, 3, "not just from our"),
    )

    cues = fit_translation(
        source,
        "y cada una trae nuestras perspectivas únicas, no solo de nuestras",
        "es",
        42,
    )

    assert [cue.text for cue in cues] == [
        "y cada una trae nuestras perspectivas",
        "únicas, no solo de nuestras",
    ]


def test_a_part_longer_than_a_line_becomes_even_cues_within_its_time() -> None:
    source = sentence((0, 4, "This is a short line."))

    cues = fit_translation(
        source, "Das ist eine überraschend lange Zeile in der Übersetzung.", "de", 30
    )

    assert [cue.text for cue in cues] == [
        "Das ist eine überraschend",
        "lange Zeile in der",
        "Übersetzung.",
    ]
    assert cues[0].start_us == 0 and cues[-1].end_us == 4_000_000
    assert all(left.end_us == right.start_us for left, right in pairwise(cues))


def test_chinese_lines_hold_fewer_characters() -> None:
    source = sentence((0, 4, "A sentence long enough to need two lines in Chinese."))

    cues = fit_translation(source, "这是一个足够长的句子需要在中文里分成两行显示", "zh", 42)

    assert len(cues) == 2
    assert all(len(cue.text) <= 17 for cue in cues)


def test_unspaced_languages_split_between_characters() -> None:
    source = sentence((0, 1, "Good morning"), (1, 2, "everyone."))

    cues = fit_translation(source, "大家早上好。", "zh", 42)

    assert "".join(cue.text for cue in cues) == "大家早上好。"
    assert len(cues) == 2


def test_an_empty_translation_makes_no_cues() -> None:
    assert fit_translation(sentence((0, 1, "Hm.")), "  ", "es", 42) == []


def test_very_long_text_fits_quickly() -> None:
    words = " ".join(f"palabra{index % 10}" for index in range(1500))
    source = sentence((0, 60, "One very long cue."), (60, 61, "And a short one."), (61, 62, "End."))
    started = time.perf_counter()

    cues = fit_translation(source, words, "es", 42)

    assert time.perf_counter() - started < 2
    assert all(len(cue.text) <= 42 for cue in cues)
    assert " ".join(cue.text for cue in cues) == words
