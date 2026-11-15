from __future__ import annotations

from ..models import MediaProbeArtifact, MediaProbeStream


def audio_streams(probe: MediaProbeArtifact) -> list[MediaProbeStream]:
    return [stream for stream in probe.streams if stream.type == "audio"]


def audio_stream(probe: MediaProbeArtifact, track: int) -> MediaProbeStream | None:
    streams = audio_streams(probe)
    return streams[track] if track < len(streams) else None


def audio_track_map(track: int) -> tuple[str, str]:
    """Picks the track explicitly: without it, ffmpeg takes the one with the most channels."""
    return ("-map", f"0:a:{track}")
