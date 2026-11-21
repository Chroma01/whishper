from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass
from typing import Any

import httpx

from ..errors import describe_error
from ..models import RemoteModelAccess
from ..retry import Sleep
from ..translation.errors import TranslationError
from .api import (
    REQUEST_ATTEMPTS,
    RETRYABLE_STATUSES,
    redacted_detail,
    send_limited,
    wait_before_retry,
)

REQUEST_TIMEOUT = httpx.Timeout(connect=15, read=300, write=60, pool=15)
MAX_RESPONSE_BYTES = 4 * 1024 * 1024


class TruncatedReply(TranslationError):
    """The model stopped at its output limit, so a smaller batch may fit."""

    def __init__(self) -> None:
        super().__init__("The model's reply was cut off.", retryable=True)


@dataclass(frozen=True)
class ChatApi:
    access: RemoteModelAccess
    client: httpx.AsyncClient
    sleep: Sleep = asyncio.sleep

    async def reply(self, messages: list[dict[str, str]]) -> str:
        failures = 0
        while True:
            try:
                response = await self._post(messages)
            except httpx.TransportError as error:
                failures += 1
                if failures >= REQUEST_ATTEMPTS:
                    raise TranslationError(
                        f"Could not reach {self.access.provider_name}: {describe_error(error)}",
                        retryable=False,
                    ) from error
                await wait_before_retry(
                    self.access, self.sleep, failures, None, describe_error(error)
                )
                continue
            if response.status_code in RETRYABLE_STATUSES:
                failures += 1
                if failures >= REQUEST_ATTEMPTS:
                    raise self._failure(response)
                await wait_before_retry(
                    self.access, self.sleep, failures, response, f"HTTP {response.status_code}"
                )
                continue
            if response.is_error:
                raise self._failure(response)
            return self._content(response)

    async def _post(self, messages: list[dict[str, str]]) -> httpx.Response:
        api_key = self.access.api_key
        headers = {"Authorization": f"Bearer {api_key.get_secret_value()}"} if api_key else {}
        request = self.client.build_request(
            "POST",
            f"{self.access.base_url.rstrip('/')}/chat/completions",
            json={"model": self.access.model, "messages": messages},
            headers=headers,
            timeout=REQUEST_TIMEOUT,
        )
        return await send_limited(
            self.client,
            request,
            MAX_RESPONSE_BYTES,
            lambda: TranslationError(
                f"{self.access.provider_name} answered with more than "
                f"{MAX_RESPONSE_BYTES // (1024 * 1024)} MB, which is not a translation.",
                retryable=False,
            ),
        )

    def _content(self, response: httpx.Response) -> str:
        try:
            body: Any = response.json()
            choice = body["choices"][0]
            content = choice["message"]["content"]
        except (json.JSONDecodeError, KeyError, IndexError, TypeError) as error:
            raise TranslationError(
                f"{self.access.provider_name} did not answer like an OpenAI-compatible chat "
                "API. Check the base URL and the model.",
                retryable=False,
            ) from error
        if choice.get("finish_reason") == "length":
            raise TruncatedReply()
        if not isinstance(content, str):
            raise TranslationError(
                f"{self.access.model} on {self.access.provider_name} returned no text.",
                retryable=False,
            )
        return content

    def _failure(self, response: httpx.Response) -> TranslationError:
        provider = self.access.provider_name
        detail = redacted_detail(self.access, response)
        status = response.status_code
        suffix = f" ({detail})" if detail else ""
        if status in (401, 403):
            message = (
                f"{provider} rejected the API key{suffix}. Check the key in Administration, "
                "External providers."
            )
        elif status == 404:
            message = (
                f"{provider} has no chat model named {self.access.model}, or the base URL "
                f"is wrong{suffix}."
            )
        elif status == 429:
            message = (
                f"{provider} kept limiting requests{suffix}. Try again later, or raise the "
                "account's limits."
            )
        elif response.is_server_error or status in RETRYABLE_STATUSES:
            message = f"{provider} failed with HTTP {status}{suffix}. Try again later."
        else:
            message = f"{provider} refused the request with HTTP {status}{suffix}."
        return TranslationError(message, retryable=False)
