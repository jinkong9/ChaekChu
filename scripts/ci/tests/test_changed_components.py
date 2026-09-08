"""changed_components 분류 규칙 테스트. Jenkins 가 변경 범위 계산 전에 호스트 python3 로 실행한다."""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from changed_components import COMPONENTS, build_plan, classify_path, classify_paths  # noqa: E402


def selected(plan: dict) -> set[str]:
    return {name for name in COMPONENTS if plan[name]}


class ClassifyPathTests(unittest.TestCase):
    def test_component_source(self):
        self.assertEqual(classify_path("frontend/src/App.tsx"), {"frontend"})
        self.assertEqual(classify_path("backend/src/main/java/com/ssafy/b102/A.java"), {"backend"})
        self.assertEqual(classify_path("database/카카오/scripts/kakao_book_common.py"), {"data"})
        self.assertEqual(classify_path("database/정보나루/tests/test_gap_pipeline.py"), {"data"})
        self.assertEqual(classify_path("database/_pipeline/scripts/embedding_study.py"), {"data"})

    def test_docs_select_nothing(self):
        for path in (
            "README.md", "docs/ERD.md", "frontend/README.md", "backend/README.md", "deploy/README.md",
            "database/카카오/KAKAO_BOOK_SEARCH_API.md", "database/_pipeline/reports/x.json",
            "database/yes24/samples/a.jsonl", "docs/pipeline/report.pdf", "jira/jira_guide.md",
            ".gitlab/merge_request_templates/Default.md", "ai/src/recommendation/cli.py", ".gitignore",
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


if __name__ == "__main__":
    unittest.main()
