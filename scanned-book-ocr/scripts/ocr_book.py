#!/usr/bin/env python3
"""Benchmark, convert, and validate scanned-book OCR with pinned dependencies."""

from __future__ import annotations

import argparse
import concurrent.futures
import hashlib
import json
import os
import re
import statistics
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Any

from bootstrap_runtime import DEFAULT_RUNTIME_DIR, ensure_runtime, load_runtime_manifest


SCRIPT_DIR = Path(__file__).resolve().parent
WORKER = SCRIPT_DIR / "ocr_worker.py"
DEFAULT_DPI = 300.0


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_path(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def atomic_write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".tmp")
    with temporary.open("w", encoding="utf-8", newline="\n") as stream:
        stream.write(text)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)


def atomic_write_json(path: Path, payload: dict[str, Any]) -> None:
    atomic_write_text(
        path,
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
    )


def normalize_text(text: str) -> str:
    lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    lines = [line.rstrip() for line in lines]
    while lines and not lines[0]:
        lines.pop(0)
    while lines and not lines[-1]:
        lines.pop()
    return "\n".join(lines) + ("\n" if lines else "")


def parse_pages(value: str, page_count: int | None = None) -> list[int]:
    pages: set[int] = set()
    for raw_part in value.split(","):
        part = raw_part.strip()
        if not part:
            continue
        if "-" in part:
            start_text, end_text = part.split("-", 1)
            start, end = int(start_text), int(end_text)
            if start > end:
                raise ValueError(f"descending page range is not allowed: {part}")
            pages.update(range(start, end + 1))
        else:
            pages.add(int(part))
    if not pages or min(pages) < 1:
        raise ValueError("page selection must contain positive 1-indexed pages")
    if page_count is not None and max(pages) > page_count:
        raise ValueError(f"page selection exceeds document page count {page_count}")
    return sorted(pages)


def default_benchmark_pages(page_count: int) -> list[int]:
    anchors = {1, 3, 10, 50, 150, 300, page_count}
    for index in range(18):
        anchors.add(round(1 + index * (page_count - 1) / 17))
    return sorted(page for page in anchors if 1 <= page <= page_count)


def partition_pages(pages: list[int], processes: int) -> list[list[int]]:
    if processes < 1:
        raise ValueError("processes must be positive")
    groups = [[] for _ in range(min(processes, len(pages)))]
    for index, page in enumerate(pages):
        groups[index % len(groups)].append(page)
    return [group for group in groups if group]


def worker_command(
    manifest_path: Path,
    pdf: Path,
    pages: list[int] | None,
    dpi: float,
    detect_only: bool = False,
) -> list[str]:
    command = [
        sys.executable,
        str(WORKER),
        "--runtime-manifest",
        str(manifest_path),
        "--pdf",
        str(pdf),
    ]
    if detect_only:
        command.append("--detect-only")
    else:
        command.extend(["--pages", ",".join(map(str, pages or [])), "--dpi", str(dpi)])
    return command


def invoke_worker(command: list[str]) -> dict[str, Any]:
    completed = subprocess.run(command, text=True, capture_output=True, check=False)
    if completed.returncode != 0:
        raise RuntimeError(
            f"OCR worker failed with exit {completed.returncode}:\n{completed.stderr.strip()}"
        )
    try:
        return json.loads(completed.stdout)
    except json.JSONDecodeError as error:
        raise RuntimeError(f"OCR worker returned invalid JSON: {error}") from error


def detect_pdf(manifest_path: Path, pdf: Path) -> dict[str, Any]:
    return invoke_worker(worker_command(manifest_path, pdf, None, DEFAULT_DPI, detect_only=True))


