"""Whole-catalog scenario discovery followed by cited business-fit assessment.

Catalog descriptions are discovery hints only. A cited vendor feature is a
description, never independently measured task quality or a performance score.
No global search fallback or evidence count determines candidate relevance.
"""

import re

from .decision_constraints import constraint_failures
from .decision_intent import (
    CATALOG,
    native_retrieval_requested,
    requested_feature_ids,
    scenario_definition,
    text_only_input,
)
from .rag import LexicalRagRetriever
from .schemas import (
    Claim,
    DecisionContext,
    DecisionScenario,
    DecisionScope,
    DecisionTradeoff,
    Entity,
    KnowledgeSnapshot,
)

TYPES = {
    "model-api": {"model", "api"},
    "coding-product": {"application", "tool", "agent"},
    "knowledge-product": {"application", "tool", "framework"},
    "agent-development": {"framework"},
}


def contains(text: str, term: str) -> bool:
    if re.search(r"[\u3400-\u9fff]", term):
        return term.casefold() in text.casefold()
    return bool(re.search(r"(?<![\w])" + re.escape(term) + r"(?![\w])", text, re.IGNORECASE))


def interpret_scenario(context: DecisionContext, language: str) -> DecisionScenario:
    row = scenario_definition(context)
    if row is None:
        return DecisionScenario(
            name="待明确业务用途" if language == "zh" else "Business use needs clarification",
            clarification_checks=[
                "补充要处理的输入、期望输出及合格标准，或指定候选。"
                if language == "zh"
                else "Specify inputs, expected outputs and acceptance criteria, or select candidates."
            ],
        )
    required = list(
        dict.fromkeys(
            [
                *row["features"],
                *(
                    key
                    for key in row.get("optionalFeatures", [])
                    if key in requested_feature_ids(context.task + " " + (context.notes or ""))
                ),
            ]
        )
    )
    if row["id"] == "document-extraction" and text_only_input(context.task):
        required = [key for key in required if key != "document-input"]
    if row["id"] == "knowledge-assistant" and native_retrieval_requested(
        context.task + " " + (context.notes or "")
    ):
        required.append("retrieval")
    superseded = {
        parent for key in required for parent in CATALOG["features"][key].get("supersedes", [])
    }
    return DecisionScenario(
        id=row["id"],
        name=row["name"][language],
        required_features=[key for key in required if key not in superseded],
        clarification_checks=row["checks"][language],
    )


def feature_ids(text: str) -> set[str]:
    # Ignore negated assertions. Split at sentence and clause boundaries so a
    # vendor feature plus a 'not a benchmark' qualification stays descriptive.
    clauses = re.split(r"[。；;.!]", text)
    return {
        key
        for key, feature in CATALOG["features"].items()
        if any(
            any(contains(clause, term) for term in feature["patterns"])
            and not re.search(
                r"不支持|不提供|未提供|尚未|不需要|无需|不要|does not|unsupported|not available|not required|no need",
                clause,
                re.IGNORECASE,
            )
            for clause in clauses
        )
    }


def described_features(
    claims: list[Claim], scenario: DecisionScenario, language: str
) -> list[DecisionTradeoff]:
    def satisfies(recorded: str | None, required: str) -> bool:
        # The shared taxonomy already declares these stronger requirements.
        # Preserve direction: a generic tool claim cannot prove test execution.
        pending = [recorded] if recorded else []
        visited = set()
        while pending:
            feature = pending.pop()
            if feature in visited:
                continue
            if feature == required:
                return True
            visited.add(feature)
            pending.extend(CATALOG["features"].get(feature, {}).get("supersedes", []))
        return False

    findings = []
    for key in scenario.required_features:
        matching = [
            claim
            for claim in claims
            if claim.predicate
            in {"release", "catalog-review", "capability", "product-type", "workflow-feature"}
            and (
                (
                    claim.predicate != "workflow-feature"
                    and key in feature_ids(claim.text.zh + " " + claim.text.en)
                )
                or (
                    claim.predicate == "workflow-feature"
                    and satisfies(claim.object_or_value, key)
                    and not re.search(
                        r"不支持|不能(?:编辑|运行|生成|恢复)|未提供|does not support|cannot (?:modify|edit|run|execute|resume|generate)|unsupported|not available",
                        claim.text.zh + " " + claim.text.en,
                        re.IGNORECASE,
                    )
                )
            )
        ]
        # Lead with the explicit reviewed capability, not a generic release
        # sentence that happens to contain a workflow keyword. Retain all cites.
        matching.sort(
            key=lambda claim: (
                claim.predicate != "workflow-feature",
                claim.object_or_value != key,
            )
        )
        if matching:
            findings.append(
                DecisionTradeoff(
                    dimension=key,
                    finding=" ".join(
                        dict.fromkeys(
                            claim.text.zh if language == "zh" else claim.text.en
                            for claim in matching
                        )
                    ),
                    claim_ids=[claim.id for claim in matching],
                )
            )
    return findings


