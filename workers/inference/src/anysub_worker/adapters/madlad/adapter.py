from __future__ import annotations

import gc
import sys
from importlib import import_module
from importlib.metadata import version
from importlib.util import find_spec
from pathlib import Path
from typing import Any

from anysub_worker.adapter import (
    AdapterExecutionError,
    AdapterLibraryMissing,
    ProgressReporter,
    TextTranslationRequest,
)
from anysub_worker.config import AdapterRuntimeSettings
from anysub_worker.hardware import usable_cpu_count
from anysub_worker.hub_cache import delete_profile, download_profile
from anysub_worker.models import AdapterCapability, AdapterManifest, AdapterModel
from anysub_worker.progress import progress_span
from anysub_worker.threads import run_in_thread
from anysub_worker.translation.errors import TranslationError
from anysub_worker.translation.sentences import base_language

from .profile import MADLAD_3B, TranslationModelProfile

ADAPTER_ID = "madlad"
DOWNLOAD_MODULE = f"{__package__}.download"
TRANSLATE_SPAN = (0.05, 1.0)
# Small enough for steady progress, large enough to keep the CPU busy.
SENTENCES_PER_STEP = 16
BEAM_SIZE = 2
COMPUTE_TYPES = {"cpu": "int8", "cuda": "int8_float16"}


class MadladAdapter:
    """Translation on the worker with MADLAD-400 through CTranslate2."""

    def __init__(self, runtime: AdapterRuntimeSettings | None = None) -> None:
        self._runtime = runtime if runtime is not None else AdapterRuntimeSettings()

    @property
    def manifest(self) -> AdapterManifest:
        profile = MADLAD_3B
        return AdapterManifest(
            id=ADAPTER_ID,
            displayName="MADLAD-400",
            version=version("anysub-worker"),
            description="Local translation that never leaves the server.",
            models=(
                AdapterModel(
                    id=profile.id,
                    displayName=profile.display_name,
                    capabilities=(AdapterCapability.TRANSLATE,),
                    description=profile.description,
                    parameterCount=profile.parameter_count,
                    recommendedRamBytes=profile.recommended_ram_bytes,
                    downloadSizeBytes=profile.download_size_bytes,
                    downloaded=profile.is_downloaded(self._model_root),
                ),
            ),
        )

    async def download_model(self, model_id: str, report_progress: ProgressReporter) -> None:
        await self._download(self._profile(model_id), report_progress)

    async def delete_model(self, model_id: str) -> None:
        await delete_profile(self._profile(model_id), self._model_root)

    async def translate(
        self, request: TextTranslationRequest, report_progress: ProgressReporter
    ) -> list[str]:
        profile = self._profile(request.model_id)
        # The application sends these jobs only to workers that downloaded
        # the model, so the download stays the administrator's choice.
        if not profile.is_downloaded(self._model_root):
            raise TranslationError(
                f"{profile.display_name} is not downloaded on this worker. Download it in "
                "Administration, Translation.",
                retryable=False,
            )
        await report_progress(0.0, f"Loading {profile.display_name}")
        translator, tokenizer = await run_in_thread(self._load, profile)
        try:
            target = _target_token(tokenizer, request.target_language)
            report = progress_span(report_progress, *TRANSLATE_SPAN)
            translations: list[str] = []
            total = len(request.texts)
            for first in range(0, total, SENTENCES_PER_STEP):
                step = request.texts[first : first + SENTENCES_PER_STEP]
                translations += await run_in_thread(
                    _translate_step, translator, tokenizer, target, step
                )
                done = len(translations)
                await report(done / total, f"Translated {done} of {total} sentences")
            return translations
        finally:
            del translator, tokenizer
            gc.collect()

    def _load(self, profile: TranslationModelProfile) -> tuple[Any, Any]:
        ctranslate2 = import_module("ctranslate2")
        tokenizers = import_module("tokenizers")
        snapshot = profile.snapshot(self._model_root)
        device = self._runtime.device
        translator = ctranslate2.Translator(
            str(snapshot),
            device=device,
            compute_type=COMPUTE_TYPES[device],
            intra_threads=self._runtime.cpu_threads or usable_cpu_count(),
        )
        tokenizer = tokenizers.Tokenizer.from_file(str(snapshot / "tokenizer.json"))
        return translator, tokenizer

    async def _download(
        self, profile: TranslationModelProfile, report_progress: ProgressReporter
    ) -> None:
        await download_profile(
            profile,
            self._model_root,
            report_progress,
            command=(sys.executable, "-m", DOWNLOAD_MODULE, str(self._model_root)),
        )

    @property
    def _model_root(self) -> Path:
        return self._runtime.model_root / ADAPTER_ID

    def _profile(self, model_id: str) -> TranslationModelProfile:
        if model_id != MADLAD_3B.id:
            raise AdapterExecutionError(f"Unknown model: {model_id}.", retryable=False)
        return MADLAD_3B


class InstalledMadladAdapter(MadladAdapter):
    """Skips MADLAD on worker images built without the local model libraries."""

    def __init__(self) -> None:
        for library in ("ctranslate2", "tokenizers"):
            if find_spec(library) is None:
                raise AdapterLibraryMissing(f"{library} is not installed in this worker image")
        super().__init__()


# MADLAD picks the output language from a token such as <2es> before the text.
def _target_token(tokenizer: Any, language: str) -> str:
    token = f"<2{base_language(language)}>"
    if tokenizer.token_to_id(token) is None:
        raise TranslationError(
            f"The local model cannot translate into {language}. Choose another language, or "
            "a provider's model.",
            retryable=False,
        )
    return token


def _translate_step(
    translator: Any, tokenizer: Any, target: str, texts: tuple[str, ...]
) -> list[str]:
    sources = [tokenizer.encode(f"{target} {text}").tokens for text in texts]
    results = translator.translate_batch(
        sources, beam_size=BEAM_SIZE, max_batch_size=SENTENCES_PER_STEP
    )
    return [
        tokenizer.decode(
            [tokenizer.token_to_id(token) for token in result.hypotheses[0]],
            skip_special_tokens=True,
        ).strip()
        for result in results
    ]
