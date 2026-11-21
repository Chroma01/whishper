import json

import httpx
import pytest
from pydantic import SecretStr

from anysub_worker.models import RemoteModelAccess
from anysub_worker.translation import remote
from anysub_worker.translation.errors import TranslationError
from anysub_worker.translation.remote import translate_remotely

ACCESS = RemoteModelAccess(
    providerName="OpenRouter",
    baseUrl="https://llm.test/v1/",
    apiKey=SecretStr("sk-secret-value"),
    model="some-chat-model",
)


async def no_sleep(delay: float) -> None:
    return None


async def no_progress(fraction: float, message: str) -> None:
    return None


def chat_reply(content: str, finish_reason: str = "stop") -> httpx.Response:
    return httpx.Response(
        200,
        json={"choices": [{"message": {"content": content}, "finish_reason": finish_reason}]},
    )


def sent_lines(request: httpx.Request) -> dict[str, str]:
    return json.loads(json.loads(request.content)["messages"][1]["content"])["lines"]


def echo_upper(request: httpx.Request) -> httpx.Response:
    lines = sent_lines(request)
    return chat_reply(json.dumps({key: value.upper() for key, value in lines.items()}))


async def translate(
    texts: list[str], handler: httpx.MockTransport, progress=no_progress
) -> list[str]:
    return await translate_remotely(
        texts,
        ACCESS,
        "Some Chat Model",
        "English",
        "Spanish",
        progress,
        transport=handler,
        sleep=no_sleep,
    )


async def test_each_line_comes_back_in_order_with_context_and_languages_sent() -> None:
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return echo_upper(request)

    result = await translate(["one", "two"], httpx.MockTransport(handler))

    assert result == ["ONE", "TWO"]
    body = json.loads(requests[0].content)
    assert str(requests[0].url) == "https://llm.test/v1/chat/completions"
    assert requests[0].headers["authorization"] == "Bearer sk-secret-value"
    assert body["model"] == "some-chat-model"
    assert "from English to Spanish" in body["messages"][0]["content"]


async def test_large_input_is_sent_in_batches_with_the_lines_around_them(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(remote, "MAX_BATCH_SENTENCES", 2)
    payloads: list[dict[str, object]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        payloads.append(json.loads(json.loads(request.content)["messages"][1]["content"]))
        return echo_upper(request)

    result = await translate(["a", "b", "c", "d", "e"], httpx.MockTransport(handler))

    assert result == ["A", "B", "C", "D", "E"]
    second = next(payload for payload in payloads if payload["lines"] == {"1": "c", "2": "d"})
    assert second["before"] == ["a", "b"]
    assert second["after"] == ["e"]


async def test_a_reply_in_a_code_fence_after_thinking_is_read() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return chat_reply('<think>{"1": "no"}</think>\n```json\n{"1": "uno"}\n```')

    assert await translate(["one"], httpx.MockTransport(handler)) == ["uno"]


async def test_a_reply_missing_lines_is_asked_again_then_split() -> None:
    sizes: list[int] = []

    def handler(request: httpx.Request) -> httpx.Response:
        lines = sent_lines(request)
        sizes.append(len(lines))
        if len(lines) > 1:
            return chat_reply(json.dumps({"1": "merged"}))
        return echo_upper(request)

    result = await translate(["one", "two"], httpx.MockTransport(handler))

    assert result == ["ONE", "TWO"]
    assert sizes == [2, 2, 1, 1]


async def test_a_cut_off_reply_is_split_at_once() -> None:
    sizes: list[int] = []

    def handler(request: httpx.Request) -> httpx.Response:
        sizes.append(len(sent_lines(request)))
        if len(sent_lines(request)) > 1:
            return chat_reply('{"1": "u', finish_reason="length")
        return echo_upper(request)

    assert await translate(["one", "two"], httpx.MockTransport(handler)) == ["ONE", "TWO"]
    assert sizes == [2, 1, 1]


async def test_a_line_the_model_never_translates_fails_the_job() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return chat_reply('{"1": ""}')

    with pytest.raises(TranslationError, match="did not return a usable translation") as raised:
        await translate(["one"], httpx.MockTransport(handler))

    assert raised.value.retryable is False


async def test_a_rejected_key_names_the_provider_without_echoing_the_key() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, json={"error": {"message": "bad key sk-secret-value"}})

    with pytest.raises(TranslationError) as raised:
        await translate(["one"], httpx.MockTransport(handler))

    assert "OpenRouter rejected the API key" in str(raised.value)
    assert "sk-secret-value" not in str(raised.value)


async def test_busy_providers_are_retried() -> None:
    calls = 0

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        if calls == 1:
            return httpx.Response(429, headers={"retry-after": "1"})
        return echo_upper(request)

    assert await translate(["one"], httpx.MockTransport(handler)) == ["ONE"]
    assert calls == 2


async def test_progress_counts_translated_sentences() -> None:
    updates: list[tuple[float, str]] = []

    async def progress(fraction: float, message: str) -> None:
        updates.append((fraction, message))

    await translate(["one", "two"], httpx.MockTransport(echo_upper), progress)

    assert updates[0] == (0.0, "Translating with Some Chat Model")
    assert updates[-1] == (1.0, "Translated 2 of 2 sentences")


async def test_a_reply_far_longer_than_its_line_is_not_accepted() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        return chat_reply(json.dumps({"1": "bla " * 200}))

    with pytest.raises(TranslationError, match="did not return a usable translation"):
        await translate(["one"], httpx.MockTransport(handler))
