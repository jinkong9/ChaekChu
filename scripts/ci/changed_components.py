#!/usr/bin/env python3
"""변경 경로로 CI 컴포넌트를 고른다. 출력은 JSON 한 덩어리.

컴포넌트: frontend · backend · ai · data · deploy
  - 문서만 바뀌면 아무것도 고르지 않는다
  - 분류할 수 없는 경로가 있거나 비교 기준(base)을 못 찾으면 전부 고른다 (안전 쪽으로 닫는다)
  - ai/ 소스는 AI CI와 배포 대상으로 선택한다 (문서 확장자는 제외)
  - dev 머지 커밋은 같은 (dev, MR head) 부모 쌍을 SUCCESS 로 검증한 MR-* 빌드가 있으면 컴포넌트 CI 를 건너뛰고 배포만 한다
    (reuse_merge_request_validation). Jenkins 는 MR 을 타깃과 머지한 상태로 빌드하므로 그 빌드가 검증한 트리는 머지 커밋의 트리와 같다.
    B102_REUSE_MR_VALIDATION=false 로 끄고, --all(FORCE_ALL) 이면 재사용하지 않는다.

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
import re
import subprocess
import sys
from collections.abc import Mapping, Sequence
from pathlib import Path

COMPONENTS = ("frontend", "backend", "ai", "data", "deploy")
ZERO_SHA = "0" * 40
# GitLab 머지 커밋 메시지 꼬리: "See merge request group/project!176" → Jenkins 브랜치 폴더 MR-176
MERGE_REQUEST_REF = re.compile(r"See merge request \S+!(\d+)")
BUILD_RESULT = re.compile(r"<result>([A-Z_]+)</result>")
# 다중 브랜치 빌드 기록(build.xml)의 SCMRevisionAction — MR 빌드는 target(dev) 해시와 origin(MR head) 해시 둘을 적는다
REVISION_BLOCK = re.compile(r"<jenkins\.scm\.api\.SCMRevisionAction[^>]*>(.*?)</jenkins\.scm\.api\.SCMRevisionAction>", re.S)
REVISION_HASH = re.compile(r"<hash>([0-9a-f]{40})</hash>")

# 순서가 의미 있다. 위에서 먼저 매칭된 규칙이 이긴다.
# (prefix 또는 정확한 경로, 선택 컴포넌트 집합). 빈 집합 = 아무것도 선택 안 함(문서 등). None = 전부(전역 입력).
RULES: list[tuple[str, frozenset[str] | None]] = [
    # 전역 입력 → 전부
    ("scripts/ci/lib.sh", None),
    (".gitattributes", None),
    # CI 스크립트는 자기 컴포넌트를 다시 돈다
    ("scripts/ci/run-frontend-ci.sh", frozenset({"frontend", "deploy"})),
    ("scripts/ci/run-backend-ci.sh", frozenset({"backend", "deploy"})),
    ("scripts/ci/run-ai-ci.sh", frozenset({"ai", "deploy"})),
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
    ("ai/", frozenset({"ai", "deploy"})),
    ("database/_pipeline/scripts/", frozenset({"data"})),
    ("database/_pipeline/", frozenset()),  # reports, deploy(수집기 systemd) — 테스트 없음
    ("database/", frozenset({"data"})),
    # 문서·메타·CI 대상 아님
    ("docs/", frozenset()),
    ("jira/", frozenset()),
    (".gitlab/", frozenset()),
    (".claude/", frozenset()),
    (".agents/", frozenset()),
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
        # 아래 셋은 dev 머지 커밋에서 apply_merge_request_validation 이 채운다. 키는 항상 있어야 Jenkinsfile 이 읽을 수 있다.
        "reuse_merge_request_validation": False,
        "verified_by": None,
        "reuse_reason": "",
    }


# ── dev 머지 커밋의 MR 검증 재사용 ──

def merge_parents(head: str) -> list[str]:
    """머지 커밋의 부모 둘. 부모가 둘이 아니면(빨리감기·squash·일반 커밋) 빈 목록."""
    output = _git(["rev-list", "--parents", "-n", "1", head], check=False) or ""
    parts = output.split()
    return parts[1:] if len(parts) == 3 else []


def merge_request_number(message: str) -> str | None:
    match = MERGE_REQUEST_REF.search(message or "")
    return match.group(1) if match else None


def parse_build_record(xml_text: str) -> tuple[str | None, frozenset[str]]:
    """build.xml → (result, SCMRevisionAction 의 커밋 해시 집합)."""
    result = BUILD_RESULT.search(xml_text)
    block = REVISION_BLOCK.search(xml_text)
    hashes = frozenset(REVISION_HASH.findall(block.group(1))) if block else frozenset()
    return (result.group(1) if result else None), hashes


def plan_covers(verified: Mapping[str, object], wanted: Mapping[str, object]) -> bool:
    """MR 빌드가 돌린 컴포넌트가 이번 dev 빌드에 필요한 컴포넌트를 전부 포함하는가."""
    return all(bool(verified.get(name)) or not wanted.get(name) for name in COMPONENTS)


def jenkins_branches_dir(environment: Mapping[str, str]) -> Path | None:
    """$JENKINS_HOME/jobs/<다중 브랜치 잡>/branches. JOB_NAME 은 'b102/dev' 꼴이라 첫 마디가 잡 이름이다."""
    override = environment.get("B102_JENKINS_BRANCHES_DIR", "").strip()
    if override:
        return Path(override)
    home = environment.get("JENKINS_HOME", "").strip()
    job = environment.get("JOB_NAME", "").strip().split("/")[0]
    if not home or not job:
        return None
    return Path(home) / "jobs" / job / "branches"


def find_merge_request_validation(parents: Sequence[str], wanted: Mapping[str, object], branches_dir: Path | None,
                                  mr_number: str | None) -> tuple[str | None, str]:
    """(first, second) = (dev 였던 커밋, MR head) 와 같은 해시 쌍을 SUCCESS 로 끝낸 MR-* 빌드를 찾는다 → (verified_by, reason).
    메시지에 적힌 MR 번호의 폴더를 먼저 보고, 없으면 모든 MR-* 를 훑는다(빌드 기록 수십 개, 파일 읽기만).
    같은 해시 쌍인데 실패·중단된 빌드는 건너뛰고 성공한 빌드를 찾는다 — 같은 head 를 다시 돌린 빌드가 milestone 으로 중단될 수 있다."""
    if len(parents) != 2:
        return None, "not a two-parent merge commit"
    if branches_dir is None or not branches_dir.is_dir():
        return None, f"no jenkins branches dir ({branches_dir})"
    wanted_hashes = frozenset(parents)
    folders: list[Path] = []
    if mr_number:
        folders.append(branches_dir / f"MR-{mr_number}")
    folders.extend(sorted(p for p in branches_dir.glob("MR-*") if p not in folders))
    near_miss = "no MR build with the same (target, head) pair"
    for folder in folders:
        builds = folder / "builds"
        if not builds.is_dir():
            continue
        for build_dir in sorted((d for d in builds.iterdir() if d.name.isdigit()), key=lambda d: int(d.name), reverse=True):
            record = build_dir / "build.xml"
            if not record.is_file():
                continue
            result, hashes = parse_build_record(record.read_text(encoding="utf-8", errors="ignore"))
            if hashes != wanted_hashes:
                continue
            label = f"{folder.name} #{build_dir.name}"
            if result != "SUCCESS":
                near_miss = f"{label} matched but result={result}"
                continue
            plan_file = build_dir / "archive" / "ci-plan.json"
            if not plan_file.is_file():
                near_miss = f"{label} succeeded but has no ci-plan.json"
                continue
            verified = json.loads(plan_file.read_text(encoding="utf-8"))
            if not plan_covers(verified, wanted):
                near_miss = f"{label} succeeded but did not run every component needed now"
                continue
            return label, f"{label} validated merge({parents[0][:8]}, {parents[1][:8]})"
    return None, near_miss


def apply_merge_request_validation(plan: dict, environment: Mapping[str, str], head: str) -> dict:
    """dev 의 --jenkins 빌드에서만. 재사용 가능하면 plan 에 표시한다. 컴포넌트 플래그는 그대로 둔다(설명·기록용) — 건너뛰기는 Jenkinsfile 이 한다."""
    if environment.get("BRANCH_NAME", "").strip() != "dev":
        return plan
    if plan.get("force_all"):
        plan["reuse_reason"] = "force_all"
        return plan
    if environment.get("B102_REUSE_MR_VALIDATION", "true").strip().lower() == "false":
        plan["reuse_reason"] = "disabled by B102_REUSE_MR_VALIDATION=false"
        return plan
    parents = merge_parents(head)
    message = _git(["log", "-1", "--format=%B", head], check=False) or ""
    verified_by, reason = find_merge_request_validation(parents, plan, jenkins_branches_dir(environment), merge_request_number(message))
    plan["reuse_merge_request_validation"] = verified_by is not None
    plan["verified_by"] = verified_by
    plan["reuse_reason"] = reason
    return plan


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
        if args.jenkins:
            plan = apply_merge_request_validation(plan, os.environ, head)

    json.dump(plan, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
