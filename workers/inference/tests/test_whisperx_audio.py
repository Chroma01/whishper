import sys
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from anysub_worker.adapter import AdapterExecutionError
from anysub_worker.adapters.whisperx import audio
from anysub_worker.media.process import MediaToolResult

AUDIO = {"index": 1, "codec_type": "audio", "codec_name": "aac"}


def fake_probe(monkeypatch: pytest.MonkeyPatch, streams: list[dict[str, Any]]) -> None:
    async def probe(source: Path) -> dict[str, Any]:
        return {"format": {"duration": "60.0"}, "streams": streams}

    monkeypatch.setattr(audio, "probe_source", probe)


async def test_decodes_the_chosen_track_to_mono_float_samples(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    fake_probe(monkeypatch, [{**AUDIO, "index": 0}, AUDIO])
    calls: list[list[str]] = []

    async def decoding(arguments: list[str], _timeout: float, *, on_stdout: Any) -> MediaToolResult:
        calls.append(arguments)
        on_stdout(b"\x00\x00\x80\x3f")
        return MediaToolResult(stdout=b"", stderr="")

    monkeypatch.setattr(audio, "run_media_tool", decoding)
    monkeypatch.setitem(
        sys.modules,
        "numpy",
        SimpleNamespace(float32="float32", frombuffer=lambda buffer, dtype: (bytes(buffer), dtype)),
    )

    samples = await audio.load_audio_track(tmp_path / "episode.mkv", 1)

    assert samples == (b"\x00\x00\x80\x3f", "float32")
    [arguments] = calls
    assert arguments[arguments.index("-map") + 1] == "0:a:1"
    assert arguments[arguments.index("-ar") + 1] == "16000"
    assert arguments[arguments.index("-f") + 1] == "f32le"


async def test_a_missing_track_is_refused_before_decoding(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    fake_probe(monkeypatch, [AUDIO])

    async def unexpected(*_args: object, **_kwargs: object) -> MediaToolResult:
        raise AssertionError("ffmpeg must not run")

    monkeypatch.setattr(audio, "run_media_tool", unexpected)

    with pytest.raises(AdapterExecutionError, match="no audio track 3") as raised:
        await audio.load_audio_track(tmp_path / "episode.mkv", 2)

    assert raised.value.retryable is False


async def test_a_file_without_audio_says_so(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    fake_probe(monkeypatch, [{"index": 0, "codec_type": "video", "codec_name": "h264"}])

    with pytest.raises(AdapterExecutionError, match=r"^The file has no audio\.$") as raised:
        await audio.load_audio_track(tmp_path / "episode.mkv", 0)

    assert raised.value.retryable is False
