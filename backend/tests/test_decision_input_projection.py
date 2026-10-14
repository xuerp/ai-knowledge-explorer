"""Regressions for approved input facts lost during decision projection."""

import pytest

from app.decision_facts import normalized_facts
from app.schemas import Claim


def project(text):
    claim = Claim(
        id="input-projection",
        entity_id="concrete-model",
        predicate="catalog-review",
        object_or_value="model-id",
        text={"zh": text, "en": text},
        confidence="verified",
        source_ids=["official"],
        updated_at="2026-10-01",
    )
    return {fact.value for fact in normalized_facts(claim) if fact.dimension == "input-modalities"}


@pytest.mark.parametrize(
    "text,expected",
    [
        ("具体版本：文本与图像输入。", {"text", "image"}),
        ("Specific version: text/image input.", {"text", "image"}),
        ("Supports text, image and video inputs.", {"text", "image", "video"}),
        ("Uses recorded audio input.", {"audio"}),
        ("不支持图像输入；文本输入。", {"text"}),
        ("Without image input; text input.", {"text"}),
        ("Text and image output.", set()),
        ("原生多模态模型。", set()),
        ("Image input is unverified.", set()),
        ("This model family supports text/image input.", set()),
        ("可能支持图像输入。", set()),
    ],
)
def test_exact_input_lists_preserve_negation_and_direction(text, expected):
    assert project(text) == expected
