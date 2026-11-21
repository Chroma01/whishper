from collections.abc import Sequence
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from anysub_worker.adapter import ProgressReporter, TextTranslationRequest
from anysub_worker.adapters.madlad import adapter as adapter_module
from anysub_worker.adapters.madlad.adapter import MadladAdapter
from anysub_worker.adapters.madlad.profile import MADLAD_3B, TranslationModelProfile
from anysub_worker.config import WorkerSettings
from anysub_worker.models import AdapterCapability
from anysub_worker.translation.errors import TranslationError


class FakeTokenizer:
    VOCABULARY = ("<2es>", "<2de>")

    def token_to_id(self, token: str) -> int | None:
        return hash(token) if token in self.VOCABULARY or not token.startswith("<2") else None

    def encode(self, text: str) -> SimpleNamespace:
        return SimpleNamespace(tokens=text.split(" "))

    def decode(self, ids: list[int], skip_special_tokens: bool) -> str:
        return " ".join(self._tokens[token_id] for token_id in ids)

    def remember(self, tokens: list[str]) -> None:
        self._tokens.update({hash(token): token for token in tokens})

    def __init__(self) -> None:
        self._tokens: dict[int, str] = {}


class FakeTranslator:
    def __init__(self, tokenizer: FakeTokenizer) -> None:
        self.tokenizer = tokenizer
        self.inputs: list[list[str]] = []

    def translate_batch(self, sources: list[list[str]], **options: Any) -> list[SimpleNamespace]:
        self.inputs += sources
        results = []
        for tokens in sources:
            output = [token.upper() for token in tokens[1:]]
            self.tokenizer.remember(output)
            results.append(SimpleNamespace(hypotheses=[output]))
        return results


def request(target: str = "es", count: int = 2) -> TextTranslationRequest:
    return TextTranslationRequest(
        model_id=MADLAD_3B.id,
        texts=tuple(f"line {index}" for index in range(count)),
        source_language="en",
        target_language=target,
    )


def downloaded(settings: WorkerSettings) -> None:
    snapshot = MADLAD_3B.snapshot(settings.runtime.model_root / "madlad")
    snapshot.mkdir(parents=True)
    for name in MADLAD_3B.files:
        (snapshot / name).write_bytes(b"{}")


@pytest.fixture
def fake_model(monkeypatch: pytest.MonkeyPatch) -> FakeTranslator:
    tokenizer = FakeTokenizer()
    translator = FakeTranslator(tokenizer)
    monkeypatch.setattr(MadladAdapter, "_load", lambda self, profile: (translator, tokenizer))
    return translator


async def no_progress(fraction: float, message: str) -> None:
    return None


def test_the_manifest_offers_one_translation_model(settings: WorkerSettings) -> None:
    manifest = MadladAdapter(settings.runtime).manifest

    [model] = manifest.models
    assert manifest.id == "madlad"
    assert model.capabilities == (AdapterCapability.TRANSLATE,)
    assert model.downloaded is False

    downloaded(settings)
    assert MadladAdapter(settings.runtime).manifest.models[0].downloaded is True


async def test_texts_translate_in_order_with_the_target_language_token(
    settings: WorkerSettings, fake_model: FakeTranslator
) -> None:
    downloaded(settings)
    updates: list[tuple[float, str]] = []

    async def progress(fraction: float, message: str) -> None:
        updates.append((fraction, message))

    result = await MadladAdapter(settings.runtime).translate(request("es-MX", 3), progress)

    assert result == ["LINE 0", "LINE 1", "LINE 2"]
    assert fake_model.inputs[0] == ["<2es>", "line", "0"]
    assert updates[-1] == (1.0, "Translated 3 of 3 sentences")


async def test_a_language_the_model_does_not_know_fails_for_good(
    settings: WorkerSettings, fake_model: FakeTranslator
) -> None:
    downloaded(settings)

    with pytest.raises(TranslationError, match="cannot translate into tlh") as raised:
        await MadladAdapter(settings.runtime).translate(request("tlh"), no_progress)

    assert raised.value.retryable is False


async def test_a_model_that_is_not_downloaded_fails_without_downloading(
    settings: WorkerSettings, fake_model: FakeTranslator, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def download(*args: object, **kwargs: object) -> None:
        raise AssertionError("downloaded")

    monkeypatch.setattr(adapter_module, "download_profile", download)

    with pytest.raises(TranslationError, match="not downloaded") as raised:
        await MadladAdapter(settings.runtime).translate(request(), no_progress)

    assert raised.value.retryable is False


async def test_downloading_runs_the_download_module(
    settings: WorkerSettings, monkeypatch: pytest.MonkeyPatch
) -> None:
    commands: list[Sequence[str]] = []

    async def download(
        profile: TranslationModelProfile,
        model_root: Path,
        report_progress: ProgressReporter,
        *,
        command: Sequence[str],
    ) -> None:
        commands.append(command)

    monkeypatch.setattr(adapter_module, "download_profile", download)

    await MadladAdapter(settings.runtime).download_model(MADLAD_3B.id, no_progress)

    assert commands[0][-2:] == (
        "anysub_worker.adapters.madlad.download",
        str(settings.runtime.model_root / "madlad"),
    )
