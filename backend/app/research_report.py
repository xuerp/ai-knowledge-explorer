"""A reading document shared by PDF and Markdown; never a webpage capture.

No network, extraction or persistence. Only the caller's revalidated citations
are used. Private PoC notes and UI controls are deliberately outside this report.
"""

from dataclasses import dataclass, field
from datetime import UTC
from io import BytesIO
from pathlib import Path
from xml.sax.saxutils import escape
from zoneinfo import ZoneInfo

from .decision_candidates import CATALOG
from .decision_comparison import LABELS
from .schemas import KnowledgeSnapshot, ResearchView


@dataclass
class Section:
    title: str
    paragraphs: list[str] = field(default_factory=list)
    rows: list[list[str]] = field(default_factory=list)
    level: int = 2


@dataclass
class Report:
    title: str
    task: str
    metadata: str
    sections: list[Section]


def build_report(research: ResearchView, snapshot: KnowledgeSnapshot, language: str) -> Report:
    def t(zh, en):
        return zh if language == "zh" else en

    def name(key):
        entity = next((item for item in snapshot.entities if item.id == key), None)
        return getattr(entity.name, language) if entity else key

    citations = [item for item in research.citations if item.claim.id in research.claim_ids]
    sources, indexes, source_keys, aliases = {}, {}, {}, {}
    for item in citations:
        for source in item.evidence:
            # Quotes keep separate Evidence IDs; a single document gets one report reference.
            identity = (
                source.url,
                source.published_at,
                source.publisher,
                getattr(source.title, language),
            )
            if identity not in source_keys:
                source_keys[identity] = source.id
                sources[source.id] = source
            aliases[source.id] = source_keys[identity]
    claims = {item.claim.id: item.claim for item in citations}

    def refs(ids):
        numbers = {}
        for key in ids:
            if key not in claims:
                continue
            for source in claims[key].source_ids:
                if source not in aliases:
                    continue
                document = aliases[source]
                if document not in indexes:
                    indexes[document] = len(indexes) + 1
                numbers[indexes[document]] = None
        return " ".join(f"[{number}]" for number in numbers)

    decision = research.decision
    summary = decision.recommendation.summary if decision else research.summary
    candidates = decision.candidates if decision else []
    if candidates and all(item.eligibility == "excluded" for item in candidates):
        summary = t("没有符合本次硬条件的候选。", "No candidate meets the selected constraints.")
    sections = [Section(t("结论与建议", "Conclusion and recommendation"), [summary])]
    sections[0].paragraphs.append(
        t(
            "资料引用不等于业务实测。功能描述可用于缩小验证范围，不能证明效果排名。",
            "Cited descriptions narrow the trial scope; they are not measured task quality or a performance ranking.",
        )
    )
    if any(value != "current" for value in research.citation_states.values()):
        sections[0].paragraphs.append(
            t(
                "历史引用已有变化，请重新分析后再决定。",
                "Historical citations changed. Reanalyze before deciding.",
            )
        )
    if decision:
        estimates = [
            name(candidate.entity_id) + ": " + finding.finding + " " + refs(finding.claim_ids)
            for candidate in candidates
            for finding in candidate.strengths
            if finding.dimension == "api-price"
        ]
        if estimates:
            sections.append(
                Section(t("按本次工作量估算费用", "Cost estimate for this workload"), estimates)
            )
        if decision.plan:
            plan = decision.plan
            sections.append(
                Section(t("当前能决定什么", "What can be decided now"), [plan.can_decide])
            )
            for action in plan.actions:
                dimensions = [
                    CATALOG["features"][key]["name"][language]
                    if key in CATALOG["features"]
                    else LABELS.get(key, (key, key))[language == "en"]
                    for key in action.dimensions
                ]
                sections.append(
                    Section(
                        action.title,
                        [
                            *(
                                [
                                    t("适用候选：", "Candidates: ")
                                    + "、".join(map(name, action.candidate_ids))
                                ]
                                if action.candidate_ids
                                else []
                            ),
                            *(
                                [t("需要解决：", "Resolve: ") + "、".join(dimensions)]
                                if dimensions
                                else []
                            ),
                            action.instruction + " " + refs(action.claim_ids),
                            action.unlocks,
                        ],
                        level=3,
                    )
                )
            if plan.trial:
                trial = plan.trial
                sections.append(
                    Section(
                        t("业务测试方案（尚未执行）", "Business trial protocol (not executed)"),
                        [
                            trial.sample,
                            *trial.procedure,
                            *(t("记录指标：", "Metric: ") + line for line in trial.metrics),
                            *(t("合格标准：", "Acceptance: ") + line for line in trial.acceptance),
                            t("可进入本轮验证：", "Eligible for this trial: ")
                            + "、".join(map(name, plan.trial_candidate_ids))
                            if plan.trial_candidate_ids
                            else t(
                                "先完成必要资格与来源核验，再执行此方案。",
                                "Verify required eligibility and sources before executing this protocol.",
                            ),
                        ],
                        level=3,
                    )
                )
        comparisons = sorted(
            decision.comparisons, key=lambda row: not row.id.startswith("feature-")
        )
        used_claims = set()
        if comparisons:
            sections.append(Section(t("功能与规格比较", "Features and specifications")))
        missing_dimensions = []
        for comparison in comparisons:
            known = [cell for cell in comparison.cells if cell.facts]
            unknown = [cell for cell in comparison.cells if not cell.facts]
            other_basis = {
                cell.entity_id
                for other in comparisons
                if comparison.id.startswith("api-price")
                and other.id.startswith("api-price")
                and other.id != comparison.id
                for cell in other.cells
                if cell.facts
            }
            unknown = [cell for cell in unknown if cell.entity_id not in other_basis]
            if not known:
                missing_dimensions.append(comparison.dimension)
                continue
            rows = [[t("候选", "Candidate"), t("当前引用说明", "Cited description")]]
            for cell in known:
                rows.append(
                    [
                        name(cell.entity_id),
                        " ".join(
                            dict.fromkeys(
                                item.finding + " " + refs(item.claim_ids) for item in cell.facts
                            )
                        ),
                    ]
                )
                used_claims.update(key for fact in cell.facts for key in fact.claim_ids)
            notes = (
                [
                    t("当前引用未覆盖：", "No explicit citation for: ")
                    + "、".join(name(cell.entity_id) for cell in unknown)
                ]
                if unknown
                else []
            )
            sections.append(Section(comparison.dimension, notes, rows, level=3))
        if missing_dimensions:
            sections.append(
                Section(
                    t("尚不能比较的维度", "Dimensions awaiting evidence"),
                    [
                        "、".join(missing_dimensions),
                        t(
                            "规格与条款需补充明确来源；业务效果与速度需同口径实测。资料缺失不表示产品不支持。",
                            "Specifications and terms need explicit sources; quality and speed need comparable tests. Missing evidence does not establish lack of support.",
                        ),
                    ],
                    level=3,
                )
            )
        states = {
            "eligible": t(
                "可继续验证，效果未实测", "Ready for validation; task quality is untested"
            ),
            "excluded": t("硬条件排除", "Excluded"),
            "unknown": t("条件未核验", "Constraints unverified"),
            "conflict": t("证据冲突", "Conflicting evidence"),
            "trial": t("可进入业务验证", "Ready for a business trial"),
            "features": t("必要功能待核验", "Required features unverified"),
            "gates": t("先解决当前决定条件", "Resolve current decision gates first"),
        }
        if candidates:
            rows = [[t("候选", "Candidate"), t("资格与主要缺口", "Eligibility and gaps")]]
            reason_targets = {}
            for candidate in candidates:
                for reason in dict.fromkeys(candidate.reasons):
                    reason_targets.setdefault(reason, []).append(candidate.entity_id)
            common = {reason: ids for reason, ids in reason_targets.items() if len(ids) > 1}
            groups = {}
            for candidate in candidates:
                state = candidate.eligibility
                if state == "eligible" and decision.plan:
                    state = (
                        "trial"
                        if candidate.entity_id in decision.plan.trial_candidate_ids
                        else "features"
                        if not set(decision.scenario.required_features)
                        <= {item.dimension for item in candidate.strengths}
                        else "gates"
                    )
                key = (
                    state,
                    tuple(
                        reason
                        for reason in dict.fromkeys(candidate.reasons)
                        if reason not in common
                    ),
                )
                groups.setdefault(key, []).append(candidate.entity_id)
            for (state, reasons), ids in groups.items():
                rows.append(["、".join(map(name, ids)), "；".join([states[state], *reasons])])
            sections.append(
                Section(
                    t("候选资格", "Candidate eligibility"),
                    [
                        t(
                            "资格检查与功能描述分开判断；资料缺失不能当成产品不支持。",
                            "Eligibility and feature descriptions are separate; missing evidence does not establish lack of support.",
                        )
                    ]
                    + [
                        reason
                        + "（"
                        + (
                            t("全部候选", "All candidates")
                            if len(ids) == len(candidates)
                            else "、".join(map(name, ids))
                        )
                        + "）"
                        for reason, ids in common.items()
                    ],
                    rows,
                )
            )
        conditions = [
            line for line in decision.conditions if not line.startswith(("任务：", "Task:"))
        ]
        if research.decision_context and research.decision_context.notes:
            conditions.append(t("补充说明：", "Notes: ") + research.decision_context.notes)
        sections.append(
            Section(t("本次条件与范围", "Conditions and scope"), list(dict.fromkeys(conditions)))
        )
        if decision.scope:
            sections[-1].paragraphs.append(
                t("本报告涉及：", "Candidates in scope: ")
                + "、".join(name(row.entity_id) for row in candidates)
            )
            if decision.scope.omitted_entity_ids:
                sections[-1].paragraphs.append(
                    t("未展示：", "Not shown: ")
                    + "、".join(map(name, decision.scope.omitted_entity_ids))
                )
        checks = [
            line
            for line in ([] if decision.plan else decision.next_checks)
            if not any(line.startswith(name(row.entity_id) + ":") for row in candidates)
        ]
        sections.append(
            Section(
                t("验证计划与风险", "Validation plan and risks"),
                list(dict.fromkeys([*checks, *(item.detail for item in decision.risks)])),
            )
        )
    supplemental = [
        item
        for item in citations
        if (not decision or item.claim.id not in used_claims)
        and (
            not decision
            or decision.scenario.id != "coding-workspace"
            or item.claim.predicate
            in {"workflow-feature", "product-entry", "workflow-qualification"}
        )
    ]
    if supplemental or not citations:
        sections.append(
            Section(
                t("补充引用事实", "Additional cited facts"),
                [
                    getattr(item.claim.text, language) + " " + refs([item.claim.id])
                    for item in supplemental
                ]
                or [
                    t(
                        "无可用于本报告的当前引用。",
                        "No current citations available for this report.",
                    )
                ],
            )
        )
    sections.append(
        Section(
            t("来源", "Sources"),
            [
                f"[{indexes[key]}] {getattr(source.title, language)} — {source.publisher}\n"
                + t("资料日期：", "Source date: ")
                + (source.published_at or t("未明确", "Unknown"))
                + t("；核验日期：", "; Verified: ")
                + (source.verified_at[:10] if source.verified_at else t("未明确", "Unknown"))
                + "\n"
                + source.url
                for key in indexes
                for source in [sources[key]]
            ],
        )
    )
    sections.append(
        Section(
            t("报告边界", "Report bounds"),
            [
                t(
                    "本报告依据当前收录引用编排。未执行产品业务测试；供应商条款与可用性仍需复核。",
                    "This report uses the recorded citations. No product task tests were performed; provider terms and availability require rechecking.",
                )
            ],
        )
    )
    timestamp = decision.as_of if decision else research.created_at
    timestamp = timestamp.replace(tzinfo=UTC) if timestamp.tzinfo is None else timestamp
    metadata = timestamp.astimezone(ZoneInfo("Asia/Shanghai")).strftime("%Y-%m-%d %H:%M") + t(
        " 北京时间", " UTC+8"
    )
    return Report(
        t("选型分析报告", "Selection analysis report"),
        research.decision_context.task if research.decision_context else research.question,
        metadata,
        sections,
    )


