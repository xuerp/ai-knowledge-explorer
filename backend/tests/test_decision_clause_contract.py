"""Semantic invariants, including minimal pairs rather than whole-task matching."""

import pytest

from app.decision_dialogue import normalize_context, task_parts
from app.decision_intent import positive_task_text
from app.decision_task import understand_task
from app.schemas import DecisionContext


@pytest.mark.parametrize("prefix", ["不要", "也不要", "不需要", "并且不需要", "没有"])
def test_unavailable_material_is_not_positive_input(prefix):
    task = understand_task(f"把中文译成英文，{prefix}代码仓库")
    assert not task.materials
    assert task.limits == (f"{prefix}代码仓库",)


def test_negative_task_does_not_create_a_second_goal():
    context = DecisionContext(
        task="客服工单有中文和英文，判断是否升级给人工；不提取订单字段，也不自动回复客户",
        priority="balanced",
        deployment="undecided",
    )
    assert len(task_parts(context)) <= 1
    assert "订单" not in positive_task_text(context.task)
    assert "不提取订单字段" in understand_task(context.task).limits


@pytest.mark.parametrize("duration", ["九十分钟", "90分钟", "两小时"])
def test_media_length_is_not_execution_deadline(duration):
    assert understand_task(f"整理一段{duration}的会议录音").time_limit is None
    assert understand_task(f"整理一段{duration}的会议录音，十五分钟内完成").time_limit == "十五分钟"


def test_local_processing_reaches_deployment_and_conflict_check():
    task = "会议录音只能在公司机器处理，不能上传"
    assert (
        normalize_context(
            DecisionContext(task=task, priority="balanced", deployment="undecided")
        ).deployment
        == "on-device"
    )
    with pytest.raises(ValueError, match="云服务"):
        normalize_context(DecisionContext(task=task, priority="balanced", deployment="cloud-api"))


def test_prohibited_operations_remain_separate_from_positive_materials():
    parsed = understand_task("只给 SQL 和 EXPLAIN，不接生产库、不执行查询、不修改索引")
    assert "不执行查询" in parsed.limits[1]


def test_optional_offline_is_not_mandatory():
    assert not understand_task("分析文档，不需要完全离线").offline


def test_positive_and_unavailable_material_can_share_one_sentence():
    parsed = understand_task("读取现有代码仓库但没有文档；不要改接口")
    assert "代码" in parsed.materials and "仓库" in parsed.materials
    assert "文档" not in parsed.materials
    assert "没有文档" in parsed.limits


def test_embedded_negation_does_not_supply_available_material():
    assert "文档" not in understand_task("我没有文档只有报错截图").materials


def test_available_material_after_absence_is_retained():
    parsed = understand_task("我没有代码仓库只有 PDF 文档")
    assert "代码" not in parsed.materials and "仓库" not in parsed.materials
    assert "PDF" in parsed.materials and "文档" in parsed.materials
