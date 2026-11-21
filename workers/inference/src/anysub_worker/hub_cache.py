"""Downloads and removes models kept in the Hugging Face cache layout."""

from __future__ import annotations

import asyncio
import os
import shutil
from collections.abc import Sequence
from pathlib import Path
from typing import Protocol

from .adapter import AdapterExecutionError, ProgressReporter
from .threads import run_in_thread

PROGRESS_INTERVAL_SECONDS = 1.0
# The download size is an estimate, so only an exited download reports complete.
MAX_RUNNING_PROGRESS = 0.99
STDERR_TAIL_BYTES = 4 * 1024


class HubModel(Protocol):
    @property
    def display_name(self) -> str: ...

    @property
    def download_size_bytes(self) -> int: ...

    def cache_directory(self, model_root: Path) -> Path: ...

    def is_downloaded(self, model_root: Path) -> bool: ...


# The command runs as a child process that downloads the model into
# model_root, so that a cancelled download stops at once instead of finishing
# in an abandoned thread.
async def download_profile(
    profile: HubModel,
    model_root: Path,
    report_progress: ProgressReporter,
    *,
    command: Sequence[str],
) -> None:
    model_root.mkdir(parents=True, exist_ok=True)
    try:
        _require_free_space(profile, model_root)
        await _run_download(profile, model_root, report_progress, command)
    except AdapterExecutionError as error:
        # huggingface_hub resumes the partial files a failed download leaves, so
        # they stay for the retry and only a failure that ends the job removes them.
        if not error.retryable:
            _discard_unfinished(profile, model_root)
        raise
    except asyncio.CancelledError:
        # A cancelled download is usually one the admin stopped on purpose, and
        # the models page can only remove a model that finished downloading.
        _discard_unfinished(profile, model_root)
        raise
    await report_progress(1.0, f"Downloaded {profile.display_name}")


async def _run_download(
    profile: HubModel,
    model_root: Path,
    report_progress: ProgressReporter,
    command: Sequence[str],
) -> None:
    message = f"Downloading {profile.display_name}"
    await report_progress(_downloaded_fraction(profile, model_root), message)
    process = await asyncio.create_subprocess_exec(
        *command,
        stdin=asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.PIPE,
        # The Xet transfer client writes each file only once all of it has
        # arrived, so the partial file would stay empty. Plain HTTP fills it
        # as bytes come in, which is what the progress reads.
        env={**os.environ, "HF_HUB_DISABLE_XET": "1"},
    )
    assert process.stderr is not None
    stderr = asyncio.create_task(process.stderr.read())
    try:
        while True:
            try:
                async with asyncio.timeout(PROGRESS_INTERVAL_SECONDS):
                    await process.wait()
                break
            except TimeoutError:
                await report_progress(_downloaded_fraction(profile, model_root), message)
        error_output = (await stderr)[-STDERR_TAIL_BYTES:].decode(errors="replace")
    except BaseException:
        stderr.cancel()
        if process.returncode is None:
            process.kill()
            await process.wait()
        raise

    if process.returncode != 0:
        detail = _last_line(error_output) or f"exit status {process.returncode}"
        raise AdapterExecutionError(
            f"The {profile.display_name} model could not be downloaded ({detail}). Check that "
            "the worker can reach huggingface.co, then try again.",
            retryable=True,
        )
    if not profile.is_downloaded(model_root):
        raise AdapterExecutionError(
            f"The {profile.display_name} model download finished without all of its files.",
            retryable=True,
        )


async def delete_profile(profile: HubModel, model_root: Path) -> None:
    cache_directory = profile.cache_directory(model_root)
    lock_directory = model_root / ".locks" / cache_directory.name
    for directory in (cache_directory, lock_directory):
        await run_in_thread(shutil.rmtree, directory, ignore_errors=True)


def _require_free_space(profile: HubModel, model_root: Path) -> None:
    # Partial files count as free space: the download resumes them, and a
    # download that does not fit removes them.
    usable = shutil.disk_usage(model_root).free + _blob_bytes(profile, model_root)
    if profile.download_size_bytes > usable:
        raise AdapterExecutionError(
            f"The {profile.display_name} model needs "
            f"{_gigabytes(profile.download_size_bytes)} of free space, but the model volume "
            f"has {_gigabytes(usable)} left. Remove a model or free up disk space, then try "
            "again.",
            retryable=False,
        )


def _downloaded_fraction(profile: HubModel, model_root: Path) -> float:
    return min(_blob_bytes(profile, model_root) / profile.download_size_bytes, MAX_RUNNING_PROGRESS)


def _blob_bytes(profile: HubModel, model_root: Path) -> int:
    return _directory_bytes(profile.cache_directory(model_root) / "blobs")


def _directory_bytes(directory: Path) -> int:
    total = 0
    try:
        entries = tuple(directory.iterdir())
    except OSError:
        return 0
    for entry in entries:
        try:
            if entry.is_file() and not entry.is_symlink():
                total += entry.stat().st_size
        except OSError:
            continue
    return total


def _discard_unfinished(profile: HubModel, model_root: Path) -> None:
    if not profile.is_downloaded(model_root):
        shutil.rmtree(profile.cache_directory(model_root), ignore_errors=True)


def _last_line(text: str) -> str:
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    return lines[-1] if lines else ""


def _gigabytes(size: int) -> str:
    return f"{size / 1024**3:.1f} GiB"
