from anysub_worker.models import SourceCue
from anysub_worker.translation.sentences import group_sentences


def cue(start_s: float, end_s: float, text: str) -> SourceCue:
    return SourceCue(startUs=round(start_s * 1e6), endUs=round(end_s * 1e6), text=text)


def texts(cues: tuple[SourceCue, ...], language: str = "en") -> list[str]:
    return [sentence.text for sentence in group_sentences(cues, language)]


def test_cues_join_until_a_sentence_ends() -> None:
    cues = (
        cue(0, 1, "When we reached the station"),
        cue(1, 2, "the train had left."),
        cue(2, 3, "Really?"),
    )

    assert texts(cues) == ["When we reached the station the train had left.", "Really?"]
    assert len(group_sentences(cues, "en")[0].cues) == 2


def test_an_ellipsis_continues_the_sentence() -> None:
    cues = (cue(0, 1, "I was thinking..."), cue(1, 2, "maybe tomorrow."))

    assert texts(cues) == ["I was thinking... maybe tomorrow."]


def test_closing_quotes_after_the_end_still_end_it() -> None:
    cues = (cue(0, 1, 'He said "no."'), cue(1, 2, "Then he left."))

    assert texts(cues) == ['He said "no."', "Then he left."]


def test_a_long_pause_or_many_cues_end_a_sentence_without_punctuation() -> None:
    paused = (cue(0, 1, "first thought"), cue(4, 5, "second thought"))
    many = tuple(cue(index, index + 1, f"part {index}") for index in range(10))

    assert texts(paused) == ["first thought", "second thought"]
    assert [len(sentence.cues) for sentence in group_sentences(many, "en")] == [8, 2]


def test_empty_cues_are_left_out_and_unspaced_languages_join_without_spaces() -> None:
    cues = (cue(0, 1, "我们"), cue(1, 2, "  "), cue(2, 3, "走吧。"))

    assert texts(cues, "zh") == ["我们走吧。"]
