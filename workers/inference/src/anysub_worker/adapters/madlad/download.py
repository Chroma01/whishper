"""Downloads one translation model into the cache. Runs as a child process so
that a cancelled download stops at once instead of finishing in an abandoned
thread."""

from __future__ import annotations

import sys
from importlib import import_module

from .profile import MADLAD_3B


def main() -> int:
    cache_directory = sys.argv[1]
    try:
        snapshot_download = import_module("huggingface_hub").snapshot_download
        snapshot_download(
            MADLAD_3B.repository,
            revision=MADLAD_3B.revision,
            allow_patterns=list(MADLAD_3B.files),
            cache_dir=cache_directory,
        )
    except Exception as error:
        print(f"{type(error).__name__}: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
