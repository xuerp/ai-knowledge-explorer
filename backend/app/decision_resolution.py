"""Reconcile every derived surface with the final decision, not an earlier plan."""

from .schemas import DecisionAction, DecisionPlan


def reconcile_resolution(decision, context=None, language="zh"):
    guidance = decision.guidance
    if not guidance:
        return decision
    state = {"blocked": "failed", "clarify": "needs-input", "unsupported": "no-candidates"}.get(
        guidance.outcome
    )
    if state:
        actions = []
        if guidance.outcome == "clarify" and guidance.clarification:
            question = guidance.clarification
            actions = [
                DecisionAction(
                    id="answer-" + question.id,
                    kind="clarify",
                    title=question.question,
                    instruction=guidance.next_action.instruction,
                    unlocks=question.reason,
                )
            ]
        decision.plan = DecisionPlan(
            state=state,
            can_decide=guidance.recommendation.summary,
            # The current guidance owns clarification/recovery. Earlier generic
            # "explain your task" actions must not survive a parser failure.
            actions=actions,
            trial_candidate_ids=[],
            trial=None,
        )
        decision.recommendation = decision.recommendation.model_copy(
            update={
                "primary_entity_id": None,
                "alternative_entity_ids": [],
                "validation_entity_ids": [],
                "summary": guidance.recommendation.summary,
                "reasons": [],
            }
        )
        if guidance.outcome == "blocked":
            decision.status = "failed"
        # Preliminary features are not permission to start a business trial.
    if guidance.outcome == "conditional" and decision.plan and guidance.next_action.kind == "start":
        # A useful method or qualification pilot is not proof that every model
        # with text generation qualifies for this complete business workflow.
        decision.plan.state = "needs-evidence"
        decision.plan.can_decide = guidance.recommendation.summary
        decision.plan.trial_candidate_ids = []
        decision.plan.actions = [
            action
            for action in decision.plan.actions
            if action.kind not in {"test", "source", "reconcile"}
        ]
        decision.recommendation = decision.recommendation.model_copy(
            update={
                "primary_entity_id": guidance.recommendation.primary_entity_id,
                "alternative_entity_ids": guidance.recommendation.entity_ids,
                "validation_entity_ids": [],
                "summary": guidance.recommendation.summary,
            }
        )
    if guidance.next_action.kind == "start" and decision.plan and decision.plan.trial and context:
        t = lambda zh, en: zh if language == "zh" else en
        trial = decision.plan.trial
        source = (
            trial.sample if context.task in trial.sample else context.task + "\n" + trial.sample
        )
        prompt = "\n\n".join(
            [
                t(
                    "这是尚未执行的实际验证任务。请处理我提供的材料并返回实际交付，不要回答产品选型问题，也不要虚构测试成绩；材料不足时先说明缺少什么。",
                    "This is an unexecuted validation task. Process the materials I provide and return the deliverable; do not answer product-selection questions or invent scores. Identify missing inputs first.",
                ),
                t("任务与本轮范围：", "Task and scope: ") + source,
                t("操作步骤：", "Procedure: ") + "\n".join(trial.procedure),
                t("合格标准：", "Acceptance: ") + "\n".join(trial.acceptance),
                t("记录实际结果：", "Record actual results: ") + "\n".join(trial.metrics),
                t(
                    "未运行、超时或无法确认的项目保持未完成，不把计划写成通过。",
                    "Unrun, timed-out or unverified checks remain incomplete; a plan is not a pass.",
                ),
            ]
        )
        guidance.next_action.execution_prompt = prompt
    return decision
