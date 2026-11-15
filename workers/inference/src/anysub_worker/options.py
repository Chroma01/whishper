from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .adapter import AdapterExecutionError


@dataclass(frozen=True)
class BooleanOption:
    name: str
    default: bool
    description: str

    def schema(self) -> dict[str, Any]:
        return {"type": "boolean", "default": self.default, "description": self.description}

    def parse(self, options: dict[str, Any]) -> bool:
        value = options.get(self.name, self.default)
        if not isinstance(value, bool):
            raise AdapterExecutionError(f"{self.name} must be a boolean.", retryable=False)
        return value


@dataclass(frozen=True)
class ChoiceOption:
    name: str
    choices: tuple[str, ...]
    default: str
    description: str

    def schema(self) -> dict[str, Any]:
        return {
            "type": "string",
            "enum": list(self.choices),
            "default": self.default,
            "description": self.description,
        }

    def parse(self, options: dict[str, Any]) -> str:
        value = options.get(self.name, self.default)
        if value not in self.choices:
            raise AdapterExecutionError(
                f"{self.name} must be one of {', '.join(self.choices)}.", retryable=False
            )
        return value


@dataclass(frozen=True)
class IntegerOption:
    name: str
    minimum: int
    maximum: int
    description: str
    # Left out of the schema when the default depends on the worker.
    default: int | None = None

    def schema(self) -> dict[str, Any]:
        schema: dict[str, Any] = {
            "type": "integer",
            "minimum": self.minimum,
            "maximum": self.maximum,
            "description": self.description,
        }
        if self.default is not None:
            schema["default"] = self.default
        return schema

    def parse(self, options: dict[str, Any], *, default: int | None = None) -> int:
        value = options.get(self.name, self.default if default is None else default)
        if (
            isinstance(value, bool)
            or not isinstance(value, int)
            or not self.minimum <= value <= self.maximum
        ):
            raise AdapterExecutionError(
                f"{self.name} must be an integer between {self.minimum} and {self.maximum}.",
                retryable=False,
            )
        return value


@dataclass(frozen=True)
class TextOption:
    name: str
    max_length: int
    description: str

    def schema(self) -> dict[str, Any]:
        return {"type": "string", "maxLength": self.max_length, "description": self.description}

    def parse(self, options: dict[str, Any]) -> str | None:
        value = options.get(self.name, "")
        if not isinstance(value, str) or len(value) > self.max_length:
            raise AdapterExecutionError(
                f"{self.name} must be text of at most {self.max_length} characters.",
                retryable=False,
            )
        return value.strip() or None


MAX_LINE_LENGTH = IntegerOption(
    name="maxLineLength",
    minimum=20,
    maximum=120,
    default=42,
    description="Maximum subtitle cue length in characters.",
)
PROMPT = TextOption(
    name="prompt",
    max_length=500,
    description="Names, terms or a sentence in the spoken language, to help with spelling.",
)
