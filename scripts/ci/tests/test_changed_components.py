"""changed_components 분류 규칙 테스트. Jenkins 가 변경 범위 계산 전에 호스트 python3 로 실행한다."""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import json
import tempfile

from changed_components import (  # noqa: E402
    COMPONENTS,
    build_plan,
    classify_path,
    classify_paths,
    find_merge_request_validation,
    jenkins_branches_dir,
    merge_request_number,
    parse_build_record,
    plan_covers,
)


def selected(plan: dict) -> set[str]:
    return {name for name in COMPONENTS if plan[name]}


class ClassifyPathTests(unittest.TestCase):
    def test_component_source(self):
        self.assertEqual(classify_path("frontend/src/App.tsx"), {"frontend"})
        self.assertEqual(classify_path("backend/src/main/java/com/ssafy/b102/A.java"), {"backend"})
        self.assertEqual(classify_path("ai/src/recommendation/api.py"), {"ai", "deploy"})
        self.assertEqual(classify_path("ai/pyproject.toml"), {"ai", "deploy"})
        self.assertEqual(classify_path("database/카카오/scripts/kakao_book_common.py"), {"data"})
        self.assertEqual(classify_path("database/정보나루/tests/test_gap_pipeline.py"), {"data"})
        self.assertEqual(classify_path("database/_pipeline/scripts/embedding_study.py"), {"data"})

    def test_docs_select_nothing(self):
        for path in (
            "README.md", "docs/ERD.md", "frontend/README.md", "backend/README.md", "deploy/README.md",
            "database/카카오/KAKAO_BOOK_SEARCH_API.md", "database/_pipeline/reports/x.json",
            "database/yes24/samples/a.jsonl", "docs/pipeline/report.pdf", "jira/jira_guide.md",
            ".gitlab/merge_request_templates/Default.md", "ai/README.md", "ai/docs/operations.md", ".gitignore",
        ):
            self.assertEqual(classify_path(path), set(), path)

    def test_deploy_inputs(self):
        self.assertEqual(classify_path("deploy/docker-compose.yml"), {"deploy"})
        self.assertEqual(classify_path("deploy/web/nginx/snippets/app.conf"), {"deploy"})
        self.assertEqual(classify_path("deploy/jenkins/provision-jenkins.sh"), {"deploy"})
        self.assertEqual(classify_path("Jenkinsfile"), {"deploy"})
        self.assertEqual(classify_path("scripts/ci/changed_components.py"), {"deploy"})
        self.assertEqual(classify_path("backend/Dockerfile"), {"backend", "deploy"})
        self.assertEqual(classify_path("backend/docker/elasticsearch/Dockerfile"), {"backend", "deploy"})
        self.assertEqual(classify_path("backend/docker-compose.yml"), {"backend", "deploy"})

    def test_component_ci_scripts_rerun_their_component(self):
        self.assertEqual(classify_path("scripts/ci/run-frontend-ci.sh"), {"frontend", "deploy"})
        self.assertEqual(classify_path("scripts/ci/run-backend-ci.sh"), {"backend", "deploy"})
        self.assertEqual(classify_path("scripts/ci/run-data-ci.sh"), {"data", "deploy"})
        self.assertEqual(classify_path("scripts/ci/run-ai-ci.sh"), {"ai", "deploy"})

    def test_ai_source_change_selects_ai_ci_and_deployment(self):
        plan, unknown = classify_paths(["ai/src/recommendation/index_audit.py"])
        self.assertEqual(selected(plan), {"ai", "deploy"})
        self.assertEqual(unknown, [])

    def test_ai_docs_only_change_does_not_deploy(self):
        plan, unknown = classify_paths(["ai/README.md", "ai/docs/runbook.md"])
        self.assertEqual(selected(plan), set())
        self.assertEqual(unknown, [])

    def test_global_inputs_select_all(self):
        self.assertIsNone(classify_path("scripts/ci/lib.sh"))
        self.assertIsNone(classify_path(".gitattributes"))

    def test_unknown_path_selects_all(self):
        self.assertIsNone(classify_path("mystery/thing.py"))
        plan, unknown = classify_paths(["docs/a.md", "mystery/thing.py"])
        self.assertEqual(selected(plan), set(COMPONENTS))
        self.assertEqual(unknown, ["mystery/thing.py"])