def run_parallel(
    manifest_path: Path,
    pdf: Path,
    pages: list[int],
    dpi: float,
    processes: int,
) -> dict[str, Any]:
    groups = partition_pages(pages, processes)
    commands = [worker_command(manifest_path, pdf, group, dpi) for group in groups]
    started = time.perf_counter()
    with concurrent.futures.ThreadPoolExecutor(max_workers=len(commands)) as pool:
        worker_results = list(pool.map(invoke_worker, commands))
    wall_time_ms = round((time.perf_counter() - started) * 1000, 3)

    page_results: dict[int, dict[str, Any]] = {}
    hosted: set[int] = set()
    for result in worker_results:
        hosted.update(result["pages_recommending_hosted"])
        for page in result["pages"]:
            number = int(page["page_number"])
            if number in page_results:
                raise RuntimeError(f"duplicate OCR result for page {number}")
            page_results[number] = page
    missing = sorted(set(pages) - set(page_results))
    extras = sorted(set(page_results) - set(pages))
    if missing or extras:
        raise RuntimeError(f"OCR page mismatch: missing={missing}, extras={extras}")
    return {
        "processes": len(groups),
        "wall_time_ms": wall_time_ms,
        "wall_time_ms_per_page": round(wall_time_ms / len(pages), 3),
        "worker_wall_times_ms": [result["wall_time_ms"] for result in worker_results],
        "pages_recommending_hosted": sorted(hosted),
        "pages": [page_results[page] for page in sorted(page_results)],
    }


def page_text_hashes(result: dict[str, Any]) -> dict[str, str]:
    return {
        str(page["page_number"]): sha256_bytes(
            normalize_text(page["markdown"]).encode("utf-8")
        )
        for page in result["pages"]
    }


def command_benchmark(args: argparse.Namespace) -> int:
    manifest_path = ensure_runtime(args.runtime_dir, workers=args.download_workers)
    runtime = load_runtime_manifest(manifest_path)
    detection = detect_pdf(manifest_path, args.pdf)
    page_count = int(detection["page_count"])
    pages = (
        parse_pages(args.pages, page_count)
        if args.pages
        else default_benchmark_pages(page_count)
    )
    candidates = sorted(set(parse_pages(args.processes)))
    if 1 not in candidates:
        candidates.insert(0, 1)

    baseline_hashes: dict[str, str] | None = None
    variants: list[dict[str, Any]] = []
    for processes in candidates:
        timings: list[float] = []
        output_equal = True
        hashes_for_variant: dict[str, str] | None = None
        for repeat in range(args.repeats):
            result = run_parallel(manifest_path, args.pdf, pages, args.dpi, processes)
            hashes = page_text_hashes(result)
            if baseline_hashes is None:
                baseline_hashes = hashes
            if hashes != baseline_hashes:
                output_equal = False
            if hashes_for_variant is None:
                hashes_for_variant = hashes
            elif hashes != hashes_for_variant:
                output_equal = False
            timings.append(float(result["wall_time_ms"]))
            print(
                f"benchmark processes={processes} repeat={repeat + 1} "
                f"wall_ms={result['wall_time_ms']} equal={output_equal}",
                file=sys.stderr,
                flush=True,
            )
        variants.append(
            {
                "processes": processes,
                "output_equal_to_single_process": output_equal,
                "wall_times_ms": timings,
                "median_wall_time_ms": round(statistics.median(timings), 3),
                "median_ms_per_page": round(statistics.median(timings) / len(pages), 3),
            }
        )

    eligible = [variant for variant in variants if variant["output_equal_to_single_process"]]
    if not eligible:
        raise RuntimeError("no concurrency variant reproduced the single-process output")
    selected = min(eligible, key=lambda variant: variant["median_wall_time_ms"])
    report = {
        "schema_version": 1,
        "source_pdf": str(args.pdf.resolve()),
        "source_sha256": sha256_path(args.pdf),
        "runtime_id": runtime["runtime_id"],
        "dpi": args.dpi,
        "quality_invariant": "normalized per-page OCR text SHA-256 equals single-process baseline",
        "sample_pages": pages,
        "sample_page_count": len(pages),
        "repeats": args.repeats,
        "variants": variants,
        "selected_processes": selected["processes"],
    }
    atomic_write_json(args.report, report)
    print(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True))
    return 0


def page_filename(page: int) -> str:
    return f"page-{page:04d}.txt"


