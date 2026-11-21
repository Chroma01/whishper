from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

GIB = 1024**3


@dataclass(frozen=True)
class TranslationModelProfile:
    id: str
    display_name: str
    description: str
    parameter_count: int
    recommended_ram_bytes: int
    download_size_bytes: int
    repository: str
    # Pinned, so every worker runs the same weights.
    revision: str
    files: tuple[str, ...]

    # The Hugging Face cache layout huggingface_hub downloads into.
    def cache_directory(self, model_root: Path) -> Path:
        return model_root / f"models--{self.repository.replace('/', '--')}"

    def snapshot(self, model_root: Path) -> Path:
        return self.cache_directory(model_root) / "snapshots" / self.revision

    def is_downloaded(self, model_root: Path) -> bool:
        snapshot = self.snapshot(model_root)
        return all((snapshot / name).is_file() for name in self.files)


MADLAD_3B = TranslationModelProfile(
    id="madlad-400-3b",
    display_name="MADLAD-400 3B",
    description=(
        "Translates between more than 400 languages on this server. Literal; review the "
        "result before publishing."
    ),
    parameter_count=3_000_000_000,
    recommended_ram_bytes=6 * GIB,
    download_size_bytes=2_972_314_683,
    repository="Nextcloud-AI/madlad400-3b-mt-ct2-int8",
    revision="aa32bbdeba7880eff2096ec044cb155a340a9400",
    files=("config.json", "model.bin", "shared_vocabulary.json", "tokenizer.json"),
)
