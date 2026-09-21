#!/usr/bin/env python3
"""Internal worker for deterministic page batches. Invoke through ocr_book.py."""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path


def load_runtime(manifest_path: Path) -> tuple[dict, Path]:
    manifest_path = manifest_path.resolve()
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    root = manifest_path.parent
    sys.path.insert(0, str(root / manifest["site_packages"]))
    os.environ["PDFIUM_LIB_PATH"] = str(root / manifest["pdfium_library"])
    os.environ["ORT_DYLIB_PATH"] = str(root / manifest["onnxruntime_library"])
    return manifest, root


def parse_pages(value: str) -> list[int]:
    pages = [int(part) for part in value.split(",") if part]
    if not pages or any(page < 1 for page in pages) or len(set(pages)) != len(pages):
        raise ValueError("pages must be unique positive 1-indexed integers")
    return pages


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--runtime-manifest", required=True, type=Path)
    parser.add_argument("--pdf", required=True, type=Path)
    parser.add_argument("--pages")
    parser.add_argument("--dpi", type=float, default=300.0)
    parser.add_argument("--detect-only", action="store_true")
    args = parser.parse_args()

    manifest, root = load_runtime(args.runtime_manifest)
    import pdf_inspector  # type: ignore

    if args.detect_only:
        started = time.perf_counter()
        result = pdf_inspector.detect_pdf(str(args.pdf))
        payload = {
            "runtime_id": manifest["runtime_id"],
            "pdf_type": result.pdf_type,
            "page_count": result.page_count,
            "confidence": result.confidence,
            "pages_needing_ocr": result.pages_needing_ocr,
            "processing_time_ms": result.processing_time_ms,
            "wall_time_ms": round((time.perf_counter() - started) * 1000, 3),
        }
    else:
        if not args.pages:
            parser.error("--pages is required unless --detect-only is used")
        pages = parse_pages(args.pages)
        started = time.perf_counter()
        result = pdf_inspector.process_pdf_with_ocr(
            str(args.pdf),
            mode="force",
            page_numbers=pages,
            dpi=args.dpi,
            minimum_confidence=0.0,
            hosted_recommendation_confidence=0.5,
            model_directory=str(root / manifest["model_directory"]),
            offline=True,
        )
        payload = {
            "runtime_id": manifest["runtime_id"],
            "page_count": result.page_count,
            "requested_pages": pages,
            "pages_routed_to_ocr": result.pages_routed_to_ocr,
            "pages_recommending_hosted": result.pages_recommending_hosted,
            "processing_time_ms": result.processing_time_ms,
            "render_time_ms": result.render_time_ms,
            "ocr_time_ms": result.ocr_time_ms,
            "wall_time_ms": round((time.perf_counter() - started) * 1000, 3),
            "pages": [
                {
                    "page_number": page.page_number,
                    "markdown": page.markdown,
                    "source": page.provenance.source,
                    "ocr_confidence": page.provenance.ocr_confidence,
                    "render_dpi": page.provenance.render_dpi,
                    "warnings": page.provenance.warnings,
                    "hosted_recommended": page.provenance.hosted_recommended,
                    "timings": {
                        "render_ms": page.provenance.timings.render_ms,
                        "ocr_ms": page.provenance.timings.ocr_ms,
                        "assembly_ms": page.provenance.timings.assembly_ms,
                    },
                }
                for page in result.pages
            ],
        }
    json.dump(payload, sys.stdout, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
