from __future__ import annotations

from ..errors import JobError


class TranslationError(JobError):
    code = "translation_error"
