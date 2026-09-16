from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping, Protocol

from recommendation.tag_index import ValidatedTagSidecar


class PayloadStore(Protocol):
    def update_payloads(self, version: str, updates: Mapping[str, Mapping[str, Any]]) -> int: ...


@dataclass(frozen=True, slots=True)
class TagPayloadSyncRunner:
    """Copy sidecar tags onto the points of an already promoted index version.

    Why this exists: the 450k books index was embedded and promoted with taxonomy v1 tags. Adding tag codes
    that are derived purely from KDC rules must not cost a re-embedding pass (GMS credits, hours) — the vectors
    do not change, only ``tagCodes``/``tagScores``/``tagConfidence``/``tagVersion`` in the payload do. Qdrant's
    set-payload merges fields, so every other payload field (serials, loan history, relations) stays as indexed.

    Points that are in the index but not in the sidecar are left untouched: the sidecar is validated against the
    same input snapshot, so a missing ISBN means the tags batch produced no record for it, not that tags were removed.
    """

    store: PayloadStore
    index_version: str
    batch_size: int = 256

    def __post_init__(self) -> None:
        if not self.index_version.strip():
            raise ValueError("index_version must not be empty")
        if self.batch_size < 1:
            raise ValueError("batch_size must be positive")

    def run(self, sidecar: ValidatedTagSidecar) -> dict[str, Any]:
        items = list(sidecar.records.items())
        updated = 0
        batches = 0
        for start in range(0, len(items), self.batch_size):
            chunk = items[start : start + self.batch_size]
            updates = {
                isbn13: {
                    "tagCodes": list(payload.tag_codes),
                    "tagScores": dict(payload.tag_scores),
                    "tagConfidence": dict(payload.tag_confidence),
                    "tagVersion": sidecar.tag_version,
                }
                for isbn13, payload in chunk
            }
            updated += self.store.update_payloads(self.index_version, updates)
            batches += 1
        return {
            "batchVersion": "d4l-tag-payload-sync-v1",
            "status": "SUCCESS" if items else "EMPTY",
            "indexVersion": self.index_version,
            "tagVersion": sidecar.tag_version,
            "taxonomyVersion": sidecar.taxonomy_version,
            "inputHash": sidecar.input_hash,
            "sidecarHash": sidecar.file_hash,
            "rows": len(items),
            "updatedRows": updated,
            "skippedRows": len(items) - updated,
            "batches": batches,
            "batchSize": self.batch_size,
        }


__all__ = ["PayloadStore", "TagPayloadSyncRunner"]
