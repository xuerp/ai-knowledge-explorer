"""Retain explicitly ordered goals without guessing another method or product.

This is a source grammar over validated goal excerpts, not semantic inference
from topic keywords. Sequence is not proof of a data dependency or capability.
"""

import re

from .decision_semantics import context_meaning, meaning_source

BOUNDARY = r"(?:^|[：:，,；;。.\n!?]\s*)"
FIRST = re.compile(
    r"(?P<step>(?:首先|第一步(?:是|为)?|(?<![优领率抢事])先)(?!不|别|勿|不要|不得)|\bfirst\b)",
    re.IGNORECASE,
)
NEXT = re.compile(
    BOUNDARY
    + r"(?P<step>然后|接着|随后|最后|第二步(?:是|为)?|第三步(?:是|为)?|再(?!次)|then\b|next\b|finally\b)",
    re.IGNORECASE,
)


def ordered_task_stages(context) -> tuple[str, ...]:
    """Use only a grounded goal with explicit first/next markers.

    Do not derive goals from conditions, absent materials, prohibitions, or a
    method name. Parallel goals and unmarked prose retain the existing path;
    this helper never invents their order.
    """
    meaning = context_meaning(context)
    if meaning is None or meaning.state != "understood" or meaning.scenario != "general-text":
        return ()
    sequences = []
    from .decision_clauses import clauses
    from .decision_intent import CATALOG

    positive = [item.quote for item in meaning.items if item.role in {"goal", "output"}]
    regions = [item.quote for item in meaning.items if item.role == "goal"]
    source = meaning_source(context)
    if len(positive) > 1 and all(source.count(quote) == 1 for quote in positive):
        # Concise parser excerpts may separate the goal and its second output,
        # or omit the first/then markers. Inspect their source paragraph, while
        # requiring each resulting stage to include a grounded positive item.
        start = min(source.index(quote) for quote in positive)
        end = max(source.index(quote) + len(quote) for quote in positive)
        start = source.rfind("\n", 0, start) + 1
        paragraph_end = source.find("\n", end)
        regions.append(source[start : paragraph_end if paragraph_end >= 0 else len(source)])
    for text in dict.fromkeys(regions):
        first = FIRST.search(text)
        if not first:
            continue
        # A negated first action cannot authorize a positive chain, even if a
        # provider assigned the whole sentence a goal role.
        preceding = re.split(r"[，,。.!?；;：:]", text[: first.start("step")])[-1]
        if re.search(
            r"不要|不能|不得|禁止|勿|别|\b(?:never|not|cannot|can't|don't)\b",
            preceding,
            re.IGNORECASE,
        ) or any(part.prohibited for part in clauses(preceding, CATALOG["interpretation"])):
            continue
        following = [match for match in NEXT.finditer(text) if match.start("step") > first.end()]
        if not following:
            continue
        starts = [first.start("step"), *(match.start("step") for match in following)]
        steps = []
        for i, start in enumerate(starts):
            end = starts[i + 1] if i + 1 < len(starts) else len(text)
            # Stop a stage at its sentence boundary; constraints remain in the
            # shared task contract and are not promoted into extra goals.
            match = re.search(r"[。!?；;]|\.(?=\s|$)", text[start:end])
            if match:
                end = start + match.start()
            quote = text[start:end].strip(" \t\r\n，,；;：:")
            if quote and any(quote in item or item in quote for item in positive):
                steps.append(quote)
        if len(steps) >= 2:
            sequences.append(tuple(steps))
    # Conflicting/overlapping interpretations are not merged into a made-up
    # execution order. One explicit sequence is enough to preserve its steps.
    unique = tuple(dict.fromkeys(sequences))
    return unique[0] if len(unique) == 1 else ()


def retain_ordered_trial(trial, stages, language):
    """Attach all source steps and completion checks to the shared protocol."""
    if not stages:
        return trial
    t = lambda zh, en: zh if language == "zh" else en
    preparation = t(
        "先准备原题允许的材料与样本，固定每步交付及人工验收标准，保留输入和输出的编号或来源位置。需要参考标签或参考答案时，先由人工核对或建立；人工分流条件先处理，未确认内容不能作为已核验结果传入后步。",
        "Prepare only the permitted inputs and sample scope. Define each stage's deliverable and human acceptance criteria, retaining input/output IDs or source locations. Verify or establish human references when needed. Apply human-routing conditions first; unconfirmed content is not verified input for a later stage.",
    )
    procedure = [preparation, trial.procedure[0]]
    for index, quote in enumerate(stages, 1):
        instruction = t(f"第 {index} 步：{quote}。", f"Stage {index}: {quote}. ")
        if index > 1:
            instruction += t(
                "使用原题为本步指定的输入；要求基于前步结果时，先核对该结果，缺失则标记阻塞，不能用未完成的前步结果继续。时序本身不改变本步材料范围。",
                "Use the inputs specified for this stage. Where the task requires a prior result, verify it first and mark missing results blocked; do not substitute an unfinished result. Sequence alone does not change the input scope.",
            )
        instruction += t(
            "单独保留本步实际交付及其输入编号或来源位置，未执行或待人工确认的项保持未完成。",
            "Retain this stage's actual deliverable and input IDs or source locations separately. Unrun or human-review items remain incomplete.",
        )
        procedure.append(instruction)
    procedure.extend(trial.procedure[1:])
    procedure.append(
        t(
            "最后逐步核对所有交付物、原始限制和前后对应关系。后步的事实、汇总或原因必须可回到允许使用的前步结果及原始材料；没有依据的内容写未知，不将相关性当成因果。任一步缺能力或输入时保留该步阻塞及恢复所需材料，不把其他已完成步骤当作整项任务通过。",
            "Finally verify every deliverable, original constraint and stage-to-stage mapping. Later facts, aggregates or reasons must trace to permitted prior results and original inputs. Mark unsupported content unknown; correlation is not causation. Missing capabilities or inputs block the affected stage with a recovery requirement, and completed stages do not establish whole-task acceptance.",
        )
    )
    return trial.model_copy(
        update={
            "procedure": procedure,
            "metrics": [
                *trial.metrics,
                t(
                    f"分别记录 {len(stages)} 步的交付完整性、依据可追溯性、依赖阻塞和人工待确认项。",
                    f"Record deliverable completeness, source traceability, dependency blocks and human-review items separately for all {len(stages)} stages.",
                ),
            ],
            "acceptance": [
                *trial.acceptance,
                t(
                    "全部分步交付均须按原题分别核验；后步依赖的结果须真实存在且可追溯。任一必需交付缺失、未运行或被人工补写，不得记作整项自主通过。",
                    "Verify every stage's deliverable against the task. Required prior results must exist and be traceable. Missing, unrun or human-written required deliverables do not count as autonomous whole-task success.",
                ),
            ],
        }
    )
