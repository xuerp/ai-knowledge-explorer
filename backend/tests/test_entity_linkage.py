from pathlib import Path

from app.entity_linkage import audit_claim_entity_links
from app.repository import KnowledgeRepository
from app.schemas import Claim, Evidence

SEED_PATH = Path(__file__).resolve().parents[1] / "data" / "demo_snapshot.json"


def _claim(
    claim_id: str,
    *,
    entity_id: str | None = None,
    subject: str | None = None,
    text: str,
    source_id: str = "source-test",
) -> Claim:
    return Claim.model_validate(
        {
            "id": claim_id,
            "entityId": entity_id,
            "text": {"zh": text, "en": text},
            "confidence": "verified",
            "sourceIds": [source_id],
            "updatedAt": "2026-08-25",
            "subject": subject,
            "predicate": "description",
            "objectOrValue": text,
            "validFrom": "2026-08-25",
        }
    )


def test_claim_entity_audit_separates_deterministic_and_manual_cases():
    snapshot = KnowledgeRepository(SEED_PATH).load_seed()
    entities = [
        next(entity for entity in snapshot.entities if entity.id == "e-gpt"),
        next(entity for entity in snapshot.entities if entity.id == "e-claude"),
    ]
    snapshot = snapshot.model_copy(
        update={
            "entities": entities,
            "claims": [
                _claim("linked", entity_id="e-gpt", subject="GPT", text="GPT 已关联。"),
                _claim("deterministic", subject="Claude", text="Claude 已发布。"),
                _claim("review", subject="未知系列", text="GPT 发布了新版本。"),
                _claim("ambiguous", subject="两个系列", text="GPT 与 Claude 可以对比。"),
                _claim("unresolved", subject="未知产品", text="该产品没有目录记录。"),
                _claim(
                    "invalid",
                    entity_id="e-does-not-exist",
                    subject="GPT",
                    text="GPT 被错误关联。",
                ),
            ],
        }
    )

    report = audit_claim_entity_links(snapshot)
    by_id = {item.claim_id: item for item in report.items}

    assert report.public_claim_count == 6
    assert report.linked_claim_count == 1
    assert report.missing_or_invalid_count == 5
    assert report.deterministic_repair_count == 1
    assert report.manual_review_count == 4
    assert by_id["deterministic"].resolution == "deterministic"
    assert by_id["deterministic"].proposed_entity_id == "e-claude"
    assert by_id["review"].resolution == "review-required"
    assert by_id["review"].proposed_entity_id == "e-gpt"
    assert by_id["ambiguous"].resolution == "ambiguous"
    assert by_id["ambiguous"].candidate_entity_ids == ["e-claude", "e-gpt"]
    assert by_id["unresolved"].resolution == "unresolved"
    assert by_id["invalid"].resolution == "invalid"


def test_claim_entity_audit_recommends_only_curated_official_matches():
    snapshot = KnowledgeRepository(SEED_PATH).load_seed()
    cases = [
        (
            "mcp",
            "Sampling",
            "Model Context Protocol",
            "https://modelcontextprotocol.io/docs/2026-07-28/learn/architecture",
            "assign",
            "e-mcp",
        ),
        (
            "claude",
            "Claude 3.7 Sonnet",
            "Anthropic",
            "https://www.anthropic.com/news/claude-3-7-sonnet",
            "assign",
            "e-claude",
        ),
        (
            "gemini",
            "File Search API",
            "Google",
            "https://ai.google.dev/gemini-api/docs/changelog",
            "assign",
            "e-gemini",
        ),
        (
            "qwen",
            "All our open-weight models",
            "Alibaba Qwen",
            "https://raw.githubusercontent.com/QwenLM/Qwen3/main/README.md",
            "assign",
            "e-qwen",
        ),
        (
            "openai",
            "Videos API",
            "OpenAI",
            "https://developers.openai.com/api/docs/deprecations.md",
            "assign",
            "e-openai",
        ),
        (
            "seed",
            "Seed2.0",
            "ByteDance Seed",
            "https://seed.bytedance.com/en/blog/seed-2-0-official-launch",
            "assign",
            "e-doubao",
        ),
        (
            "paper",
            "Transformer",
            "arXiv",
            "https://arxiv.org/abs/1706.03762",
            "assign",
            "e-transformer-paper",
        ),
        (
            "noise",
            "arXiv",
            "arXiv",
            "https://arxiv.org",
            "retract",
            None,
        ),
    ]
    claims = []
    evidence = []
    for claim_id, subject, publisher, url, _, _ in cases:
        source_id = f"source-{claim_id}"
        claims.append(
            _claim(
                claim_id,
                subject=subject,
                text=f"{subject} 的官方事实。",
                source_id=source_id,
            )
        )
        evidence.append(
            Evidence.model_validate(
                {
                    "id": source_id,
                    "title": {"zh": subject, "en": subject},
                    "url": url,
                    "publisher": publisher,
                    "publishedAt": "2026-08-25",
                    "collectedAt": "2026-08-25",
                    "type": "official" if publisher != "arXiv" else "paper",
                }
            )
        )
    claims.append(
        _claim(
            "untrusted",
            subject="Videos API",
            text="第三方转述。",
            source_id="source-untrusted",
        )
    )
    evidence.append(
        Evidence.model_validate(
            {
                "id": "source-untrusted",
                "title": {"zh": "第三方", "en": "Third party"},
                "url": "https://example.com/deprecations",
                "publisher": "OpenAI",
                "publishedAt": "2026-08-25",
                "collectedAt": "2026-08-25",
                "type": "news",
            }
        )
    )
    report = audit_claim_entity_links(
        snapshot.model_copy(update={"claims": claims, "evidence": evidence})
    )
    by_id = {item.claim_id: item for item in report.items}

    for claim_id, _, _, _, action, entity_id in cases:
        assert by_id[claim_id].recommended_action == action
        assert by_id[claim_id].recommended_entity_id == entity_id
        assert by_id[claim_id].recommendation_reason
    assert by_id["untrusted"].recommended_action is None


