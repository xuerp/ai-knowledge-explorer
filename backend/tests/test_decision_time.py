"""Execution-time invariants use independent minimal pairs, no provider calls."""

import json

import pytest

from app.decision_semantics import TaskMeaningService, task_digest, validate_meaning
from app.decision_task import understand_context, understand_task
from app.decision_time import deadline_from_quote, execution_bounds
from app.schemas import DecisionContext


@pytest.mark.parametrize(
    "text,expected",
    [
        ("想现在开始，告诉我第一步", None),
        ("马上就能使用的方法是什么", None),
        ("请尽快说明怎么做", None),
        ("在二十分钟的会议录音里找议题", None),
        ("extract topics in 20 minutes of audio", None),
        ("核对2026-10-20发布的规程", None),
        ("明天下午三点收到的样本先归档", None),
        ("只查三天内生成的记录", None),
        ("统计在30天内的订单", None),
        ("核对过去五天内的数据", None),
        ("整理二十分钟的录音，五分钟内完成", "五分钟"),
        ("最多用半小时核对合成样本", "半小时"),
        ("给我半小时完成第一次测试", "半小时"),
        ("review the examples within 12 minutes", "12 minutes"),
        ("明天下午三点前提交核对结果", "明天下午三点"),
        ("请在2026-10-25 17:00前完成", "2026-10-25 17:00"),
        ("截止时间：下周五18:00", "下周五18:00"),
    ],
)
def test_only_execution_relationships_supply_a_time_limit(text, expected):
    assert understand_task(text).time_limit == expected


def payload(task, quote):
    return {
        "version": 2,
        "source_sha256": task_digest(task),
        "state": "understood",
        "route": "table-normalization",
        "items": [
            {"role": "goal", "quote": task.split("；")[0]},
            {"role": "deadline", "quote": quote},
        ],
        "ambiguity": None,
    }


class Replay:
    def __init__(self, proposal):
        self.proposal = proposal

    def interpret(self, request):
        return json.dumps(self.proposal, ensure_ascii=False)


@pytest.mark.parametrize("quote", ["现在就能开始的方法", "马上开始", "十二分钟的录音"])
def test_source_provenance_does_not_prove_a_deadline_role(quote):
    task = "核对合成报价；" + quote
    receipt = TaskMeaningService(Replay(payload(task, quote))).understand(task)
    assert receipt.status == "validated"
    assert "unverified-deadline-role" in receipt.normalizations
    assert any(item.quote == quote and item.role == "condition" for item in receipt.meaning.items)
    context = DecisionContext(
        task=task, priority="balanced", deployment="undecided", task_meaning=receipt
    )
    assert understand_context(context).time_limit is None
    # Old saved or externally constructed receipts cannot bypass consumption
    # checks merely by retaining status=validated and a correct source hash.
    receipt.meaning.items[-1].role = "deadline"
    with pytest.raises(ValueError, match="execution bound"):
        validate_meaning(receipt.meaning.model_dump_json(), task)
    assert understand_context(context).time_limit is None


def test_quote_cannot_borrow_a_genuine_deadline_from_another_clause():
    task = "核对报价；现在开始；十五分钟内完成"
    assert deadline_from_quote("现在开始", task) is None
    assert deadline_from_quote("十五分钟", task) == "十五分钟"
    receipt = TaskMeaningService(Replay(payload(task, "现在开始"))).understand(task)
    context = DecisionContext(
        task=task, priority="balanced", deployment="undecided", task_meaning=receipt
    )
    assert understand_context(context).time_limit == "十五分钟"


def test_bound_is_extracted_instead_of_using_a_whole_instruction_as_a_stop_value():
    task = "核对报价；请在十分钟内完成样本核对"
    receipt = TaskMeaningService(Replay(payload(task, "请在十分钟内完成样本核对"))).understand(task)
    context = DecisionContext(
        task=task, priority="balanced", deployment="undecided", task_meaning=receipt
    )
    assert receipt.status == "validated"
    assert understand_context(context).time_limit == "十分钟"
    assert execution_bounds(task)[0].value == "十分钟"


def test_notes_and_clarification_can_supply_a_grounded_bound():
    context = DecisionContext(
        task="核对合成报价", notes="十五分钟内完成", priority="balanced", deployment="undecided"
    )
    from app.decision_semantics import meaning_source

    source = meaning_source(context)
    context.task_meaning = TaskMeaningService(Replay(payload(source, "十五分钟内完成"))).understand(
        source
    )
    assert understand_context(context).time_limit == "十五分钟"