class BuildPlanTests(unittest.TestCase):
    def test_mixed_changes(self):
        plan = build_plan(["frontend/src/a.tsx", "docs/x.md", "deploy/scripts/deploy.sh"], base="a", head="b", force_all=False, reason="r")
        self.assertEqual(selected(plan), {"frontend", "deploy"})
        self.assertEqual(plan["changed_count"], 3)

    def test_docs_only_selects_nothing(self):
        plan = build_plan(["docs/x.md", "README.md"], base="a", head="b", force_all=False, reason="r")
        self.assertEqual(selected(plan), set())

    def test_no_base_selects_all(self):
        plan = build_plan([], base=None, head="b", force_all=False, reason="no base found")
        self.assertEqual(selected(plan), set(COMPONENTS))
        self.assertEqual(plan["reason"], "no base found")

    def test_force_all(self):
        plan = build_plan(["docs/x.md"], base="a", head="b", force_all=True, reason="r")
        self.assertEqual(selected(plan), set(COMPONENTS))
        self.assertTrue(plan["force_all"])

    def test_plan_always_has_reuse_keys(self):
        plan = build_plan([], base="a", head="b", force_all=False, reason="r")
        self.assertFalse(plan["reuse_merge_request_validation"])
        self.assertIsNone(plan["verified_by"])


DEV_SHA = "b66e3e593a5ab3b7a27eaffb03d138056409fe91"
HEAD_SHA = "0071ade8d0ad02b35addcf2f6a29d6a26158ec7b"


def build_xml(result: str, hashes: tuple[str, ...]) -> str:
    """운영 Jenkins 의 MR 빌드 build.xml 에서 본 모양만 흉내 낸다 — result 와 SCMRevisionAction 의 hash 둘."""
    hash_lines = "\n".join(f"        <hash>{h}</hash>" for h in hashes)
    return f"""<?xml version='1.1' encoding='UTF-8'?>
<flow-build plugin="workflow-job@1400">
  <actions>
    <jenkins.scm.api.SCMRevisionAction plugin="scm-api@700">
      <revision class="io.jenkins.plugins.gitlabbranchsource.MergeRequestSCMRevision">
{hash_lines}
      </revision>
    </jenkins.scm.api.SCMRevisionAction>
    <hudson.plugins.git.util.BuildData><lastBuiltRevision><SHA1>{hashes[-1]}</SHA1></lastBuiltRevision></hudson.plugins.git.util.BuildData>
  </actions>
  <result>{result}</result>
  <description>Triggered by GitLab Merge Request #176</description>
</flow-build>
"""


class MergeRequestValidationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.branches = Path(self.tmp.name) / "branches"

    def tearDown(self):
        self.tmp.cleanup()

    def add_build(self, mr: str, number: int, result: str, hashes: tuple[str, ...], plan: dict | None):
        build_dir = self.branches / f"MR-{mr}" / "builds" / str(number)
        build_dir.mkdir(parents=True)
        (build_dir / "build.xml").write_text(build_xml(result, hashes), encoding="utf-8")
        if plan is not None:
            (build_dir / "archive").mkdir()
            (build_dir / "archive" / "ci-plan.json").write_text(json.dumps(plan), encoding="utf-8")

    def wanted(self, **flags) -> dict:
        return {name: flags.get(name, False) for name in COMPONENTS}

    def test_merge_request_number_from_gitlab_message(self):
        message = "Merge branch 'fix/x' into 'dev'\n\n[Fix] …\n\nSee merge request s15-bigdata-recom-sub1/S15P21B102!176\n"
        self.assertEqual(merge_request_number(message), "176")
        self.assertIsNone(merge_request_number("plain commit"))

    def test_parse_build_record(self):
        result, hashes = parse_build_record(build_xml("SUCCESS", (DEV_SHA, HEAD_SHA)))
        self.assertEqual(result, "SUCCESS")
        self.assertEqual(hashes, {DEV_SHA, HEAD_SHA})
        self.assertEqual(parse_build_record("<flow-build/>"), (None, frozenset()))

    def test_plan_covers(self):
        verified = self.wanted(frontend=True, backend=True)
        self.assertTrue(plan_covers(verified, self.wanted(backend=True)))
        self.assertTrue(plan_covers(verified, self.wanted()))
        self.assertFalse(plan_covers(verified, self.wanted(data=True)))

    def test_reuses_successful_build_with_same_parent_pair(self):
        self.add_build("176", 1, "SUCCESS", (DEV_SHA, HEAD_SHA), self.wanted(backend=True))
        verified_by, reason = find_merge_request_validation([DEV_SHA, HEAD_SHA], self.wanted(backend=True), self.branches, "176")
        self.assertEqual(verified_by, "MR-176 #1")
        self.assertIn("validated merge", reason)

    def test_finds_build_without_mr_number_hint(self):
        self.add_build("176", 1, "SUCCESS", (DEV_SHA, HEAD_SHA), self.wanted(backend=True))
        verified_by, _ = find_merge_request_validation([DEV_SHA, HEAD_SHA], self.wanted(backend=True), self.branches, None)
        self.assertEqual(verified_by, "MR-176 #1")

    def test_skips_aborted_rerun_and_uses_earlier_success(self):
        self.add_build("176", 1, "SUCCESS", (DEV_SHA, HEAD_SHA), self.wanted(backend=True))
        self.add_build("176", 2, "ABORTED", (DEV_SHA, HEAD_SHA), None)
        verified_by, _ = find_merge_request_validation([DEV_SHA, HEAD_SHA], self.wanted(backend=True), self.branches, "176")
        self.assertEqual(verified_by, "MR-176 #1")

    def test_no_reuse_when_only_failed_build_matches(self):
        self.add_build("176", 1, "FAILURE", (DEV_SHA, HEAD_SHA), self.wanted(backend=True))
        verified_by, reason = find_merge_request_validation([DEV_SHA, HEAD_SHA], self.wanted(backend=True), self.branches, "176")
        self.assertIsNone(verified_by)
        self.assertIn("result=FAILURE", reason)

    def test_no_reuse_when_dev_moved_after_mr_build(self):
        # MR 은 옛 dev(other) 와 머지한 상태로 검증됐고, 실제 머지 커밋의 첫 부모는 더 새 dev(DEV_SHA) → 트리가 달라 재사용 불가
        self.add_build("176", 1, "SUCCESS", ("f" * 40, HEAD_SHA), self.wanted(backend=True))
        verified_by, reason = find_merge_request_validation([DEV_SHA, HEAD_SHA], self.wanted(backend=True), self.branches, "176")
        self.assertIsNone(verified_by)
        self.assertIn("no MR build", reason)

    def test_no_reuse_when_mr_ran_fewer_components(self):
        self.add_build("176", 1, "SUCCESS", (DEV_SHA, HEAD_SHA), self.wanted(frontend=True))
        verified_by, reason = find_merge_request_validation([DEV_SHA, HEAD_SHA], self.wanted(backend=True), self.branches, "176")
        self.assertIsNone(verified_by)
        self.assertIn("every component", reason)

    def test_no_reuse_without_two_parents_or_dir(self):
        self.assertIsNone(find_merge_request_validation([HEAD_SHA], self.wanted(), self.branches, None)[0])
        self.assertIsNone(find_merge_request_validation([DEV_SHA, HEAD_SHA], self.wanted(), None, None)[0])
        self.assertIsNone(find_merge_request_validation([DEV_SHA, HEAD_SHA], self.wanted(), self.branches / "missing", None)[0])

    def test_jenkins_branches_dir_from_job_name(self):
        self.assertEqual(jenkins_branches_dir({"JENKINS_HOME": "/var/lib/jenkins", "JOB_NAME": "b102/dev"}),
                         Path("/var/lib/jenkins/jobs/b102/branches"))
        self.assertEqual(jenkins_branches_dir({"B102_JENKINS_BRANCHES_DIR": "/x"}), Path("/x"))
        self.assertIsNone(jenkins_branches_dir({}))


if __name__ == "__main__":
    unittest.main()
