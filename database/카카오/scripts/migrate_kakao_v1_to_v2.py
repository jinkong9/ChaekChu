#!/usr/bin/env python3
"""Convert legacy Kakao request-envelope parts to the v2 book-per-line contract."""

from __future__ import annotations

import argparse
import hashlib
import json
from datetime import datetime
from pathlib import Path
from typing import Any

from kakao_book_common import (
    merge_normalize_and_report,
    raw_book,
    utc_now,
    write_json,
)


def parse_args() -> argparse.Namespace:
    root = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description="카카오 v1 Raw 파트를 v2 도서 단위 파트로 변환")
    parser.add_argument("--output-dir", type=Path, default=root, help="카카오 데이터 루트")
    parser.add_argument("--stamp", default="", help="Processed 파일명 날짜 YYYYMMDD")
    parser.add_argument("--sample-size", type=int, default=10)
    parser.add_argument("--overwrite", action="store_true", help="이미 존재하는 v2 변환 결과를 교체")
    return parser.parse_args()


def load_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def part_number(path: Path) -> int:
    return int(path.stem.rsplit("_", 1)[-1])


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_data_manifest(output: Path, stamp: str, result: dict[str, int]) -> Path:
    parts_dir = output / "raw" / "parts"
    raw_parts = []
    for done_path in sorted(parts_dir.glob("title_*.done.json")):
        metadata = load_json(done_path, {})
        data_path = done_path.with_name(done_path.name.replace(".done.json", ".jsonl"))
        raw_parts.append({
            "path": str(data_path.relative_to(output)).replace("\\", "/"),
            "status": metadata.get("status"),
            "request_count": int(metadata.get("request_count", 0) or 0),
            "record_count": int(metadata.get("document_count", 0) or 0),
            "bytes": data_path.stat().st_size,
        })

    processed_files = []
    for name in (
        f"books_merged_quota_{stamp}.jsonl",
        f"books_normalized_quota_{stamp}.jsonl",
    ):
        path = output / "processed" / name
        processed_files.append({
            "path": str(path.relative_to(output)).replace("\\", "/"),
            "record_count": int(result["unique_count"]),
            "bytes": path.stat().st_size,
            "sha256": sha256_file(path),
        })

    state = load_json(output / "metadata" / "title_crawl_v2.runtime.json", {})
    manifest_path = output / "metadata" / "data_manifest.json"
    write_json(manifest_path, {
        "schema_version": 2,
        "created_at": utc_now(),
        "raw_record_unit": "one book document per JSONL line",
        "source_v1_preserved": True,
        "raw_record_count": int(result["raw_count"]),
        "unique_record_count": int(result["unique_count"]),
        "duplicate_record_count": int(result["duplicate_count"]),
        "raw_parts": raw_parts,
        "processed_files": processed_files,
        "resume": {
            "query_index": state.get("query_index"),
            "page": state.get("page"),
            "next_part_number": state.get("part_number"),
        },
    })
    return manifest_path


def convert_part(
    *,
    source_path: Path,
    target_path: Path,
    cache: dict[str, dict[str, Any]],
    overwrite: bool,
) -> tuple[int, int]:
    if target_path.exists() and not overwrite:
        raise FileExistsError(f"v2 대상이 이미 존재합니다: {target_path}")
    temporary = target_path.with_name(target_path.name + ".migrating")
    temporary.unlink(missing_ok=True)
    request_count = 0
    document_count = 0

    with source_path.open("r", encoding="utf-8") as source, temporary.open("w", encoding="utf-8") as target:
        for line_number, line in enumerate(source, 1):
            if not line.strip():
                continue
            try:
                envelope = json.loads(line)
            except json.JSONDecodeError as error:
                temporary.unlink(missing_ok=True)
                raise ValueError(f"{source_path.name}:{line_number} JSON 오류") from error
            if not isinstance(envelope, dict) or not isinstance(envelope.get("response"), dict):
                temporary.unlink(missing_ok=True)
                raise ValueError(f"{source_path.name}:{line_number}은 v1 응답 래퍼가 아닙니다.")

            request = envelope.get("request") if isinstance(envelope.get("request"), dict) else {}
            response = envelope["response"]
            documents = response.get("documents") if isinstance(response.get("documents"), list) else []
            query = str(request.get("query") or "")
            request_target = request.get("target") or "title"
            page = int(request.get("page") or 1)
            collected_at = str(envelope.get("collected_at") or utc_now())
            http_status = int(envelope.get("http_status") or 200)
            request_count += 1

            for document in documents:
                if not isinstance(document, dict):
                    continue
                target.write(json.dumps(raw_book(
                    document,
                    query=query,
                    target=request_target,
                    page=page,
                    collected_at=collected_at,
                    http_status=http_status,
                ), ensure_ascii=False) + "\n")
                document_count += 1

            meta = response.get("meta") if isinstance(response.get("meta"), dict) else {}
            entry = cache.setdefault(query, {
                "target": request_target,
                "total_count": int(meta.get("total_count", 0) or 0),
                "page_count": 0,
                "document_count": 0,
                "is_end_observed": False,
            })
            entry["total_count"] = int(meta.get("total_count", entry["total_count"]) or 0)
            entry["page_count"] = max(int(entry["page_count"]), page)
            entry["document_count"] = int(entry["document_count"]) + len(documents)
            entry["is_end_observed"] = bool(entry["is_end_observed"] or meta.get("is_end", False))

    if target_path.exists() and overwrite:
        target_path.unlink()
    temporary.replace(target_path)
    return request_count, document_count