def build_combined(page_texts: dict[int, str]) -> str:
    sections = [
        f"=== PDF_PAGE {page:04d} ===\n{page_texts[page].rstrip()}"
        for page in sorted(page_texts)
    ]
    return "\n\n".join(sections) + "\n"


def compatible_benchmark(
    report: dict[str, Any], pdf: Path, source_sha256: str, runtime_id: str, dpi: float
) -> None:
    expected = {
        "source_pdf": str(pdf.resolve()),
        "source_sha256": source_sha256,
        "runtime_id": runtime_id,
        "dpi": dpi,
    }
    mismatches = {key: (report.get(key), value) for key, value in expected.items() if report.get(key) != value}
    if mismatches:
        raise RuntimeError(f"benchmark report is incompatible with this run: {mismatches}")


def command_convert(args: argparse.Namespace) -> int:
    manifest_path = ensure_runtime(args.runtime_dir, workers=args.download_workers)
    runtime = load_runtime_manifest(manifest_path)
    detection = detect_pdf(manifest_path, args.pdf)
    page_count = int(detection["page_count"])
    source_sha256 = sha256_path(args.pdf)
    benchmark = json.loads(args.benchmark_report.read_text(encoding="utf-8"))
    compatible_benchmark(benchmark, args.pdf, source_sha256, runtime["runtime_id"], args.dpi)
    processes = int(benchmark["selected_processes"])

    final_manifest_path = args.output_dir / "manifest.json"
    if final_manifest_path.exists():
        existing = json.loads(final_manifest_path.read_text(encoding="utf-8"))
        if (
            existing.get("source_sha256") == source_sha256
            and existing.get("runtime_id") == runtime["runtime_id"]
            and existing.get("dpi") == args.dpi
            and existing.get("page_count") == page_count
        ):
            print(final_manifest_path)
            return 0
        raise RuntimeError("output directory contains an incompatible completed conversion")
    if args.output_dir.exists() and any(args.output_dir.iterdir()):
        raise RuntimeError("output directory is non-empty but has no compatible manifest")
    args.output_dir.mkdir(parents=True, exist_ok=True)

    run_state_path = args.output_dir / "run-state.json"
    run_state = {
        "schema_version": 1,
        "status": "in_progress",
        "source_pdf": str(args.pdf.resolve()),
        "source_sha256": source_sha256,
        "runtime_id": runtime["runtime_id"],
        "dpi": args.dpi,
        "page_count": page_count,
        "processes": processes,
    }
    atomic_write_json(run_state_path, run_state)

    pages = list(range(1, page_count + 1))
    result = run_parallel(manifest_path, args.pdf, pages, args.dpi, processes)
    page_texts: dict[int, str] = {}
    page_entries: list[dict[str, Any]] = []
    for page in result["pages"]:
        number = int(page["page_number"])
        if page["source"] != "ocr":
            raise RuntimeError(f"page {number} did not come from OCR: {page['source']}")
        if float(page["render_dpi"]) != args.dpi:
            raise RuntimeError(f"page {number} rendered at unexpected DPI {page['render_dpi']}")
        text = normalize_text(page["markdown"])
        page_texts[number] = text
        text_bytes = text.encode("utf-8")
        atomic_write_text(args.output_dir / "pages" / page_filename(number), text)
        page_entries.append(
            {
                "page_number": number,
                "file": f"pages/{page_filename(number)}",
                "sha256": sha256_bytes(text_bytes),
                "char_count": len(text),
                "ocr_confidence": page["ocr_confidence"],
                "source": page["source"],
                "render_dpi": page["render_dpi"],
                "warnings": page["warnings"],
                "hosted_recommended": page["hosted_recommended"],
                "timings": page["timings"],
            }
        )

    combined = build_combined(page_texts)
    atomic_write_text(args.output_dir / "book.txt", combined)
    manifest = {
        "schema_version": 1,
        "source_pdf": str(args.pdf.resolve()),
        "source_sha256": source_sha256,
        "runtime_id": runtime["runtime_id"],
        "model": "PP-OCRv6 Small oar-ocr-v0.7.0",
        "mode": "force",
        "dpi": args.dpi,
        "page_count": page_count,
        "processes": processes,
        "wall_time_ms": result["wall_time_ms"],
        "wall_time_ms_per_page": result["wall_time_ms_per_page"],
        "pages_recommending_hosted": result["pages_recommending_hosted"],
        "combined_file": "book.txt",
        "combined_sha256": sha256_bytes(combined.encode("utf-8")),
        "pages": page_entries,
    }
    atomic_write_json(final_manifest_path, manifest)
    run_state["status"] = "completed"
    run_state["manifest"] = "manifest.json"
    atomic_write_json(run_state_path, run_state)
    print(final_manifest_path)
    return 0


