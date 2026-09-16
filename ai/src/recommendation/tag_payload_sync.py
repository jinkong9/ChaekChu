from __future__ import annotations

from dataclasses import dataclass, field
import logging
import time
from typing import Any, Callable, Mapping, Protocol

from recommendation.tag_index import TagPayload, ValidatedTagSidecar


LOGGER = logging.getLogger(__name__)


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

    Operational lessons from the first run (2026-09-16, EC2, 3 GiB Qdrant with on-disk payload): 1,720 back-to-back
    batches of 256 set-payload operations made the optimizer rewrite every segment, memory hit the limit and online
    search latency went from 0.13 s to 39 s until the optimizer caught up; the run itself died on a 10 s timeout.
    Hence the defaults here: send only points whose tags differ from a baseline sidecar (85k of 440k rows for the
    KDC-6 change), pause between batches, and retry a batch with backoff instead of dying on a transient timeout.
    Unchanged points keep the old ``tagVersion`` string — the online path never filters on it.
    """

    store: PayloadStore
    index_version: str
    batch_size: int = 100
    pause_seconds: float = 0.5
    max_retries: int = 3
    baseline: Mapping[str, TagPayload] | None = None
    sleep: Callable[[float], None] = field(default=time.sleep, repr=False)

    def __post_init__(self) -> None:
        if not self.index_version.strip():
            raise ValueError("index_version must not be empty")
        if self.batch_size < 1:
            raise ValueError("batch_size must be positive")
        if self.pause_seconds < 0:
            raise ValueError("pause_seconds must not be negative")
        if self.max_retries < 0:
            raise ValueError("max_retries must not be negative")

    def _changed(self, isbn13: str, payload: TagPayload) -> bool:
        if self.baseline is None:
            return True
        before = self.baseline.get(isbn13)
        if before is None:
            return True
        return (
            tuple(before.tag_codes) != tuple(payload.tag_codes)
            or dict(before.tag_scores) != dict(payload.tag_scores)
            or dict(before.tag_confidence) != dict(payload.tag_confidence)
        )

    def run(self, sidecar: ValidatedTagSidecar) -> dict[str, Any]:
        items = [(isbn13, payload) for isbn13, payload in sidecar.records.items() if self._changed(isbn13, payload)]
        unchanged = len(sidecar.records) - len(items)
        updated = 0
        batches = 0
        retries = 0
        total_batches = (len(items) + self.batch_size - 1) // self.batch_size
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
            for attempt in range(self.max_retries + 1):
                try:
                    updated += self.store.update_payloads(self.index_version, updates)
                    break
                except Exception as error:  # store/HTTP failures are retried with backoff, then re-raised
                    if attempt >= self.max_retries:
                        raise
                    retries += 1
                    wait = self.pause_seconds * (2 ** attempt) + 1.0
                    LOGGER.warning(
                        "tag payload batch %d/%d failed (%s); retry %d/%d after %.1fs",
                        batches + 1, total_batches, error.__class__.__name__, attempt + 1, self.max_retries, wait,
                    )
                    self.sleep(wait)
            batches += 1
            if batches % 50 == 0 or batches == total_batches:
                LOGGER.info("tag payload sync %d/%d batches, %d points sent", batches, total_batches, updated)
            if self.pause_seconds > 0 and batches < total_batches:
                self.sleep(self.pause_seconds)
        return {
            "batchVersion": "d4l-tag-payload-sync-v2",
            "status": "SUCCESS" if sidecar.records else "EMPTY",
            "indexVersion": self.index_version,
            "tagVersion": sidecar.tag_version,
            "taxonomyVersion": sidecar.taxonomy_version,
            "inputHash": sidecar.input_hash,
            "sidecarHash": sidecar.file_hash,
            "rows": len(sidecar.records),
            "changedRows": len(items),
            "unchangedRows": unchanged,
            "updatedRows": updated,
            "skippedRows": len(items) - updated,
            "batches": batches,
            "batchSize": self.batch_size,
            "pauseSeconds": self.pause_seconds,
            "retries": retries,
            "baselineUsed": self.baseline is not None,
        }


__all__ = ["PayloadStore", "TagPayloadSyncRunner"]