def report_markdown(report: Report) -> str:
    def cell(value):
        return value.replace("|", "\\|").replace("\n", "；")

    lines = ["# " + report.title, "", report.task, "", report.metadata, ""]
    for section in report.sections:
        lines.extend(
            [
                "#" * section.level + " " + section.title,
                "",
                *[text.replace("\n", "\n\n") + "\n" for text in section.paragraphs],
            ]
        )
        if section.rows:
            lines.extend(
                [
                    "| " + " | ".join(map(cell, section.rows[0])) + " |",
                    "| " + " | ".join("---" for _ in section.rows[0]) + " |",
                ]
            )
            lines.extend("| " + " | ".join(map(cell, row)) + " |" for row in section.rows[1:])
            lines.append("")
    return "\n".join(lines)


def report_pdf(report: Report) -> bytes:
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.lib.units import mm
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.cidfonts import UnicodeCIDFont
    from reportlab.pdfbase.ttfonts import TTFont
    from reportlab.platypus import (
        KeepTogether,
        LongTable,
        Paragraph,
        SimpleDocTemplate,
        Spacer,
        TableStyle,
    )

    # Embed a subset of the installed Chinese font on Windows; document remains
    # portable. Other hosts use the standard Chinese CID font supported by PDF.
    font = "RadarReportText"
    if font not in pdfmetrics.getRegisteredFontNames():
        path = Path("C:/Windows/Fonts/simsun.ttc")
        if path.is_file():
            pdfmetrics.registerFont(TTFont(font, str(path), subfontIndex=0))
        else:
            font = "STSong-Light"
            pdfmetrics.registerFont(UnicodeCIDFont(font))
    body = ParagraphStyle(
        "body",
        fontName=font,
        fontSize=10.5,
        leading=17,
        spaceAfter=9,
        wordWrap="CJK",
        textColor=colors.HexColor("#253044"),
    )
    heading = ParagraphStyle(
        "heading",
        parent=body,
        fontSize=14,
        leading=21,
        spaceBefore=17,
        spaceAfter=9,
        keepWithNext=True,
    )
    title = ParagraphStyle("title", parent=body, fontSize=20, leading=28, spaceAfter=12)
    subheading = ParagraphStyle(
        "subheading", parent=heading, fontSize=12, leading=19, spaceBefore=12, spaceAfter=7
    )
    source_style = ParagraphStyle("source", parent=body, fontSize=9, leading=13, spaceAfter=4)
    buffer = BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        rightMargin=18 * mm,
        leftMargin=18 * mm,
        topMargin=18 * mm,
        bottomMargin=20 * mm,
        title=report.title,
        author="AI Radar",
    )

    def para(value, style=body):
        return Paragraph(escape(value).replace("\n", "<br/>"), style)

    story = [para(report.title, title), para(report.task), para(report.metadata), Spacer(1, 5)]
    for section in report.sections:
        if section.title in {"报告边界", "Report bounds"}:
            story.append(para(section.title + ": " + " ".join(section.paragraphs), source_style))
            continue
        if section.title in {"来源", "Sources"} and section.paragraphs:
            story.append(
                KeepTogether(
                    [
                        para(section.title, heading),
                        para(section.paragraphs[0], source_style),
                    ]
                )
            )
            story.extend(
                KeepTogether([para(text, source_style)]) for text in section.paragraphs[1:]
            )
            continue
        opening = [para(section.title, subheading if section.level > 2 else heading)]
        opening.extend(para(text) for text in section.paragraphs)
        # An empty subsection opener must remain a Paragraph so its
        # keepWithNext joins the following table. Wrapping the lone heading in
        # KeepTogether otherwise hides that flag and can orphan its parent.
        if section.level > 2 and len(opening) > 1:
            story.append(KeepTogether(opening))
        else:
            story.extend(opening)
        if section.rows:
            widths = [doc.width * 0.24, doc.width * 0.76]
            table = LongTable(
                [[para(cell) for cell in row] for row in section.rows],
                colWidths=widths,
                repeatRows=1,
                splitInRow=1,
            )
            table.setStyle(
                TableStyle(
                    [
                        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#edf1f6")),
                        ("VALIGN", (0, 0), (-1, -1), "TOP"),
                        ("LEFTPADDING", (0, 0), (-1, -1), 8),
                        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                        ("TOPPADDING", (0, 0), (-1, -1), 8),
                        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
                        ("LINEBELOW", (0, 0), (-1, -1), 0.4, colors.HexColor("#dfe5ed")),
                    ]
                )
            )
            story.append(table)

    def footer(canvas, document):
        canvas.setFont(font, 9)
        canvas.setFillColor(colors.HexColor("#64748b"))
        canvas.drawString(18 * mm, 10 * mm, "AI Radar")
        canvas.drawRightString(A4[0] - 18 * mm, 10 * mm, str(document.page))

    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    return buffer.getvalue()