def test_claim_entity_audit_retracts_lower_information_duplicates_from_same_source():
    snapshot = KnowledgeRepository(SEED_PATH).load_seed()
    source = Evidence.model_validate(
        {
            "id": "source-claude",
            "title": {"zh": "Claude 3.7", "en": "Claude 3.7"},
            "url": "https://www.anthropic.com/news/claude-3-7-sonnet",
            "publisher": "Anthropic",
            "publishedAt": "2026-08-25",
            "collectedAt": "2026-08-25",
            "type": "official",
        }
    )
    mcp_source = Evidence.model_validate(
        {
            "id": "source-mcp",
            "title": {"zh": "MCP 架构", "en": "MCP architecture"},
            "url": "https://modelcontextprotocol.io/docs/2026-07-28/learn/architecture",
            "publisher": "Model Context Protocol",
            "publishedAt": "2026-08-25",
            "collectedAt": "2026-08-25",
            "type": "official",
        }
    )
    generic = _claim(
        "generic-limit",
        subject="Claude 3.7 Sonnet",
        text="思考预算上限为 128K。",
        source_id=source.id,
    ).model_copy(update={"predicate": "limit", "object_or_value": "128K tokens"})
    specific = _claim(
        "specific-limit",
        subject="Claude 3.7 Sonnet",
        text="思考令牌上限为 128K。",
        source_id=source.id,
    ).model_copy(update={"predicate": "thinking-token-limit", "object_or_value": "128K tokens"})
    sampling_generic = _claim(
        "sampling-generic",
        subject="Sampling",
        text="Sampling 自 2026-07-28 起弃用。",
        source_id=mcp_source.id,
    ).model_copy(update={"predicate": "deprecated-as-of", "object_or_value": "2026-07-28"})
    sampling_specific = _claim(
        "sampling-specific",
        subject="Sampling",
        text="Sampling 自协议版本 2026-07-28 起弃用。",
        source_id=mcp_source.id,
    ).model_copy(
        update={
            "predicate": "deprecated-as-of",
            "object_or_value": "protocol version 2026-07-28",
        }
    )
    report = audit_claim_entity_links(
        snapshot.model_copy(
            update={
                "claims": [generic, specific, sampling_generic, sampling_specific],
                "evidence": [source, mcp_source],
            }
        )
    )
    by_id = {item.claim_id: item for item in report.items}

    assert by_id["generic-limit"].recommended_action == "retract"
    assert "更具体" in (by_id["generic-limit"].recommendation_reason or "")
    assert by_id["specific-limit"].recommended_action == "assign"
    assert by_id["specific-limit"].recommended_entity_id == "e-claude"
    assert by_id["sampling-generic"].recommended_action == "retract"
    assert "低信息重复" in (by_id["sampling-generic"].recommendation_reason or "")
    assert by_id["sampling-specific"].recommended_action == "assign"
    assert by_id["sampling-specific"].recommended_entity_id == "e-mcp"