def main() -> int:
    args = parse_args()
    output = args.output_dir.resolve()
    parts_dir = output / "raw" / "parts"
    metadata_dir = output / "metadata"
    processed_dir = output / "processed"
    reports_dir = output / "reports"
    samples_dir = output / "samples"
    for directory in (parts_dir, metadata_dir, processed_dir, reports_dir, samples_dir):
        directory.mkdir(parents=True, exist_ok=True)

    sources = sorted(parts_dir.glob("books_raw_part_*.jsonl"), key=part_number)
    if not sources:
        print("변환할 books_raw_part_*.jsonl 파일이 없습니다.")
        return 2

    legacy_state_path = metadata_dir / "quota_crawl.runtime.json"
    legacy_state = load_json(legacy_state_path, {})
    unresolved = load_json(metadata_dir / "unresolved_ranges.json", [])
    if not isinstance(unresolved, list):
        unresolved = []
    cache: dict[str, dict[str, Any]] = {}
    completed_targets: list[Path] = []
    converted_parts: list[dict[str, Any]] = []
    total_requests = 0
    total_documents = 0
    partial_part_number: int | None = None

    for source in sources:
        number = part_number(source)
        legacy_done_path = source.with_suffix(".done.json")
        completed = legacy_done_path.exists()
        target = parts_dir / f"title_{number:06d}.jsonl"
        requests, documents = convert_part(
            source_path=source,
            target_path=target,
            cache=cache,
            overwrite=args.overwrite,
        )
        total_requests += requests
        total_documents += documents
        converted_parts.append({
            "source": source.name,
            "target": target.name,
            "status": "completed" if completed else "closed_at_migration_boundary",
            "request_count": requests,
            "document_count": documents,
        })

        legacy_done = load_json(legacy_done_path, {})
        write_json(parts_dir / f"title_{number:06d}.done.json", {
            "name": f"title_{number:06d}",
            "scope": "quota_crawl",
            "status": "completed" if completed else "closed_at_migration_boundary",
            "request_count": requests,
            "document_count": documents,
            "completed_at": legacy_done.get("completed_at") or utc_now(),
            "migrated_at": utc_now(),
            "source_v1_part": source.name,
            "stop_reason": (
                "migrated_from_completed_v1_part"
                if completed else "closed_partial_v1_part_for_v2_migration"
            ),
        })
        completed_targets.append(target)
        if not completed:
            partial_part_number = number
            (parts_dir / f"title_{number:06d}.part").unlink(missing_ok=True)

        print(
            f"[{number}/{len(sources)}] {source.name} -> {target.name} "
            f"requests={requests:,} books={documents:,}",
            flush=True,
        )

    expected_raw_records = int(legacy_state.get("raw_records", total_documents) or total_documents)
    state_count_difference = total_documents - expected_raw_records
    if state_count_difference:
        print(
            f"[주의] v1 상태 건수={expected_raw_records:,}, 물리 Raw 건수={total_documents:,}, "
            f"차이={state_count_difference:+,}. 재실행 append 이력을 물리 Raw 기준으로 보존합니다.",
            flush=True,
        )

    write_json(metadata_dir / "range_count_cache.json", cache)
    write_json(metadata_dir / "range_plan.json", {
        "created_at": utc_now(),
        "api": "Kakao Book Search",
        "endpoint": "https://dapi.kakao.com/v3/search/book",
        "scope": "quota_crawl_migration",
        "raw_record_unit": "one book document per JSONL line",
        "source_format": "v1 request envelope",
        "target_format": "v2 book document",
        "source_part_count": len(sources),
        "completed_v1_part_count": len(completed_targets) - (1 if partial_part_number is not None else 0),
        "migration_boundary_part_count": 1 if partial_part_number is not None else 0,
        "source_request_count": total_requests,
        "source_document_count": total_documents,
        "legacy_state_document_count": expected_raw_records,
        "state_count_difference": state_count_difference,
        "parts": converted_parts,
        "note": "기존 v1 Raw를 API 재호출 없이 변환한 실행 계획",
    })

    if partial_part_number is not None:
        legacy_request_count = int(legacy_state.get("request_count", 0) or 0)
        write_json(metadata_dir / "title_crawl_v2.runtime.json", {
            "schema_version": 2,
            "query_index": int(legacy_state.get("query_index", 0) or 0),
            "page": int(legacy_state.get("page", 1) or 1),
            "total_request_count": max(total_requests, legacy_request_count),
            "raw_records": total_documents,
            "part_number": partial_part_number + 1,
            "part_requests": 0,
            "part_documents": 0,
            "started_at": legacy_state.get("started_at") or utc_now(),
            "updated_at": legacy_state.get("updated_at") or utc_now(),
            "migrated_at": utc_now(),
            "source_state": legacy_state_path.name,
        })

    stamp = args.stamp or datetime.now().strftime("%Y%m%d")
    result = merge_normalize_and_report(
        parts=completed_targets,
        merged_path=processed_dir / f"books_merged_quota_{stamp}.jsonl",
        processed_path=processed_dir / f"books_normalized_quota_{stamp}.jsonl",
        sample_jsonl_path=samples_dir / "sample_books.jsonl",
        sample_pretty_path=samples_dir / "sample_books.pretty.json",
        report_path=reports_dir / "missing_report_quota_crawl.csv",
        summary_path=reports_dir / "data_quality_summary_quota_crawl.txt",
        database_path=metadata_dir / "title_merge.sqlite3",
        unresolved=unresolved,
        scope="quota_crawl_completed_parts",
        sample_size=args.sample_size,
    )
    manifest_path = write_data_manifest(output, stamp, result)
    print(
        f"migration complete source_books={total_documents:,} "
        f"completed_part_books={result['raw_count']:,} unique={result['unique_count']:,} "
        f"manifest={manifest_path}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
