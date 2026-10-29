from datetime import UTC, datetime
from pathlib import Path

from fastapi.testclient import TestClient

from app.config import Settings
from app.decision_candidates import described_features, interpret_scenario
from app.main import create_app
from app.research_report import Report, Section, build_report, report_markdown, report_pdf
from app.schemas import Claim, DecisionContext, KnowledgeSnapshot, ResearchCitation, ResearchView


def test_report_groups_same_document_quotes_without_merging_different_source_dates():
    seed = Path(__file__).resolve().parents[1] / "data/demo_snapshot.json"
    snapshot = KnowledgeSnapshot.model_validate_json(seed.read_bytes())
    source = snapshot.evidence[0].model_copy(update={"verified_at": "2026-10-10T15:00:00Z"})
    same_document = source.model_copy(
        update={"id": "another-quote", "source_excerpt": "A different quote"}
    )
    different_date = source.model_copy(update={"id": "another-date", "published_at": "2026-07-15"})
    sources = [source, same_document, different_date]
    citations = [
        ResearchCitation(
            claim=snapshot.claims[0].model_copy(
                update={"id": f"quote-{index}", "source_ids": [item.id]}
            ),
            evidence=[item],
        )
        for index, item in enumerate(sources)
    ]
    record = ResearchView(
        id="synthetic-report",
        question="Compare workflow documents",
        summary="Synthetic summary",
        claim_ids=[item.claim.id for item in citations],
        citations=citations,
        steps=[],
        status="ready",
        created_at=datetime.now(UTC),
    )
    report = build_report(record, snapshot, "en")
    appendix = next(section for section in report.sections if section.title == "Sources")
    assert len(appendix.paragraphs) == 2
    assert all("Verified: 2026-10-10" in paragraph for paragraph in appendix.paragraphs)
    assert "[1]" in report.sections[-3].paragraphs[0]
    assert "[1]" in report.sections[-3].paragraphs[1]
    assert "[2]" in report.sections[-3].paragraphs[2]


def test_coding_features_quote_actual_evidence_and_do_not_infer_tests_from_agent_role():
    context = DecisionContext(
        priority="quality",
        deployment="undecided",
        workflow_version=2,
        task_type="coding-product",
        task="为现有代码仓库选择编码工具，需要编辑文件、运行测试",
    )
    scenario = interpret_scenario(context, "zh")
    assert {"file-editing", "test-execution"} <= set(scenario.required_features)
    claim = Claim(
        id="file-tests",
        entity_id="tool",
        predicate="capability",
        text={"zh": "工具可编辑文件并运行测试。", "en": "It can edit files and run tests."},
        confidence="verified",
        source_ids=["source"],
        updated_at="2026-10-10",
    )
    rows = described_features([claim], scenario, "zh")
    assert {"file-editing", "test-execution"} <= {row.dimension for row in rows}
    assert all(row.finding == claim.text.zh and row.claim_ids == [claim.id] for row in rows)
    vague = claim.model_copy(
        update={
            "text": claim.text.model_copy(
                update={"zh": "这是软件工程 Agent。", "en": "A software engineering agent."}
            )
        }
    )
    assert not {"file-editing", "test-execution"} & {
        row.dimension for row in described_features([vague], scenario, "zh")
    }
    negative = claim.model_copy(
        update={
            "text": claim.text.model_copy(
                update={
                    "zh": "不支持编辑文件；不支持运行测试。",
                    "en": "Does not edit files. Does not run tests.",
                }
            )
        }
    )
    assert not described_features([negative], scenario, "zh")
    writing = claim.model_copy(
        update={
            "text": claim.text.model_copy(
                update={"zh": "可编写、运行和测试代码。", "en": "Can write, run and test code."}
            )
        }
    )
    writing_dimensions = {row.dimension for row in described_features([writing], scenario, "zh")}
    assert "test-execution" in writing_dimensions
    assert "file-editing" not in writing_dimensions


def test_report_pdf_handles_chinese_long_tables_and_markup_as_plain_text():
    report = Report(
        "选型分析报告",
        "编辑文件、运行测试",
        "2026-10-10 16:00 北京时间",
        [
            Section(
                "功能比较",
                ["<script>plain text, never executable</script>"],
                [
                    ["候选", "依据"],
                    *[["长名称工具" * 12, "明确的中文描述。" * 65] for _ in range(15)],
                ],
            ),
        ],
    )
    pdf = report_pdf(report)
    assert pdf.startswith(b"%PDF-") and len(pdf) > 3000
    # Cloud hosts must embed the actual font, not depend on a viewer-specific
    # substitute for STSong-Light (which distorted mixed Chinese/Latin text).
    assert b"/FontFile2" in pdf
    assert b"STSong-Light" not in pdf
    markdown = report_markdown(report)
    assert "编辑文件、运行测试" in markdown and "## 功能比较" in markdown
    assert "| 候选 | 依据 |" in markdown
    assert "<br>" not in markdown


def test_download_reports_are_owner_scoped_read_only_and_exclude_page_controls(tmp_path):
    seed = Path(__file__).resolve().parents[1] / "data/demo_snapshot.json"
    settings = Settings(
        database_url=f"sqlite:///{(tmp_path / 'reports.db').as_posix()}",
        seed_snapshot_path=seed,
        environment="test",
        cors_origins=("http://localhost:3000",),
        admin_token="report-test-admin",
        jwt_secret="report-test-secret-is-at-least-32-characters",
        rag_generation_enabled=False,
        embedding_provider="none",
    )
    with TestClient(create_app(settings)) as client:

        def signup(email):
            result = client.post(
                "/api/v2/auth/register", json={"email": email, "password": "test-only-password-123"}
            )
            assert result.status_code == 201
            return {"Authorization": "Bearer " + result.json()["accessToken"]}

        owner = signup("report-owner@example.com")
        other = signup("report-other@example.com")
        result = client.post(
            "/api/v2/research",
            headers=owner,
            json={
                "question": "为现有代码仓库选择编码工具，需要编辑文件、运行测试",
                "language": "zh",
                "decisionContext": {
                    "workflowVersion": 2,
                    "taskType": "coding-product",
                    "task": "为现有代码仓库选择编码工具，需要编辑文件、运行测试",
                    "priority": "quality",
                    "deployment": "undecided",
                },
            },
        )
        assert result.status_code == 200, result.text
        research_id = result.json()["id"]
        before = client.get(f"/api/v2/research/{research_id}", headers=owner).json()
        path = f"/api/v2/research/{research_id}/report"
        for file_format in ["pdf", "md"]:
            response = client.get(path, headers=owner, params={"format": file_format})
            assert response.status_code == 200, response.text[:100]
            assert "attachment" in response.headers["content-disposition"]
            assert response.headers["cache-control"] == "no-store"
            assert client.get(path, headers=other).status_code == 404
            assert client.get(path).status_code == 401
            if file_format == "pdf":
                assert response.content.startswith(b"%PDF-")
            else:
                assert "# 选型分析报告" in response.text and "## 来源" in response.text
                assert "创建公开分享" not in response.text and "研究过程" not in response.text
                assert "未知原因与补充方向" not in response.text
                assert "<br>" not in response.text
                assert "未找到明确引用，不代表不支持。" not in response.text
                assert "## 功能与规格比较" in response.text
        assert client.get(f"/api/v2/research/{research_id}", headers=owner).json() == before
        assert client.get(path, headers=owner, params={"format": "html"}).status_code == 422
        assert client.get(f"/api/v2/share/{research_id}/report").status_code == 404