def rotated_page_ocr(
    manifest_path: Path,
    pdf: Path,
    source_page: int,
    degrees_cw: int,
    dpi: float,
) -> dict[str, Any]:
    if degrees_cw not in (90, 180, 270):
        raise ValueError("rotation must be 90, 180, or 270 degrees clockwise")
    with tempfile.TemporaryDirectory(prefix=f"scanned-book-ocr-{source_page:04d}-") as directory:
        root = Path(directory)
        original = root / "page.png"
        rotated = root / "page-rotated.png"
        rotated_pdf = root / "page-rotated.pdf"
        render = subprocess.run(
            [
                "pdftoppm",
                "-f",
                str(source_page),
                "-l",
                str(source_page),
                "-singlefile",
                "-png",
                "-r",
                str(int(dpi)),
                str(pdf),
                str(original.with_suffix("")),
            ],
            text=True,
            capture_output=True,
            check=False,
        )
        if render.returncode != 0:
            raise RuntimeError(f"failed to render page {source_page}: {render.stderr.strip()}")
        rotate = subprocess.run(
            ["sips", "--rotate", str(degrees_cw), str(original), "--out", str(rotated)],
            text=True,
            capture_output=True,
            check=False,
        )
        if rotate.returncode != 0:
            raise RuntimeError(f"failed to rotate page {source_page}: {rotate.stderr.strip()}")
        make_pdf = subprocess.run(
            ["sips", "-s", "format", "pdf", str(rotated), "--out", str(rotated_pdf)],
            text=True,
            capture_output=True,
            check=False,
        )
        if make_pdf.returncode != 0:
            raise RuntimeError(
                f"failed to create rotated PDF for page {source_page}: {make_pdf.stderr.strip()}"
            )
        result = invoke_worker(worker_command(manifest_path, rotated_pdf, [1], dpi))
        page = result["pages"][0]
        if page["source"] != "ocr" or page["hosted_recommended"]:
            raise RuntimeError(f"rotated OCR did not pass for source page {source_page}")
        return page


