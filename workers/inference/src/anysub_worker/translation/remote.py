from __future__ import annotations

import asyncio
import json
import logging
import re
from dataclasses import dataclass

import httpx

from ..adapter import ProgressReporter
from ..models import RemoteModelAccess
from ..remote.chat import ChatApi, TruncatedReply
from ..retry import Sleep
from .errors import TranslationError

LOGGER = logging.getLogger(__name__)
MAX_BATCH_SENTENCES = 40
MAX_BATCH_CHARACTERS = 3_000
CONTEXT_BEFORE = 3
CONTEXT_AFTER = 2
PARALLEL_REQUESTS = 3
# A reply that leaves out or adds lines is asked again once before the batch
# is split, since models slip now and then.
ATTEMPTS_PER_BATCH = 2
# A reply far longer than its line is the model going astray, and fitting it
# into subtitles would only waste time.
MAX_GROWTH = 4
MAX_EXTRA_CHARACTERS = 200
THINKING = re.compile(r"<think>.*?</think>", re.DOTALL)

SYSTEM_PROMPT = """\
You translate subtitles from {source} to {target}.

You get a JSON object. "lines" maps numbers to subtitle lines. "before" and \
"after" hold the lines around them, only to help you understand; never \
translate them.

Answer with only a JSON object that maps every number in "lines" to its \
translation, with exactly the same numbers. Translate every line by itself; \
never merge or split lines.

Write natural spoken {target}, the way a professional subtitler would: \
short, clear and easy to read at a glance, never longer than needed. Keep \
the meaning and tone, including informal speech. Keep names as they are. \
Keep technical terms, numbers and units correct. Add no notes or \
explanations."""


@dataclass(frozen=True)
class _Batch:
    first: int
    lines: list[str]


async def translate_remotely(
    texts: list[str],
    access: RemoteModelAccess,
    model_name: str,
    source_name: str,
    target_name: str,
    report: ProgressReporter,
    *,
    transport: httpx.AsyncBaseTransport | None = None,
    sleep: Sleep = asyncio.sleep,
) -> list[str]:
    translations: list[str | None] = [None] * len(texts)
    system = SYSTEM_PROMPT.format(source=source_name, target=target_name)
    limit = asyncio.Semaphore(PARALLEL_REQUESTS)
    # Batches finish together, and their reports must not arrive out of order.
    reporting = asyncio.Lock()
    done = 0

    async with httpx.AsyncClient(transport=transport) as client:
        api = ChatApi(access, client, sleep)

        async def run(batch: _Batch) -> None:
            nonlocal done
            async with limit:
                lines = await _translate_batch(api, system, texts, batch)
            translations[batch.first : batch.first + len(lines)] = lines
            async with reporting:
                done += len(lines)
                await report(done / len(texts), f"Translated {done} of {len(texts)} sentences")

        await report(0.0, f"Translating with {model_name}")
        # The first failure cancels the other batches. It is raised unwrapped,
        # so the job reports its message and retry policy.
        try:
            async with asyncio.TaskGroup() as group:
                for batch in _batches(texts):
                    group.create_task(run(batch))
        except ExceptionGroup as failures:
            error = failures.exceptions[0]
            raise error from error.__cause__
    return [translation or "" for translation in translations]


def _batches(texts: list[str]) -> list[_Batch]:
    batches: list[_Batch] = []
    first = 0
    while first < len(texts):
        size = 0
        characters = 0
        while (
            first + size < len(texts)
            and size < MAX_BATCH_SENTENCES
            and (size == 0 or characters + len(texts[first + size]) <= MAX_BATCH_CHARACTERS)
        ):
            characters += len(texts[first + size])
            size += 1
        batches.append(_Batch(first, texts[first : first + size]))
        first += size
    return batches


async def _translate_batch(api: ChatApi, system: str, texts: list[str], batch: _Batch) -> list[str]:
    problem = ""
    for _ in range(ATTEMPTS_PER_BATCH):
        try:
            reply = await api.reply(_messages(system, texts, batch))
        except TruncatedReply:
            problem = "the reply was cut off"
            break
        lines = _parse_reply(reply, batch.lines)
        if lines is not None:
            return lines
        problem = "the reply did not match the lines sent"
    if len(batch.lines) > 1:
        LOGGER.info("splitting a batch of %d lines: %s", len(batch.lines), problem)
        middle = len(batch.lines) // 2
        halves = (
            _Batch(batch.first, batch.lines[:middle]),
            _Batch(batch.first + middle, batch.lines[middle:]),
        )
        return [
            line for half in halves for line in await _translate_batch(api, system, texts, half)
        ]
    raise TranslationError(
        f"{api.access.model} on {api.access.provider_name} did not return a usable "
        f"translation ({problem}). Try again, or choose another model.",
        retryable=False,
    )


def _messages(system: str, texts: list[str], batch: _Batch) -> list[dict[str, str]]:
    after = batch.first + len(batch.lines)
    content = {
        "before": texts[max(0, batch.first - CONTEXT_BEFORE) : batch.first],
        "lines": {str(index + 1): line for index, line in enumerate(batch.lines)},
        "after": texts[after : after + CONTEXT_AFTER],
    }
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": json.dumps(content, ensure_ascii=False)},
    ]


# Models often wrap JSON in a code fence or think aloud first, so the reply is
# read from its first brace to its last.
def _parse_reply(reply: str, lines: list[str]) -> list[str] | None:
    text = THINKING.sub("", reply)
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end < start:
        return None
    try:
        parsed = json.loads(text[start : end + 1])
    except json.JSONDecodeError:
        return None
    expected = [str(index + 1) for index in range(len(lines))]
    if not isinstance(parsed, dict) or sorted(parsed) != sorted(expected):
        return None
    translated: list[str] = []
    for key, source in zip(expected, lines, strict=True):
        value = parsed[key]
        if not isinstance(value, str) or (source.strip() and not value.strip()):
            return None
        if len(value) > MAX_GROWTH * len(source) + MAX_EXTRA_CHARACTERS:
            return None
        translated.append(value.strip())
    return translated
