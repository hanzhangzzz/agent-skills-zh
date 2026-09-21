#!/usr/bin/env python3
"""Bootstrap a pinned, local pdf-inspector OCR runtime on Apple Silicon macOS."""

from __future__ import annotations

import argparse
import concurrent.futures
import fcntl
import hashlib
import json
import os
import platform
import shutil
import sys
import tarfile
import tempfile
import urllib.request
import zipfile
from dataclasses import asdict, dataclass
from pathlib import Path


RUNTIME_ID = "pdf-inspector-1.17.0_pp-ocrv6-small-oar-v0.7.0"
DEFAULT_RUNTIME_DIR = (
    Path.home() / "Library" / "Caches" / "scanned-book-ocr" / RUNTIME_ID
)


@dataclass(frozen=True)
class Asset:
    name: str
    url: str
    size: int
    sha256: str
    kind: str


ASSETS = (
    Asset(
        "pdf_inspector-1.17.0-cp38-abi3-macosx_11_0_arm64.whl",
        "https://files.pythonhosted.org/packages/58/d9/f49a1de9b6871c1b11c0aa4c184a295fb141605e0f5ba746a6fbae8b8ce1/pdf_inspector-1.17.0-cp38-abi3-macosx_11_0_arm64.whl",
        4_590_233,
        "05845dcf5af014787b50e16e38fe13409e95d6c40abff9372b0b358154bd3318",
        "wheel",
    ),
    Asset(
        "firecrawl-pdfium-mac-arm64.tgz",
        "https://github.com/firecrawl/pdfium-rs/releases/download/native-v7988/firecrawl-pdfium-mac-arm64.tgz",
        3_460_583,
        "4168356c2e62ad5e79553e2e9162f5c99949759d90cb83876a50311f0c32b9b3",
        "pdfium",
    ),
    Asset(
        "onnxruntime-osx-arm64-1.27.0.tgz",
        "https://github.com/microsoft/onnxruntime/releases/download/v1.27.0/onnxruntime-osx-arm64-1.27.0.tgz",
        32_485_368,
        "545e81c58152353acb0d1e8bd6ce4b62f830c0961f5b3acfedc790ffd76e477a",
        "onnx",
    ),
    Asset(
        "pp-ocrv6_small_det.onnx",
        "https://github.com/GreatV/oar-ocr/releases/download/v0.7.0/pp-ocrv6_small_det.onnx",
        9_880_512,
        "d73e0058b7a8086bbd57f3d10b8bcd4ff95363f67e06e2762b5e814fe9c9410e",
        "model",
    ),
    Asset(
        "pp-ocrv6_small_rec.onnx",
        "https://github.com/GreatV/oar-ocr/releases/download/v0.7.0/pp-ocrv6_small_rec.onnx",
        21_159_378,
        "5435fd747c9e0efe15a96d0b378d5bd157e9492ed8fd80edf08f30d02fa24634",
        "model",
    ),
    Asset(
        "ppocrv6_dict.txt",
        "https://github.com/GreatV/oar-ocr/releases/download/v0.7.0/ppocrv6_dict.txt",
        74_947,
        "b5f2bfe2bdd9448429e3e82b51c789775d9b42f2403d082b00662eb77e401c5d",
        "model",
    ),
)


def sha256_path(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def asset_valid(path: Path, asset: Asset) -> bool:
    return (
        path.is_file()
        and path.stat().st_size == asset.size
        and sha256_path(path) == asset.sha256
    )


def _fetch_range(asset: Asset, start: int, end: int) -> tuple[int, bytes]:
    request = urllib.request.Request(
        asset.url,
        headers={
            "Range": f"bytes={start}-{end}",
            "User-Agent": "scanned-book-ocr/1",
        },
    )
    with urllib.request.urlopen(request, timeout=600) as response:
        if response.status != 206:
            raise RuntimeError(
                f"{asset.name}: expected HTTP 206 for range {start}-{end}, "
                f"got {response.status}"
            )
        data = response.read()
    expected = end - start + 1
    if len(data) != expected:
        raise RuntimeError(
            f"{asset.name}: range {start}-{end} returned {len(data)} bytes, "
            f"expected {expected}"
        )
    return start, data


def download_asset(asset: Asset, destination: Path, workers: int = 8) -> None:
    if asset_valid(destination, asset):
        return
    destination.parent.mkdir(parents=True, exist_ok=True)
    worker_count = max(1, min(workers, 8, asset.size))
    chunk_size = (asset.size + worker_count - 1) // worker_count
    ranges = [
        (start, min(asset.size - 1, start + chunk_size - 1))
        for start in range(0, asset.size, chunk_size)
    ]
    buffer = bytearray(asset.size)
    with concurrent.futures.ThreadPoolExecutor(max_workers=len(ranges)) as pool:
        futures = [pool.submit(_fetch_range, asset, start, end) for start, end in ranges]
        for future in concurrent.futures.as_completed(futures):
            start, data = future.result()
            buffer[start : start + len(data)] = data
    digest = hashlib.sha256(buffer).hexdigest()
    if digest != asset.sha256:
        raise RuntimeError(
            f"{asset.name}: SHA-256 mismatch; expected {asset.sha256}, got {digest}"
        )
    temp_path = destination.with_name(destination.name + ".tmp")
    with temp_path.open("wb") as stream:
        stream.write(buffer)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temp_path, destination)


def _safe_target(root: Path, name: str) -> Path:
    target = (root / name).resolve()
    if root.resolve() not in (target, *target.parents):
        raise RuntimeError(f"archive member escapes destination: {name}")
    return target


def extract_zip(source: Path, destination: Path) -> None:
    with zipfile.ZipFile(source) as archive:
        for member in archive.infolist():
            _safe_target(destination, member.filename)
        archive.extractall(destination)