def command_apply_corrections(args: argparse.Namespace) -> int:
    manifest_path = args.output_dir / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    corrections_bytes = args.corrections.read_bytes()
    corrections_sha256 = sha256_bytes(corrections_bytes)
    existing = manifest.get("corrections")
    if existing:
        if existing.get("sha256") == corrections_sha256:
            print(manifest_path)
            return 0
        raise RuntimeError("a different corrections file has already been applied")
    corrections = json.loads(corrections_bytes)
    if corrections.get("schema_version") != 1:
        raise RuntimeError("unsupported corrections schema")
    if corrections.get("source_sha256") != manifest["source_sha256"]:
        raise RuntimeError("corrections source SHA-256 does not match OCR manifest")

    runtime_manifest = ensure_runtime(args.runtime_dir, workers=args.download_workers)
    pdf = Path(manifest["source_pdf"])
    entries = {int(entry["page_number"]): entry for entry in manifest["pages"]}
    page_texts = {
        page: (args.output_dir / entry["file"]).read_text(encoding="utf-8")
        for page, entry in entries.items()
    }
    applied: dict[int, list[dict[str, Any]]] = {}

    for page_text, degrees in sorted(corrections.get("rotations", {}).items(), key=lambda item: int(item[0])):
        page = int(page_text)
        if page not in entries:
            raise RuntimeError(f"rotation references unknown page {page}")
        rotated = rotated_page_ocr(
            runtime_manifest, pdf, page, int(degrees), float(manifest["dpi"])
        )
        page_texts[page] = normalize_text(rotated["markdown"])
        entry = entries[page]
        entry["ocr_confidence"] = rotated["ocr_confidence"]
        entry["warnings"] = rotated["warnings"]
        entry["hosted_recommended"] = rotated["hosted_recommended"]
        entry["timings"] = rotated["timings"]
        entry["rotation_degrees_cw"] = int(degrees)
        applied.setdefault(page, []).append({"type": "rotate_and_reocr", "degrees_cw": int(degrees)})

    for operation in corrections.get("set_text", []):
        page = int(operation["page"])
        current = page_texts.get(page)
        if current is None:
            raise RuntimeError(f"set_text references unknown page {page}")
        current_sha = sha256_bytes(current.encode("utf-8"))
        if current_sha != operation["expected_sha256"]:
            raise RuntimeError(
                f"page {page} set_text precondition failed: expected "
                f"{operation['expected_sha256']}, got {current_sha}"
            )
        page_texts[page] = normalize_text(operation["text"])
        applied.setdefault(page, []).append({"type": "set_text"})

    for operation in corrections.get("replacements", []):
        page = int(operation["page"])
        current = page_texts.get(page)
        if current is None:
            raise RuntimeError(f"replacement references unknown page {page}")
        old = operation["old"]
        expected_count = int(operation.get("expected_count", 1))
        actual_count = current.count(old)
        if actual_count != expected_count:
            raise RuntimeError(
                f"page {page} replacement precondition failed for {old!r}: "
                f"expected {expected_count}, got {actual_count}"
            )
        page_texts[page] = normalize_text(current.replace(old, operation["new"]))
        applied.setdefault(page, []).append(
            {"type": "replace", "old_sha256": sha256_bytes(old.encode("utf-8"))}
        )

    for page, steps in sorted(applied.items()):
        entry = entries[page]
        original_sha = entry["sha256"]
        text = page_texts[page]
        atomic_write_text(args.output_dir / entry["file"], text)
        entry["original_ocr_sha256"] = original_sha
        entry["sha256"] = sha256_bytes(text.encode("utf-8"))
        entry["char_count"] = len(text)
        entry["correction_steps"] = steps

    combined = build_combined(page_texts)
    atomic_write_text(args.output_dir / manifest["combined_file"], combined)
    manifest["combined_sha256"] = sha256_bytes(combined.encode("utf-8"))
    manifest["pages"] = [entries[page] for page in sorted(entries)]
    manifest["corrections"] = {
        "file": str(args.corrections.resolve()),
        "sha256": corrections_sha256,
        "corrected_pages": sorted(applied),
        "rotation_pages": sorted(int(page) for page in corrections.get("rotations", {})),
        "set_text_pages": sorted(int(item["page"]) for item in corrections.get("set_text", [])),
        "replacement_pages": sorted(
            {int(item["page"]) for item in corrections.get("replacements", [])}
        ),
    }
    atomic_write_json(manifest_path, manifest)
    quality_path = args.output_dir / "quality-report.json"
    if quality_path.exists():
        quality = json.loads(quality_path.read_text(encoding="utf-8"))
        quality["status"] = "stale_after_corrections"
        quality["visual_review"] = {"status": "pending", "reviewed_pages": [], "notes": []}
        atomic_write_json(quality_path, quality)
    print(manifest_path)
    return 0


def chapter_pages(page_texts: dict[int, str]) -> list[int]:
    markdown_heading = re.compile(r"(?m)^#{1,6}\s*第\s*\d+\s*章")
    bilingual_heading = re.compile(r"第\s*\d+\s*章.{0,80}?Chapter\s*\d+", re.DOTALL)
    return sorted(
        page
        for page, text in page_texts.items()
        if markdown_heading.search(text[:500]) or bilingual_heading.search(text[:500])
    )


