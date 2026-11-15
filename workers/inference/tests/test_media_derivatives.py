from pathlib import Path

import pytest

from anysub_worker.media import derivatives, process, waveform
from anysub_worker.media.errors import MediaToolTimeoutError
from anysub_worker.models import (
    MediaAudioDetails,
    MediaProbeArtifact,
    MediaProbeStream,
    MediaVideoDetails,
)


async def test_thumbnail_does_not_retry_after_a_timeout(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    calls = 0

    async def timing_out(*_args: object, **_kwargs: object) -> process.MediaToolResult:
        nonlocal calls
        calls += 1
        raise MediaToolTimeoutError("ffmpeg timed out")

    monkeypatch.setattr(derivatives, "run_media_tool", timing_out)

    with pytest.raises(MediaToolTimeoutError):
        await derivatives.generate_thumbnail(tmp_path / "source.mp4", tmp_path, 600_000_000)

    assert calls == 1


async def test_thumbnail_scales_down_wide_video_but_never_up(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    filters: list[str] = []

    async def writing_thumbnail(arguments: list[str], _timeout: float) -> process.MediaToolResult:
        filters.append(arguments[arguments.index("-vf") + 1])
        Path(arguments[-1]).write_bytes(b"jpeg")
        return process.MediaToolResult(stdout=b"", stderr="")

    monkeypatch.setattr(derivatives, "run_media_tool", writing_thumbnail)

    await derivatives.generate_thumbnail(tmp_path / "source.mp4", tmp_path, 600_000_000)

    assert filters == ["scale='min(640,iw)':-2"]


def probe_of(*streams: MediaProbeStream) -> MediaProbeArtifact:
    return MediaProbeArtifact(
        durationUs=10_000_000,
        formatNames=(),
        seekable=False,
        frameRateMode="constant",
        proxyRecommended=True,
        proxyReasons=(),
        streams=streams,
    )


VIDEO = MediaProbeStream(
    index=0, type="video", codec="h264", video=MediaVideoDetails(width=1280, height=720)
)


def audio(index: int) -> MediaProbeStream:
    return MediaProbeStream(index=index, type="audio", codec="aac", audio=MediaAudioDetails())


def capture_maps(monkeypatch: pytest.MonkeyPatch, module: object) -> list[list[str]]:
    maps: list[list[str]] = []

    async def recording(
        arguments: list[str], _timeout: float, **_kwargs: object
    ) -> process.MediaToolResult:
        maps.append([arguments[i + 1] for i, value in enumerate(arguments) if value == "-map"])
        if not arguments[-1].startswith("pipe:"):
            Path(arguments[-1]).write_bytes(b"media")
        return process.MediaToolResult(stdout=b"", stderr="")

    monkeypatch.setattr(module, "run_media_tool", recording)
    return maps


@pytest.mark.parametrize(
    ("streams", "expected"),
    [
        ((VIDEO, audio(1), audio(2)), ["0:V:0", "0:a:1"]),
        ((audio(0), audio(1)), ["0:a:1"]),
    ],
)
async def test_the_preview_carries_the_chosen_audio_track(
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Path,
    streams: tuple[MediaProbeStream, ...],
    expected: list[str],
) -> None:
    maps = capture_maps(monkeypatch, derivatives)

    await derivatives.generate_proxy(tmp_path / "source.mkv", tmp_path, probe_of(*streams), 1)

    assert maps == [expected]


async def test_a_video_without_audio_gets_a_silent_preview(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    maps = capture_maps(monkeypatch, derivatives)

    await derivatives.generate_proxy(tmp_path / "source.mkv", tmp_path, probe_of(VIDEO), 0)

    assert maps == [["0:V:0"]]


async def test_the_waveform_reads_the_chosen_audio_track(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    maps: list[list[str]] = []

    async def sampling(
        arguments: list[str], _timeout: float, *, on_stdout: object
    ) -> process.MediaToolResult:
        maps.append([arguments[i + 1] for i, value in enumerate(arguments) if value == "-map"])
        assert callable(on_stdout)
        on_stdout(b"\x00\x10" * 8_000)
        return process.MediaToolResult(stdout=b"", stderr="")

    monkeypatch.setattr(waveform, "run_media_tool", sampling)

    await waveform.generate_waveform(tmp_path / "source.mkv", tmp_path, 1_000_000, 2)

    assert maps == [["0:a:2"]]
