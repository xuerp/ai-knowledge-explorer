"""Reconcile an officially reviewed parameter change without trimming the catalog."""

import argparse
import json
from pathlib import Path

CLAIM_ID = "c-change-gemini-sampling-deprecated"
SOURCE_ID = "s-change-gemini-sampling-guide-20261026"
SCOPE_ZH = "Gemini 3.6 Flash、3.5 Flash-Lite 及其后续型号；不外推到全部旧版本。"
SCOPE_EN = "Gemini 3.6 Flash, 3.5 Flash-Lite and later models; not every older version."
SUMMARY_ZH = "temperature、top_p、top_k 从 Gemini 3.6 Flash 和 3.5 Flash-Lite 起弃用；这两款型号忽略这些参数，后续型号可能返回错误。"
SUMMARY_EN = "temperature, top_p and top_k are deprecated starting with Gemini 3.6 Flash and 3.5 Flash-Lite; these models ignore them, while later generations may reject them."
REPLACEMENTS = {
    "Gemini Deep Research agent 以预览版提供。": "Gemini Deep Research agent 于 2025-12-11 以预览版发布；此为历史发布记录，不代表旧预览端点当前仍可用。",
    "The Gemini Deep Research agent was launched in preview.": "The Gemini Deep Research agent launched in preview on 2025-12-11; this historical launch does not establish current availability of the original preview endpoint.",
    "最新模型指南弃用以上采样参数。 适用范围：最新 Gemini 3.x 系列；不外推到全部旧版本。": SUMMARY_ZH,
    "Latest model guidance deprecates these sampling parameters. Scope: Latest Gemini 3.x, not every historical model.": SUMMARY_EN,
    "最新模型指南弃用以上采样参数。": SUMMARY_ZH,
    "Latest model guidance deprecates these sampling parameters.": SUMMARY_EN,
    "最新 Gemini 3.x 系列；不外推到全部旧版本。": SCOPE_ZH,
    "Latest Gemini 3.x, not every historical model.": SCOPE_EN,
    "2026-07-21: Latest model guidance deprecates these sampling parameters. Scope: Latest Gemini 3.x, not every historical model.": "The sampling parameters temperature, top_p and top_k are now deprecated.",
}
SOURCE = {
    "id": SOURCE_ID,
    "title": {
        "zh": "Gemini 3.6 Flash 与 3.5 Flash-Lite 参数迁移指南",
        "en": "Gemini 3.6 Flash and 3.5 Flash-Lite parameter migration",
    },
    "url": "https://ai.google.dev/gemini-api/docs/whats-new-gemini-3.6#api-changes-and-parameter-updates",
    "publisher": "Google",
    "publishedAt": "",
    "collectedAt": "2026-10-26",
    "verifiedAt": "2026-10-26",
    "originalLanguage": "en",
    "type": "official",
    "sourceExcerpt": "temperature, top_p, and top_k are deprecated and ignored.",
    "supportsClaimIds": [CLAIM_ID],
}


def reconcile(value):
    if isinstance(value, str):
        return REPLACEMENTS.get(value, value)
    if isinstance(value, list):
        return [reconcile(item) for item in value]
    if not isinstance(value, dict):
        return value
    result = {key: reconcile(item) for key, item in value.items()}
    if result.get("id") == CLAIM_ID or result.get("id") == "t-change-gemini-sampling-deprecated":
        result["sourceIds"] = list(dict.fromkeys([*result["sourceIds"], SOURCE_ID]))
    if isinstance(result.get("evidence"), list) and not any(
        s["id"] == SOURCE_ID for s in result["evidence"]
    ):
        result["evidence"].append(SOURCE)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("path", type=Path)
    args = parser.parse_args()
    before = args.path.read_text(encoding="utf-8")
    original = json.loads(before)
    corrected = reconcile(original)
    # Preserve formatting of the large catalog rather than serializing every record.
    after = before
    for old, new in REPLACEMENTS.items():
        after = after.replace(
            json.dumps(old, ensure_ascii=False), json.dumps(new, ensure_ascii=False)
        )
    if not any(s["id"] == SOURCE_ID for s in original["evidence"]):
        marker = '"evidence": ['
        entry = json.dumps(SOURCE, ensure_ascii=False, indent=2)
        entry = "\n".join("    " + line for line in entry.splitlines())
        after = after.replace(marker, marker + "\n" + entry + ",", 1)
    # Link the new scope evidence wherever the original change was referenced.
    old_id = '"s-change-gemini-sampling-deprecated"'
    import re

    after = re.sub(
        r'("sourceIds":\s*\[\s*' + re.escape(old_id) + r")(\s*\])",
        r'\1, "' + SOURCE_ID + r'"\2',
        after,
    )
    actual = json.loads(after)
    # Additional derived change references are allowed; all original record IDs survive.
    for key in ("entities", "claims", "evidence"):
        assert {r["id"] for r in original.get(key, [])} <= {r["id"] for r in actual.get(key, [])}
    assert next(c for c in actual["claims"] if c["id"] == CLAIM_ID) == next(
        c for c in corrected["claims"] if c["id"] == CLAIM_ID
    )
    args.path.write_text(after, encoding="utf-8", newline="")
    print(json.dumps({"path": str(args.path), "changed": before != after}))


if __name__ == "__main__":
    main()