def render_pages(pdf: Path, pages: list[int], output_dir: Path, dpi: int) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    expected_names = {f"page-{page:04d}.png" for page in pages}
    for existing in output_dir.glob("page-*.png"):
        if existing.name not in expected_names:
            existing.unlink()
    for page in pages:
        target = output_dir / f"page-{page:04d}"
        command = [
            "pdftoppm",
            "-f",
            str(page),
            "-l",
            str(page),
            "-singlefile",
            "-png",
            "-r",
            str(dpi),
            str(pdf),
            str(target),
        ]
        completed = subprocess.run(command, text=True, capture_output=True, check=False)
        if completed.returncode != 0:
            raise RuntimeError(f"failed to render page {page}: {completed.stderr.strip()}")


def command_validate(args: argparse.Namespace) -> int:
    manifest_path = args.output_dir / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    pdf = Path(manifest["source_pdf"])
    structural_errors: list[str] = []
    anomalies: dict[str, Any] = {
        "low_confidence_pages": [],
        "short_pages": [],
        "empty_pages": [],
        "duplicate_consecutive_pages": [],
        "warning_pages": [],
        "hosted_recommended_pages": [],
    }
    if sha256_path(pdf) != manifest["source_sha256"]:
        structural_errors.append("source PDF SHA-256 changed")

    page_count = int(manifest["page_count"])
    entries = {int(entry["page_number"]): entry for entry in manifest["pages"]}
    expected_pages = set(range(1, page_count + 1))
    if set(entries) != expected_pages:
        structural_errors.append("manifest page numbers are incomplete or duplicated")

    page_texts: dict[int, str] = {}
    for page in sorted(expected_pages & set(entries)):
        entry = entries[page]
        path = args.output_dir / entry["file"]
        if not path.is_file():
            structural_errors.append(f"page file missing: {entry['file']}")
            continue
        data = path.read_bytes()
        if sha256_bytes(data) != entry["sha256"]:
            structural_errors.append(f"page hash mismatch: {entry['file']}")
            continue
        text = data.decode("utf-8")
        page_texts[page] = text
        confidence = entry.get("ocr_confidence")
        if confidence is not None and float(confidence) < args.minimum_confidence:
            anomalies["low_confidence_pages"].append(page)
        if not text.strip():
            anomalies["empty_pages"].append(page)
        elif len(text.strip()) < args.short_page_chars:
            anomalies["short_pages"].append(page)
        if entry.get("warnings"):
            anomalies["warning_pages"].append({"page": page, "warnings": entry["warnings"]})
        if entry.get("hosted_recommended"):
            anomalies["hosted_recommended_pages"].append(page)

    for page in range(2, page_count + 1):
        previous = page_texts.get(page - 1, "").strip()
        current = page_texts.get(page, "").strip()
        if len(current) >= args.short_page_chars and current == previous:
            anomalies["duplicate_consecutive_pages"].append([page - 1, page])

    if len(page_texts) == page_count:
        combined = build_combined(page_texts)
        combined_path = args.output_dir / manifest["combined_file"]
        if not combined_path.is_file() or combined_path.read_text(encoding="utf-8") != combined:
            structural_errors.append("combined book text does not match page files")
        elif sha256_bytes(combined.encode("utf-8")) != manifest["combined_sha256"]:
            structural_errors.append("combined book SHA-256 mismatch")

    anchors = {1, 3, 10, 11, 50, 150, 300, page_count}
    anchors.update(range(args.sample_interval, page_count + 1, args.sample_interval))
    anchors.update(chapter_pages(page_texts))
    anchors.update(manifest.get("corrections", {}).get("corrected_pages", []))
    for values in anomalies.values():
        if isinstance(values, list):
            for value in values:
                if isinstance(value, int):
                    anchors.add(value)
                elif isinstance(value, list):
                    anchors.update(item for item in value if isinstance(item, int))
                elif isinstance(value, dict) and isinstance(value.get("page"), int):
                    anchors.add(value["page"])
    sample_pages = sorted(page for page in anchors if 1 <= page <= page_count)

    if args.render_samples:
        render_pages(pdf, sample_pages, args.output_dir / "qa" / "pages", args.qa_dpi)

    automated_status = "passed" if not structural_errors else "failed"
    report = {
        "schema_version": 1,
        "status": "pending_visual_review" if automated_status == "passed" else "failed",
        "automated_status": automated_status,
        "structural_errors": structural_errors,
        "anomalies": anomalies,
        "minimum_confidence": args.minimum_confidence,
        "short_page_chars": args.short_page_chars,
        "sample_interval": args.sample_interval,
        "sample_pages": sample_pages,
        "sample_page_count": len(sample_pages),
        "qa_image_directory": "qa/pages" if args.render_samples else None,
        "visual_review": {"status": "pending", "reviewed_pages": [], "notes": []},
    }
    atomic_write_json(args.output_dir / "quality-report.json", report)
    print(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True))
    return 0 if automated_status == "passed" else 1


