import pytest

from app.schemas import Claim, ClaimText, Entity, EntitySpecs, LocalizedText
from app.spec_verification import (
    adopt_spec,
    normalized_spec,
    same_spec,
    spec_basis,
    spec_field_for,
)

# Real card/fact pairs from the live catalog on 2026-11-26.
SAME_VALUE_DIFFERENT_WORDING = [
    ("input_price", "$10 USD per MTok", "$10 / 1M tokens"),
    (
        "input_price",
        "USD 4 / 1M uncached text input tokens; promotion at least through 2026-11-21",
        "$4 / 1M tokens",
    ),
    (
        "context_window",
        "1M tokens on Tencent Cloud TokenHub",
        "1,048,576 shared input and output tokens",
    ),
    ("context_window", "128K", "131,072 tokens"),
]


@pytest.mark.parametrize(("field", "fact", "card"), SAME_VALUE_DIFFERENT_WORDING)
def test_wording_differences_are_not_reported_as_changes(field, fact, card):
    assert same_spec(field, normalized_spec(field, fact), normalized_spec(field, card))


def test_a_real_value_change_is_reported():
    assert not same_spec("input_price", normalized_spec("input_price", "$2"), 2.5)
    assert not same_spec("context_window", normalized_spec("context_window", "2M"), 1_048_576)


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("released_at", "gpt-6.2-astra"),
        (
            "context_window",
            "GLM-5.3 官方文档列出文本模态、1M 上下文和 128K 最大输出，思考不可关闭。",
        ),
        ("input_price", "$2 input and $8 output"),
        ("input_price", ""),
    ],
)
def test_sentences_identifiers_and_mixed_prices_are_not_compared(field, value):
    assert normalized_spec(field, value) is None


@pytest.mark.parametrize(
    ("predicate", "field"),
    [
        ("context-window", "context_window"),
        ("standard-input-price", "input_price"),
        ("standard-output-price", "output_price"),
        ("released-on", "released_at"),
        ("historical-input-price", None),
        ("historical-channel-has-max-context", None),
        ("supports", None),
    ],
)
def test_only_current_spec_predicates_map_to_card_fields(predicate, field):
    claim = Claim(
        id="c",
        text=ClaimText(zh="x", en="x"),
        confidence="verified",
        source_ids=["s"],
        updated_at="2026-11-26",
        predicate=predicate,
    )
    assert spec_field_for(claim) == field


def _entity(**specs):
    return Entity(
        id="e-model",
        type="model",
        slug="model",
        name=LocalizedText(zh="模型", en="Model"),
        summary=LocalizedText(zh="", en=""),
        status="active",
        tags=[],
        last_updated_at="2026-11-01",
        specs=EntitySpecs(**specs),
    )


def _claim(claim_id, predicate, value, valid_from, confidence="verified", entity_id="e-model"):
    return Claim(
        id=claim_id,
        entity_id=entity_id,
        text=ClaimText(zh=value, en=value),
        confidence=confidence,
        source_ids=[f"s-{claim_id}"],
        updated_at="2026-11-26",
        predicate=predicate,
        object_or_value=value,
        valid_from=valid_from,
    )


def test_latest_verified_fact_per_field_is_the_basis():
    entity = _entity(input_price="$3 / 1M tokens", context_window="1M tokens")
    claims = [
        _claim("old", "standard-input-price", "$3", "2026-01-01"),
        _claim("new", "standard-input-price", "$2.50", "2026-11-01"),
        _claim("unreviewed", "standard-input-price", "$1", "2026-11-20", confidence="unverified"),
        _claim("other-model", "context-window", "2M", "2026-11-20", entity_id="e-other"),
        _claim("same-context", "context-window", "1,048,576 tokens", "2026-10-01"),
    ]
    basis = {item.field: item for item in spec_basis(entity, claims)}

    assert basis["input_price"].claim.id == "new"
    assert basis["input_price"].differs is True
    assert basis["context_window"].claim.id == "same-context"
    assert basis["context_window"].differs is False


def test_a_free_text_card_value_is_never_flagged():
    entity = _entity(input_price="Contact sales")
    [basis] = spec_basis(entity, [_claim("p", "standard-input-price", "$2", "2026-11-01")])
    assert basis.differs is False


def test_adopting_a_value_changes_only_that_field():
    entity = _entity(input_price="$3 / 1M tokens", output_price="$15 / 1M tokens")
    updated = adopt_spec(entity, "input_price", "$2.50 / 1M tokens")
    assert updated.specs.input_price == "$2.50 / 1M tokens"
    assert updated.specs.output_price == "$15 / 1M tokens"
    assert entity.specs.input_price == "$3 / 1M tokens"
    with pytest.raises(ValueError, match="YYYY-MM-DD"):
        adopt_spec(entity, "released_at", "November 2026")
