import pytest
from fakes import RecordingClient
from pydantic import SecretStr

from anysub_worker import execution
from anysub_worker.adapter import ProgressReporter, TextTranslationRequest
from anysub_worker.models import (
    REMOTE_ADAPTER_ID,
    AdapterCapability,
    AdapterManifest,
    AdapterModel,
    JobCompletion,
    RemoteModelAccess,
    SourceCue,
    TranslationJobCompletion,
    TranslationJobPayload,
    WorkerLease,
)
from anysub_worker.registry import AdapterRegistry


class ReversingAdapter:
    @property
    def manifest(self) -> AdapterManifest:
        return AdapterManifest(
            id="reverser",
            displayName="Reverser",
            version="1.0.0",
            models=(
                AdapterModel(
                    id="reverse",
                    displayName="Reverse",
                    capabilities=(AdapterCapability.TRANSLATE,),
                ),
            ),
        )

    async def translate(
        self, request: TextTranslationRequest, report_progress: ProgressReporter
    ) -> list[str]:
        return [" ".join(reversed(text.split(" "))) for text in request.texts]


class CompletionClient(RecordingClient):
    def __init__(self) -> None:
        super().__init__()
        self.completions: list[JobCompletion] = []

    async def complete(self, lease: WorkerLease, completion: JobCompletion) -> None:
        self.completions.append(completion)


def lease(adapter_id: str = "reverser", remote: RemoteModelAccess | None = None) -> WorkerLease:
    return WorkerLease(
        jobId="job-translate",
        attempt=1,
        leaseToken="lease-token",
        leaseExpiresAt="2026-11-17T00:00:00Z",
        payload=TranslationJobPayload(
            kind="translate",
            adapterId=adapter_id,
            modelId="reverse",
            modelName="Reverse",
            projectId="project-1",
            sourceTrackId="track-1",
            sourceRevision=3,
            sourceLanguage="en",
            targetLanguage="es",
            sourceLanguageName="English",
            targetLanguageName="Spanish",
            maxLineLength=42,
            cues=(
                SourceCue(startUs=0, endUs=1_000_000, text="one two"),
                SourceCue(startUs=1_000_000, endUs=2_000_000, text="three four."),
            ),
        ),
        remote=remote,
    )


async def test_a_local_translation_completes_with_the_source_timing() -> None:
    client = CompletionClient()

    await execution.execute_job(client, AdapterRegistry((ReversingAdapter(),)), lease())

    assert client.failures == []
    [completion] = client.completions
    assert isinstance(completion, TranslationJobCompletion)
    assert completion.language == "es"
    assert completion.adapter.id == "reverser"
    assert [(cue.start_us, cue.end_us, cue.text) for cue in completion.cues] == [
        (0, 1_000_000, "four."),
        (1_000_000, 2_000_000, "three two one"),
    ]


async def test_a_remote_translation_uses_the_provider_in_the_lease(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    access = RemoteModelAccess(
        providerName="OpenAI", baseUrl="https://llm.test", apiKey=SecretStr("k"), model="chat"
    )
    used: list[tuple[RemoteModelAccess, str, str]] = []

    async def translate(
        texts: list[str],
        given: RemoteModelAccess,
        model_name: str,
        source: str,
        target: str,
        report: ProgressReporter,
    ) -> list[str]:
        used.append((given, source, target))
        return [text.upper() for text in texts]

    monkeypatch.setattr(execution, "translate_remotely", translate)
    client = CompletionClient()

    await execution.execute_job(client, AdapterRegistry(()), lease(REMOTE_ADAPTER_ID, access))

    assert used == [(access, "English", "Spanish")]
    [completion] = client.completions
    assert isinstance(completion, TranslationJobCompletion)
    assert completion.adapter.model_id == "chat"
    assert " ".join(cue.text for cue in completion.cues) == "ONE TWO THREE FOUR."


async def test_a_remote_translation_without_provider_details_fails_for_good() -> None:
    client = CompletionClient()

    await execution.execute_job(client, AdapterRegistry(()), lease(REMOTE_ADAPTER_ID))

    assert client.failures[0].code == "adapter_unavailable"
    assert client.failures[0].retryable is False


async def test_a_transcript_without_text_fails_with_a_translation_error() -> None:
    client = CompletionClient()
    empty = lease()
    empty = empty.model_copy(update={"payload": empty.payload.model_copy(update={"cues": ()})})

    await execution.execute_job(client, AdapterRegistry((ReversingAdapter(),)), empty)

    assert client.failures[0].code == "translation_error"
    assert "no text" in client.failures[0].message
