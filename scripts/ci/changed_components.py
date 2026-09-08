#!/usr/bin/env python3
"""변경 경로로 CI 컴포넌트를 고른다. 출력은 JSON 한 덩어리.

컴포넌트: frontend · backend · data · deploy
  - 문서만 바뀌면 아무것도 고르지 않는다
  - 분류할 수 없는 경로가 있거나 비교 기준(base)을 못 찾으면 전부 고른다 (안전 쪽으로 닫는다)
  - ai/ 는 CI 대상이 아니다

사용:
  changed_components.py --jenkins            Jenkins env(GIT_COMMIT, CHANGE_TARGET, GIT_PREVIOUS_SUCCESSFUL_COMMIT, BRANCH_NAME) 로 범위 결정
  changed_components.py --base A --head B    명시 범위
  changed_components.py --all                전부
  changed_components.py path/a path/b        경로 목록만 분류 (테스트용)
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from collections.abc import Mapping, Sequence

COMPONENTS = ("frontend", "backend", "data", "deploy")
ZERO_SHA = "0" * 40

# 순서가 의미 있다. 위에서 먼저 매칭된 규칙이 이긴다.
# (prefix 또는 정확한 경로, 선택 컴포넌트 집합). 빈 집합 = 아무것도 선택 안 함(문서 등). None = 전부(전역 입력).
RULES: list[tuple[str, frozenset[str] | None]] = [
    # 전역 입력 → 전부
    ("scripts/ci/lib.sh", None),
    (".gitattributes", None),
    # CI 스크립트는 자기 컴포넌트를 다시 돈다
    ("scripts/ci/run-frontend-ci.sh", frozenset({"frontend", "deploy"})),
    ("scripts/ci/run-backend-ci.sh", frozenset({"backend", "deploy"})),
    ("scripts/ci/compose.backend-ci.yml", frozenset({"backend", "deploy"})),
    ("scripts/ci/run-data-ci.sh", frozenset({"data", "deploy"})),
    ("scripts/ci/", frozenset({"deploy"})),
    ("Jenkinsfile", frozenset({"deploy"})),
    # 배포 구성
    ("deploy/", frozenset({"deploy"})),
    (".dockerignore", frozenset({"deploy"})),
    ("backend/Dockerfile", frozenset({"backend", "deploy"})),
    ("backend/.dockerignore", frozenset({"deploy"})),
    ("backend/docker/", frozenset({"backend", "deploy"})),
    ("backend/docker-compose.yml", frozenset({"backend", "deploy"})),
    # 컴포넌트 (문서 제외는 아래 _is_doc 에서)
    ("frontend/", frozenset({"frontend"})),
    ("backend/", frozenset({"backend"})),
    ("database/_pipeline/scripts/", frozenset({"data"})),
    ("database/_pipeline/", frozenset()),  # reports, deploy(수집기 systemd) — 테스트 없음
    ("database/", frozenset({"data"})),
    # 문서·메타·CI 대상 아님
    ("docs/", frozenset()),
    ("jira/", frozenset()),
    (".gitlab/", frozenset()),
    (".claude/", frozenset()),
    (".agents/", frozenset()),
    ("ai/", frozenset()),
    (".gitignore", frozenset()),
    ("README.md", frozenset()),
    ("package-lock.json", frozenset()),  # 루트에 잘못 생긴 빈 파일
]
DOC_SUFFIXES = (".md", ".pdf", ".html", ".png", ".jpg", ".svg", ".txt", ".csv", ".json.example")
DATA_NO_TEST_DIRS = ("/reports/", "/samples/", "/metadata/", "/raw/", "/processed/")


def _is_doc(path: str) -> bool:
    if path.endswith(DOC_SUFFIXES):
        return True
    if path.startswith("database/") and any(part in path for part in DATA_NO_TEST_DIRS):
        return True
    return False


def classify_path(path: str) -> frozenset[str] | None:
    """경로 하나 → 선택 컴포넌트. None 은 '전부'(분류 불가 또는 전역)."""
    path = path.strip()
    if path.startswith("./"):
        path = path[2:]
    if not path:
        return frozenset()
    for prefix, selection in RULES:
        matched = path == prefix or (prefix.endswith("/") and path.startswith(prefix))
        if not matched:
            continue
        if selection is None:
            return None
        if selection and _is_doc(path):
            return frozenset()
        return selection
    if _is_doc(path):
        return frozenset()
    return None  # 모르는 경로 → 안전하게 전부


def classify_paths(paths: Sequence[str]) -> tuple[dict[str, bool], list[str]]:
    plan = {name: False for name in COMPONENTS}
    unknown: list[str] = []
    for path in paths:
        selection = classify_path(path)
        if selection is None:
            unknown.append(path)
            for name in COMPONENTS:
                plan[name] = True
            continue
        for name in selection:
            plan[name] = True
    return plan, unknown


def _git(arguments: Sequence[str], check: bool = True) -> str | None:
    result = subprocess.run(["git", *arguments], check=False, capture_output=True, text=True, encoding="utf-8")
    if result.returncode == 0:
        return result.stdout.strip()
    if check:
        raise ValueError(result.stderr.strip() or "git command failed")
    return None


def _resolve_commit(reference: str | None) -> str | None:
    if not reference or reference == ZERO_SHA:
        return None
    return _git(["rev-parse", "--verify", "--quiet", "--end-of-options", f"{reference}^{{commit}}"], check=False)


def resolve_change_range(environment: Mapping[str, str]) -> tuple[str | None, str, str]:
    """(base, head, reason). MR 은 target 과의 merge-base, dev 는 직전 성공 커밋 → 직전 커밋 → 머지 커밋의 첫 부모."""
    head = _resolve_commit(environment.get("GIT_COMMIT")) or _resolve_commit("HEAD")
    if head is None:
        raise ValueError("HEAD 커밋을 찾을 수 없습니다")

    change_target = environment.get("CHANGE_TARGET", "").strip()
    if change_target:
        for candidate in (f"refs/remotes/origin/{change_target}", f"refs/heads/{change_target}"):
            target = _resolve_commit(candidate)
            if target is None:
                continue
            merge_base = _git(["merge-base", target, head], check=False)
            if merge_base:
                return merge_base, head, f"merge-base with {change_target}"

    for variable in ("GIT_PREVIOUS_SUCCESSFUL_COMMIT", "GIT_PREVIOUS_COMMIT"):
        previous = _resolve_commit(environment.get(variable))
        if previous and previous != head:
            return previous, head, variable

    if environment.get("BRANCH_NAME", "").strip() == "dev":
        first_parent = _resolve_commit(f"{head}^1")
        if first_parent and first_parent != head:
            return first_parent, head, "first parent of dev head"

    return None, head, "no base found"


def changed_paths(base: str, head: str) -> list[str]:
    output = _git(["diff", "--name-only", "--no-renames", f"{base}...{head}", "--"])
    return [line for line in (output or "").splitlines() if line]


def build_plan(paths: Sequence[str], *, base: str | None, head: str | None, force_all: bool, reason: str) -> dict:
    if force_all or base is None:
        plan = {name: True for name in COMPONENTS}
        unknown: list[str] = []
        why = "force_all" if force_all else reason
    else:
        plan, unknown = classify_paths(paths)
        why = reason if not unknown else f"global or unknown paths -> all: {', '.join(unknown[:5])}"
    return {
        **plan,
        "base": base,
        "head": head,
        "force_all": force_all,
        "changed_count": len(paths),
        "reason": why,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--jenkins", action="store_true")
    parser.add_argument("--base")
    parser.add_argument("--head")
    parser.add_argument("--all", action="store_true")
    parser.add_argument("paths", nargs="*")
    args = parser.parse_args()

    if args.paths and not (args.jenkins or args.base):
        plan = build_plan(args.paths, base="(paths)", head=None, force_all=args.all, reason="explicit paths")
    else:
        if args.jenkins:
            base, head, reason = resolve_change_range(os.environ)
        else:
            head = _resolve_commit(args.head) or _resolve_commit("HEAD")
            base = _resolve_commit(args.base) if args.base else None
            reason = "explicit range" if base else "no --base"
        paths = changed_paths(base, head) if (base and head) else []
        plan = build_plan(paths, base=base, head=head, force_all=args.all, reason=reason)

    json.dump(plan, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