def discover_candidates(
    context: DecisionContext,
    snapshot: KnowledgeSnapshot,
    current_by_entity: dict[str, list[Claim]],
    language: str,
) -> tuple[list[str], DecisionScope]:
    if context.candidate_entity_ids:
        ids = list(context.candidate_entity_ids)
        return ids, DecisionScope(
            considered_entity_ids=ids,
            selection_basis="用户指定范围" if language == "zh" else "User-selected scope",
            explicit=True,
        )
    scenario = interpret_scenario(context, language)
    mentions = LexicalRagRetriever.resolve_mentions(snapshot.entities, context.task)
    companies = [
        entity for entity in snapshot.entities if entity.id in mentions and entity.type == "company"
    ]
    # A provider name defines a catalog search scope, never a feature or an
    # eligibility fact. A concrete product mention stays narrower than its vendor.
    product_mentions = mentions - {entity.id for entity in companies}
    mentioned_parents = {
        entity.family_id for entity in snapshot.entities if entity.id in product_mentions
    }
    product_mentions -= mentioned_parents
    named = LexicalRagRetriever.expand_entity_scope(snapshot.entities, product_mentions)
    vendor_terms = {
        term.casefold().strip()
        for company in companies
        for term in [company.name.en, company.name.zh, *(company.aliases or [])]
        if len(term.strip()) >= 2
    }
    constraint_audit = (
        scenario.id == "unspecified"
        and context.task_type == "model-api"
        and (
            context.minimum_context_tokens is not None
            or context.deployment != "undecided"
            or context.commercial_use_required
        )
    )
    types = TYPES.get(context.task_type)
    if types is None and scenario.id != "unspecified":
        scenario_type = next(
            row["taskType"] for row in CATALOG["scenarios"] if row["id"] == scenario.id
        )
        types = TYPES[scenario_type]
    pool: list[Entity] = []
    recorded_ids = {claim.entity_id for claim in snapshot.claims}
    for entity in snapshot.entities:
        if entity.type == "model" and not entity.family_id:
            continue
        if entity.id not in recorded_ids or (types and entity.type not in types):
            continue
        if entity.status in {"deprecated", "rumor"} or (
            entity.release
            and (
                entity.release.catalog_current is False
                or entity.release.stage in {"pending", "retired", "deprecated"}
            )
        ):
            continue
        hint = entity.summary.zh + " " + entity.summary.en + " " + " ".join(entity.tags)
        if named:
            relevant = entity.id in named or entity.family_id in named
        elif companies:
            relevant = any(contains(entity.vendor or "", term) for term in vendor_terms)
        elif constraint_audit:
            # The use/output may still need clarification, but explicit hard
            # constraints must be audited now rather than disappearing entirely.
            relevant = True
        else:
            # Reviewed workflow facts can describe newer capabilities absent
            # from the catalog summary. Otherwise even reviewed source refreshes
            # disappear from discovery when a user specifies concrete operations.
            cited = {
                finding.dimension
                for finding in described_features(
                    current_by_entity.get(entity.id, []), scenario, language
                )
            }
            hints = feature_ids(hint) | cited
            relevant = scenario.id != "unspecified" and bool(
                hints.intersection(scenario.required_features)
            )
            if scenario.id == "coding-model":
                relevant = "code-generation" in hints
            if "text-generation" in scenario.required_features and entity.type == "model":
                # General text use must not pick TTS, voice-only, image-generation
                # or embedding products merely because they accept text inputs.
                relevant = True
        if (
            scenario.id != "unspecified"
            and entity.type == "model"
            and re.search(
                r"\bTTS\b|text.to.speech|speech reasoning|full.duplex voice|语音合成|语音推理|实时语音|文本转换为自然语音|text.to.image|image generation|图像生成|embedding model|嵌入模型",
                hint + " " + entity.name.zh + " " + entity.name.en,
                re.IGNORECASE,
            )
        ):
            relevant = False
        if relevant:
            pool.append(entity)
    # Qualification is checked over the complete relevant pool before the bounded
    # report workset. Direct cited feature matches order validation work only.
    pool.sort(
        key=lambda entity: (
            not current_by_entity.get(entity.id)
            or bool(constraint_failures(entity, current_by_entity.get(entity.id, []), context)),
            -len(described_features(current_by_entity.get(entity.id, []), scenario, language)),
            entity.name.en.casefold(),
            entity.id,
        )
    )
    ids = [entity.id for entity in pool]
    return ids[:20], DecisionScope(
        considered_entity_ids=ids,
        omitted_entity_ids=ids[20:],
        selection_basis=(
            "全目录用途检索 → 全范围硬条件核验 → 已引用功能的验证顺序；最多展示20个，顺序不表示性能排名。"
            if language == "zh"
            else "Whole-catalog use discovery → scope-wide constraint checks → cited-feature validation order; up to 20 shown, with no performance ranking."
        ),
    )
