from __future__ import annotations

from importlib import import_module
from pathlib import Path
from typing import Any

from anysub_worker.adapter import require_audio_track
from anysub_worker.media.probe import normalize_probe, probe_source
from anysub_worker.media.process import run_media_tool, scaled_timeout_seconds
from anysub_worker.media.tracks import audio_track_map

# The rate WhisperX's models are trained on.
SAMPLE_RATE = 16_000
DECODE_SECONDS_PER_MEDIA_SECOND = 0.25
DECODE_TIMEOUT_FLOOR_SECONDS = 120


async def load_audio_track(source: Path, track: int) -> Any:
    """Decodes one audio track to the mono float samples whisperx.load_audio returns.

    whisperx.load_audio cannot pick a track, so ffmpeg would choose the one with the
    most channels.
    """
    probe = normalize_probe(await probe_source(source))
    require_audio_track(probe, track)
    samples = bytearray()
    await run_media_tool(
        [
            "-v",
            "error",
            "-nostdin",
            "-i",
            str(source),
            *audio_track_map(track),
            "-ac",
            "1",
            "-ar",
            str(SAMPLE_RATE),
            "-f",
            "f32le",
            "pipe:1",
        ],
        scaled_timeout_seconds(
            probe.duration_us, DECODE_SECONDS_PER_MEDIA_SECOND, DECODE_TIMEOUT_FLOOR_SECONDS
        ),
        on_stdout=samples.extend,
    )
    # NumPy comes with WhisperX, which the remote-only worker image leaves out.
    numpy = import_module("numpy")
    return numpy.frombuffer(samples, dtype=numpy.float32)
