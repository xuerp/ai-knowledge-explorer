"""Label known editorial templates; do not infer truth from wording or mark facts verified."""

import argparse
import json
import re
from pathlib import Path

TEMPLATE = "的公开版本发布，保留该产品线的真实迭代记录。"
REVIEWED_QUOTES = {
    "s-change-gemini-sampling-deprecated",
    "s-change-gemini-sampling-guide-20261026",
}


def classify(path):
    before = path.read_text(encoding="utf-8")
    data = json.loads(before)
    after = before
    changed = []
    for source in data.get("evidence", []):
        excerpt = source.get("sourceExcerpt") or ""
        kind = (
            "summary"
            if excerpt.endswith(TEMPLATE)
            else "quote"
            if source["id"] in REVIEWED_QUOTES
            else None
        )
        if kind is None or source.get("sourceExcerptKind") == kind:
            continue
        # Evidence records are flat except for the title, preceding sourceExcerpt.
        start = after.index('"id": ' + json.dumps(source["id"]))
        end = after.index("}", after.index('"sourceExcerpt":', start))
        segment = after[start:end]
        if '"sourceExcerptKind"' in segment:
            segment = re.sub(
                r'"sourceExcerptKind":\s*"[^"]*"', '"sourceExcerptKind": "' + kind + '"', segment
            )
        else:
            segment = re.sub(
                r'("sourceExcerpt":\s*"(?:\\.|[^"\\])*",)(\s*)',
                r'\1\2"sourceExcerptKind": "' + kind + r'",\2',
                segment,
                count=1,
            )
        if kind == "summary":
            segment = segment.replace('"originalLanguage": "en"', '"originalLanguage": "zh"')
        after = after[:start] + segment + after[end:]
        changed.append(source["id"])
    updated = json.loads(after)
    assert len(updated["evidence"]) == len(data["evidence"])
    for old, new in zip(data["evidence"], updated["evidence"], strict=True):
        assert old["id"] == new["id"] and old.get("sourceExcerpt") == new.get("sourceExcerpt")
    path.write_text(after, encoding="utf-8", newline="")
    return changed


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("paths", nargs="+", type=Path)
    args = parser.parse_args()
    for path in args.paths:
        print(json.dumps({"path": str(path), "classified": len(classify(path))}))
