from __future__ import annotations

from dataclasses import dataclass
import json
import math
from typing import Any, Callable, Iterable, Mapping
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen
import uuid


@dataclass(frozen=True, slots=True)
class IndexAuditConfig:
    base_url: str
    book_alias: str
    tag_alias: str
    index_version: str
    tag_version: str
    dimension: int
    sample_size: int = 3
    vector_name: str | None = None
    api_key: str | None = None
    timeout_seconds: float = 5.0

    def __post_init__(self) -> None:
        required = (self.base_url, self.book_alias, self.tag_alias, self.index_version, self.tag_version)
        if any(not value.strip() or value.strip().lower() == "none" for value in required):
            raise ValueError("Qdrant URL, aliases, index version, and tag version must be configured")
        if self.dimension < 1 or not 1 <= self.sample_size <= 100:
            raise ValueError("dimension must be positive and sample_size must be between 1 and 100")
        if not math.isfinite(self.timeout_seconds) or self.timeout_seconds <= 0:
            raise ValueError("timeout_seconds must be positive and finite")


class _QdrantRequestError(RuntimeError):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


class QdrantIndexAuditor:
    """Read-only check that the runtime's active Qdrant aliases point at usable versions."""

    def __init__(
        self,
        config: IndexAuditConfig,
        *,
        opener: Callable[..., Any] = urlopen,
    ) -> None:
        self.config = config
        self._opener = opener

    def _request(self, method: str, path: str, body: dict[str, Any] | None = None) -> dict[str, Any]:
        headers = {"Content-Type": "application/json"}
        if self.config.api_key:
            headers["api-key"] = self.config.api_key
        data = json.dumps(body).encode("utf-8") if body is not None else None
        request = Request(f"{self.config.base_url.rstrip('/')}{path}", data=data, headers=headers, method=method)
        try:
            response = self._opener(request, timeout=self.config.timeout_seconds)
            result = json.loads(response.read().decode("utf-8"))
        except HTTPError as error:
            code = "QDRANT_UNAUTHORIZED" if error.code in (401, 403) else (
                "QDRANT_TIMEOUT" if error.code in (408, 429, 500, 502, 503, 504) else
                "QDRANT_RESOURCE_NOT_FOUND" if error.code == 404 else "QDRANT_HTTP_ERROR"
            )
            raise _QdrantRequestError(code) from error
        except (TimeoutError, json.JSONDecodeError, UnicodeDecodeError) as error:
            code = "QDRANT_TIMEOUT" if isinstance(error, TimeoutError) else "QDRANT_INVALID_RESPONSE"
            raise _QdrantRequestError(code) from error
        except URLError as error:
            code = "QDRANT_TIMEOUT" if isinstance(error.reason, TimeoutError) else "QDRANT_UNAVAILABLE"
            raise _QdrantRequestError(code) from error
        except OSError as error:
            code = "QDRANT_TIMEOUT" if isinstance(error, TimeoutError) else "QDRANT_UNAVAILABLE"
            raise _QdrantRequestError(code) from error
        if not isinstance(result, dict):
            raise _QdrantRequestError("QDRANT_INVALID_RESPONSE")
        return result

    def _check(self, checks: list[dict[str, Any]], name: str, expected: Any, actual: Any, *, code: str = "OK") -> None:
        checks.append({
            "name": name,
            "status": "PASS" if code == "OK" else "FAIL",
            "code": code,
            "expected": expected,
            "actual": actual,
        })

    def _vector_config(self, vectors: Any) -> tuple[str | None, Any]:
        if not isinstance(vectors, Mapping):
            return None, None
        if "size" in vectors:
            return None, vectors.get("size")
        if self.config.vector_name:
            selected = vectors.get(self.config.vector_name)
            return self.config.vector_name, selected.get("size") if isinstance(selected, Mapping) else None
        if not vectors:
            return None, None
        selected_name, selected = next(iter(vectors.items()))
        return str(selected_name), selected.get("size") if isinstance(selected, Mapping) else None

    def _vector(self, point: Mapping[str, Any]) -> list[Any] | None:
        vector = point.get("vector")
        if isinstance(vector, Mapping):
            if self.config.vector_name:
                vector = vector.get(self.config.vector_name)
            elif len(vector) == 1:
                vector = next(iter(vector.values()))
            else:
                return None
        return vector if isinstance(vector, list) else None

    def _validate_vector(self, checks: list[dict[str, Any]], name: str, point: Mapping[str, Any]) -> None:
        vector = self._vector(point)
        if vector is None:
            self._check(checks, name, self.config.dimension, "missing-or-ambiguous-vector", code="VECTOR_MISSING")
            return
        finite = all(isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) for value in vector)
        if len(vector) != self.config.dimension:
            self._check(checks, name, self.config.dimension, len(vector), code="DIMENSION_MISMATCH")
        elif not finite:
            self._check(checks, name, "finite numeric values", "non-finite-or-non-numeric-value", code="VECTOR_INVALID")
        else:
            self._check(checks, name, self.config.dimension, len(vector))

    def _validate_payload_version(
        self,
        checks: list[dict[str, Any]],
        name: str,
        payload: Any,
        *,
        expected_key: str,
        expected_value: str,
        code: str,
    ) -> None:
        actual = payload.get(expected_key) if isinstance(payload, Mapping) else None
        self._check(checks, name, expected_value, actual, code="OK" if actual == expected_value else code)

    def _validate_tag_version(
        self,
        checks: list[dict[str, Any]],
        name: str,
        payload: Any,
        *,
        expected_version: str,
    ) -> None:
        # Incremental taxonomy updates intentionally leave unchanged book payloads
        # and existing tag prototypes on their original tagVersion. The online
        # reader addresses them by indexVersion + tagCode, not tagVersion.
        actual = payload.get("tagVersion") if isinstance(payload, Mapping) else None
        valid = isinstance(actual, str) and bool(actual.strip())
        related = valid and (
            actual == expected_version
            or actual.startswith(f"{expected_version}-")
            or expected_version.startswith(f"{actual}-")
        )
        self._check(
            checks,
            name,
            f"{expected_version} or a related incremental version",
            actual,
            code="TAG_VERSION_MISSING" if not valid else "OK" if related else "TAG_VERSION_MISMATCH",
        )

    def audit(self, *, tag_codes: Iterable[str]) -> dict[str, Any]:
        checks: list[dict[str, Any]] = []
        config = self.config
        codes = tuple(dict.fromkeys(code.strip() for code in tag_codes if isinstance(code, str) and code.strip()))
        if not codes:
            raise ValueError("at least one tag code must be audited")

        try:
            # Qdrant exposes the global alias list at GET /aliases. The
            # /collections/{collection_name}/aliases route is collection-scoped.
            response = self._request("GET", "/aliases")
            aliases = response.get("result", {}).get("aliases")
            if not isinstance(aliases, list):
                raise _QdrantRequestError("QDRANT_INVALID_RESPONSE")
            alias_map = {
                item.get("alias_name"): item.get("collection_name")
                for item in aliases
                if isinstance(item, Mapping)
            }
        except _QdrantRequestError as error:
            self._check(checks, "qdrantAliasList", "readable alias list", None, code=error.code)
            return self._report(checks, codes)

        self._check(checks, "bookAlias", "one active collection", alias_map.get(config.book_alias),
                    code="OK" if alias_map.get(config.book_alias) else "BOOK_ALIAS_MISSING")
        self._check(checks, "tagAlias", "one active collection", alias_map.get(config.tag_alias),
                    code="OK" if alias_map.get(config.tag_alias) else "TAG_ALIAS_MISSING")
        book_collection = alias_map.get(config.book_alias)
        tag_collection = alias_map.get(config.tag_alias)

        collection_configs: dict[str, dict[str, Any]] = {}
        for name, collection in (("bookCollection", book_collection), ("tagCollection", tag_collection)):
            if not collection:
                continue
            try:
                info = self._request("GET", f"/collections/{quote(collection, safe='')}").get("result")
                if not isinstance(info, Mapping):
                    raise _QdrantRequestError("QDRANT_INVALID_RESPONSE")
                collection_configs[name] = dict(info)
                collection_config = info.get("config")
                params = collection_config.get("params") if isinstance(collection_config, Mapping) else None
                vectors = params.get("vectors") if isinstance(params, Mapping) else None
                vector_name, actual_dimension = self._vector_config(vectors)
                self._check(
                    checks,
                    f"{name}Dimension",
                    config.dimension,
                    actual_dimension,
                    code="OK" if actual_dimension == config.dimension else "DIMENSION_MISMATCH",
                )
                self._check(checks, f"{name}VectorName", config.vector_name or "default/first", vector_name or "default")
            except _QdrantRequestError as error:
                self._check(checks, name, "readable collection metadata", None, code=error.code)

        if book_collection:
            try:
                scroll = self._request(
                    "POST",
                    f"/collections/{quote(book_collection, safe='')}/points/scroll",
                    {
                        "filter": {"must": [
                            {"key": "indexVersion", "match": {"value": config.index_version}},
                            {"key": "active", "match": {"value": True}},
                        ]},
                        "limit": config.sample_size,
                        "with_payload": True,
                        "with_vector": True,
                    },
                )
                points = scroll.get("result", {}).get("points")
                if not isinstance(points, list):
                    raise _QdrantRequestError("QDRANT_INVALID_RESPONSE")
                self._check(checks, "bookPointSample", f">=1 (max {config.sample_size})", len(points),
                            code="OK" if points else "BOOK_POINTS_MISSING")
                for position, point in enumerate(points, start=1):
                    if not isinstance(point, Mapping):
                        self._check(checks, f"bookPoint{position}", "point object", None, code="QDRANT_INVALID_RESPONSE")
                        continue
                    payload = point.get("payload")
                    self._validate_payload_version(
                        checks, f"bookPoint{position}IndexVersion", payload,
                        expected_key="indexVersion", expected_value=config.index_version,
                        code="INDEX_VERSION_MISMATCH",
                    )
                    self._validate_tag_version(
                        checks, f"bookPoint{position}TagVersion", payload, expected_version=config.tag_version
                    )
                    self._validate_vector(checks, f"bookPoint{position}Vector", point)
            except _QdrantRequestError as error:
                self._check(checks, "bookPointSample", "readable active-version points", None, code=error.code)

        if tag_collection:
            point_ids = [str(uuid.uuid5(uuid.NAMESPACE_URL, f"{config.index_version}:tag:{code}")) for code in codes]
            try:
                response = self._request(
                    "POST",
                    f"/collections/{quote(tag_collection, safe='')}/points",
                    {"ids": point_ids, "with_payload": True, "with_vector": True},
                )
                points = response.get("result")
                if not isinstance(points, list):
                    raise _QdrantRequestError("QDRANT_INVALID_RESPONSE")
                by_id = {point.get("id"): point for point in points if isinstance(point, Mapping)}
                for code, point_id in zip(codes, point_ids):
                    point = by_id.get(point_id)
                    if point is None:
                        self._check(checks, f"tagPoint:{code}", "present", None, code="TAG_POINT_MISSING")
                        continue
                    payload = point.get("payload")
                    actual_code = payload.get("tagCode") if isinstance(payload, Mapping) else None
                    self._check(checks, f"tagPoint:{code}Code", code, actual_code,
                                code="OK" if actual_code == code else "TAG_CODE_MISMATCH")
                    self._validate_payload_version(
                        checks, f"tagPoint:{code}IndexVersion", payload,
                        expected_key="indexVersion", expected_value=config.index_version,
                        code="INDEX_VERSION_MISMATCH",
                    )
                    self._validate_tag_version(
                        checks, f"tagPoint:{code}TagVersion", payload, expected_version=config.tag_version
                    )
                    self._validate_vector(checks, f"tagPoint:{code}Vector", point)
                self._check(checks, "tagPrototypeCoverage", len(codes), len(points),
                            code="OK" if len(points) == len(codes) else "TAG_POINT_MISSING")
            except _QdrantRequestError as error:
                self._check(checks, "tagPrototypePoints", f"{len(codes)} readable points", None, code=error.code)

        return self._report(checks, codes)

    def _report(self, checks: list[dict[str, Any]], tag_codes: tuple[str, ...]) -> dict[str, Any]:
        failed = sum(check["status"] == "FAIL" for check in checks)
        return {
            "auditVersion": "qdrant-active-index-audit-v1",
            "status": "FAIL" if failed else "PASS",
            "indexVersion": self.config.index_version,
            "tagVersion": self.config.tag_version,
            "embeddingDimension": self.config.dimension,
            "bookAlias": self.config.book_alias,
            "tagAlias": self.config.tag_alias,
            "auditedTagCodes": list(tag_codes),
            "checks": checks,
            "failureCount": failed,
        }


__all__ = ["IndexAuditConfig", "QdrantIndexAuditor"]