def extract_tar(source: Path, destination: Path) -> None:
    with tarfile.open(source, "r:gz") as archive:
        for member in archive.getmembers():
            _safe_target(destination, member.name)
            if member.issym():
                link = Path(member.name).parent / member.linkname
                _safe_target(destination, str(link))
            elif member.islnk():
                _safe_target(destination, member.linkname)
        archive.extractall(destination, filter="data")


def _find_one(root: Path, name: str) -> Path:
    matches = [
        path
        for path in root.rglob(name)
        if path.is_file() and not any(part.endswith(".dSYM") for part in path.parts)
    ]
    if len(matches) != 1:
        raise RuntimeError(f"expected one {name} under {root}, found {len(matches)}")
    return matches[0]


def runtime_manifest_path(runtime_dir: Path) -> Path:
    return runtime_dir / "runtime-manifest.json"


def load_runtime_manifest(path: Path) -> dict:
    data = json.loads(path.read_text(encoding="utf-8"))
    if data.get("runtime_id") != RUNTIME_ID:
        raise RuntimeError(f"unexpected runtime id in {path}")
    root = path.parent
    for key in ("site_packages", "pdfium_library", "onnxruntime_library", "model_directory"):
        target = root / data[key]
        if not target.exists():
            raise RuntimeError(f"runtime manifest target missing: {target}")
    downloads = root / "downloads"
    for asset in ASSETS:
        if not asset_valid(downloads / asset.name, asset):
            raise RuntimeError(f"runtime asset failed verification: {asset.name}")
    return data


def ensure_runtime(runtime_dir: Path = DEFAULT_RUNTIME_DIR, workers: int = 8) -> Path:
    if sys.platform != "darwin" or platform.machine() != "arm64":
        raise RuntimeError("this pinned runtime currently supports Apple Silicon macOS only")
    if sys.version_info < (3, 12):
        raise RuntimeError("Python 3.12 or newer is required")

    runtime_dir = runtime_dir.expanduser().resolve()
    runtime_dir.mkdir(parents=True, exist_ok=True)
    lock_path = runtime_dir.parent / f".{runtime_dir.name}.lock"
    with lock_path.open("a+b") as lock_stream:
        fcntl.flock(lock_stream.fileno(), fcntl.LOCK_EX)
        for stale_staging in runtime_dir.glob("extract-*"):
            if stale_staging.is_dir():
                shutil.rmtree(stale_staging)
        manifest_path = runtime_manifest_path(runtime_dir)
        if manifest_path.exists():
            load_runtime_manifest(manifest_path)
            return manifest_path

        downloads = runtime_dir / "downloads"
        downloads.mkdir(parents=True, exist_ok=True)
        for asset in ASSETS:
            print(f"bootstrap: {asset.name}", file=sys.stderr, flush=True)
            download_asset(asset, downloads / asset.name, workers=workers)

        staging = Path(tempfile.mkdtemp(prefix="extract-", dir=runtime_dir))
        try:
            site_packages = staging / "site-packages"
            pdfium_root = staging / "pdfium"
            onnx_root = staging / "onnxruntime"
            models = staging / "models" / "pp-ocrv6-small" / "oar-ocr-v0.7.0"
            for directory in (site_packages, pdfium_root, onnx_root, models):
                directory.mkdir(parents=True, exist_ok=True)

            extract_zip(downloads / ASSETS[0].name, site_packages)
            extract_tar(downloads / ASSETS[1].name, pdfium_root)
            extract_tar(downloads / ASSETS[2].name, onnx_root)
            for asset in ASSETS[3:]:
                shutil.copy2(downloads / asset.name, models / asset.name)

            pdfium_library = _find_one(pdfium_root, "libpdfium.dylib")
            onnxruntime_library = _find_one(onnx_root, "libonnxruntime.1.27.0.dylib")
            final_site = runtime_dir / "site-packages"
            final_pdfium = runtime_dir / "pdfium"
            final_onnx = runtime_dir / "onnxruntime"
            final_models = runtime_dir / "models"
            for source, target in (
                (site_packages, final_site),
                (pdfium_root, final_pdfium),
                (onnx_root, final_onnx),
                (staging / "models", final_models),
            ):
                if target.exists():
                    raise RuntimeError(f"refusing to replace existing runtime path: {target}")
                os.replace(source, target)

            manifest = {
                "schema_version": 1,
                "runtime_id": RUNTIME_ID,
                "platform": "macos-arm64",
                "python_abi": "cp38-abi3",
                "site_packages": str(final_site.relative_to(runtime_dir)),
                "pdfium_library": str(
                    (final_pdfium / pdfium_library.relative_to(pdfium_root)).relative_to(runtime_dir)
                ),
                "onnxruntime_library": str(
                    (final_onnx / onnxruntime_library.relative_to(onnx_root)).relative_to(runtime_dir)
                ),
                "model_directory": str(
                    (final_models / "pp-ocrv6-small" / "oar-ocr-v0.7.0").relative_to(runtime_dir)
                ),
                "assets": [asdict(asset) for asset in ASSETS],
            }
            temp_manifest = manifest_path.with_suffix(".json.tmp")
            temp_manifest.write_text(
                json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            os.replace(temp_manifest, manifest_path)
        finally:
            shutil.rmtree(staging, ignore_errors=True)

        load_runtime_manifest(manifest_path)
        return manifest_path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--runtime-dir", type=Path, default=DEFAULT_RUNTIME_DIR)
    parser.add_argument("--download-workers", type=int, default=8)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    manifest_path = ensure_runtime(args.runtime_dir, workers=args.download_workers)
    if args.json:
        print(manifest_path.read_text(encoding="utf-8"), end="")
    else:
        print(manifest_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