def command_record_qa(args: argparse.Namespace) -> int:
    report_path = args.output_dir / "quality-report.json"
    report = json.loads(report_path.read_text(encoding="utf-8"))
    reviewed_pages = parse_pages(args.reviewed_pages)
    required_pages = set(report["sample_pages"])
    missing = sorted(required_pages - set(reviewed_pages))
    if args.status == "passed" and missing:
        raise RuntimeError(f"cannot pass visual QA; unreviewed sample pages: {missing}")
    report["visual_review"] = {
        "status": args.status,
        "reviewed_pages": reviewed_pages,
        "notes": args.note,
    }
    report["status"] = (
        "passed"
        if args.status == "passed" and report.get("automated_status") == "passed"
        else "failed"
    )
    atomic_write_json(report_path, report)
    print(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True))
    return 0 if report["status"] == "passed" else 1


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)

    benchmark = subparsers.add_parser("benchmark")
    benchmark.add_argument("pdf", type=Path)
    benchmark.add_argument("--report", required=True, type=Path)
    benchmark.add_argument("--runtime-dir", type=Path, default=DEFAULT_RUNTIME_DIR)
    benchmark.add_argument("--download-workers", type=int, default=8)
    benchmark.add_argument("--dpi", type=float, default=DEFAULT_DPI)
    benchmark.add_argument("--pages")
    benchmark.add_argument("--processes", default="1,2,3")
    benchmark.add_argument("--repeats", type=int, default=2)
    benchmark.set_defaults(handler=command_benchmark)

    convert = subparsers.add_parser("convert")
    convert.add_argument("pdf", type=Path)
    convert.add_argument("--output-dir", required=True, type=Path)
    convert.add_argument("--benchmark-report", required=True, type=Path)
    convert.add_argument("--runtime-dir", type=Path, default=DEFAULT_RUNTIME_DIR)
    convert.add_argument("--download-workers", type=int, default=8)
    convert.add_argument("--dpi", type=float, default=DEFAULT_DPI)
    convert.set_defaults(handler=command_convert)

    corrections = subparsers.add_parser("apply-corrections")
    corrections.add_argument("--output-dir", required=True, type=Path)
    corrections.add_argument("--corrections", required=True, type=Path)
    corrections.add_argument("--runtime-dir", type=Path, default=DEFAULT_RUNTIME_DIR)
    corrections.add_argument("--download-workers", type=int, default=8)
    corrections.set_defaults(handler=command_apply_corrections)

    validate = subparsers.add_parser("validate")
    validate.add_argument("--output-dir", required=True, type=Path)
    validate.add_argument("--minimum-confidence", type=float, default=0.97)
    validate.add_argument("--short-page-chars", type=int, default=40)
    validate.add_argument("--sample-interval", type=int, default=20)
    validate.add_argument("--render-samples", action="store_true")
    validate.add_argument("--qa-dpi", type=int, default=300)
    validate.set_defaults(handler=command_validate)

    record = subparsers.add_parser("record-qa")
    record.add_argument("--output-dir", required=True, type=Path)
    record.add_argument("--status", choices=("passed", "failed"), required=True)
    record.add_argument("--reviewed-pages", required=True)
    record.add_argument("--note", action="append", default=[])
    record.set_defaults(handler=command_record_qa)
    return parser


def main() -> int:
    args = build_parser().parse_args()
    return args.handler(args)


if __name__ == "__main__":
    raise SystemExit(main())
