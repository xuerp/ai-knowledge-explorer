"""Build a reviewable field patch ledger from captured official references.

No guessed dates, no prices borrowed from successor models. Applying the ledger
only changes the named specifications and adds their source-backed dossier point.
"""

import copy
import json
import re
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
REF = ROOT / "data/real_loop/model-specs-20261005"
LEDGER = ROOT.parent / "docs/model-spec-enrichment-20261005.json"
DATE = "2026-10-05"


def text(name):
    return (REF / f"{name}.txt").read_text(encoding="utf-8")


def catalog():
    entities = {}
    for name in ("demo_snapshot.json", "catalog_extension.json", "frontier_catalog_v1.json"):
        for e in json.loads((ROOT / "data" / name).read_text(encoding="utf-8"))["entities"]:
            entities[e["id"]] = {**entities.get(e["id"], {}), **e}
    return entities


def build():
    entities = catalog()
    references = {}
    for path in REF.glob("*manifest.json"):
        payload = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(payload, dict):
            continue  # URL input maps have corresponding capture results.
        for r in payload:
            if not r.get("error"):
                references[r["name"]] = r
    for path in REF.glob("*-results.json"):
        for r in json.loads(path.read_text(encoding="utf-8")):
            if not r.get("error"):
                references[r["name"]] = r
    patches = {}
    if LEDGER.exists():
        for previous in json.loads(LEDGER.read_text(encoding="utf-8"))["entries"]:
            previous["sources"] = {
                s["name"]: {k: s[k] for k in ("url", "sha256")} for s in previous["sources"]
            }
            patches[previous["entityId"]] = previous

    def add(id, specs, sources, note="", released=None):
        e = entities[id]
        patch = patches.setdefault(id, {"entityId": id, "specs": {}, "sources": {}, "notes": []})
        # Keep existing audited values unless this patch explicitly corrects them.
        for key, value in specs.items():
            if value and (not e.get("specs", {}).get(key) or key in patch["specs"]):
                patch["specs"][key] = re.sub(r"([¥$])\.(\d)", r"\g<1>0.\2", value)
        for source in sources:
            reference = references[source]
            patch["sources"][source] = {k: reference[k] for k in ("url", "sha256")}
        if note and note not in patch["notes"]:
            patch["notes"].append(note)
        if released and not (e.get("release", {}).get("releasedAt") or e.get("firstReleasedAt")):
            patch["releasedAt"] = released

    # Per-model OpenAI pages have a deterministic model details and pricing block.
    for id, e in entities.items():
        if e.get("familyId") != "e-gpt" or id not in references:
            continue
        t = text(id)
        specs = {}
        context = re.search(r"- ([\d,]+) context window", t)
        output = re.search(r"- ([\d,]+) max output tokens", t)
        if context:
            specs["contextWindow"] = (
                context[1] + " tokens" + (f" · max output {output[1]}" if output else "")
            )
        block = (
            t.split("## Pricing", 1)[-1].split("## Endpoints", 1)[0] if "## Pricing" in t else ""
        )
        suffix = " · historical API" if e.get("release", {}).get("stage") == "retired" else ""
        for metric, field in (("Input", "inputPrice"), ("Output", "outputPrice")):
            rates = []
            for heading, table in re.findall(r"### ([^\n]+)\n(.*?)(?=\n### |\Z)", block, re.DOTALL):
                match = re.search(rf"\| {metric} \| (\$[\d.]+) \| ([^|]+)\|", table)
                if match:
                    kind = heading.replace(" tokens", "").lower()
                    rates.append(f"{match[1]} / {match[2].strip()} ({kind})")
            if rates:
                specs[field] = "; ".join(rates) + suffix
        if id == "e-gpt-live-1":
            specs.update(
                contextWindow="Voice session · context limit not listed in model reference",
                inputPrice="$0.05 / minute · session total",
                outputPrice="Included in session duration; backend model billed separately",
            )
        if id == "e-gpt-transcribe":
            specs.update(
                contextWindow="Audio transcription · token context limit not listed",
                inputPrice="$0.0045 / minute · transcription total",
                outputPrice="Included in transcription duration",
            )
        if not context and "image" in id:
            specs["contextWindow"] = "Image API · token context limit not listed in model reference"
        add(
            id,
            specs,
            [id],
            "Official model reference; standard uncached token prices, separated by modality. Tool charges are additional. Retired entries use historical reference prices.",
        )
    add(
        "e-gpt-image-2",
        {
            "inputPrice": "$5 text; $8 image / 1M tokens",
            "outputPrice": "$30 / 1M image tokens",
            "contextWindow": "Image API · token context limit not listed in model reference",
        },
        ["e-gpt-image-2", "openai-pricing"],
        "Official Image tokens Standard table: uncached text input $5, image input $8, image output $30 per million. Image output varies by size and quality.",
    )
    add(
        "e-gpt-4o-mini-tts",
        {"contextWindow": "2,000 input tokens"},
        ["e-gpt-4o-mini-tts"],
        "Speech model reference lists a 2,000 input token limit; this is not a chat context window.",
    )

    # Claude model overviews give their own limits, prices and explicit release date.
    for id, e in entities.items():
        if e.get("familyId") != "e-claude" or id not in references:
            continue
        t = text(id)
        m = re.search(
            r"Context window: ([\dKM]+) tokens · Max output: ([\dKM]+) tokens · Input pricing: (\$[\d.]+) / MTok · Output pricing: (\$[\d.]+) / MTok",
            t,
        )
        if not m:
            continue
        released = re.search(r"Released ([A-Z][a-z]+ \d{1,2}, \d{4})", t)
        suffix = " · historical API" if e.get("release", {}).get("stage") == "retired" else ""
        add(
            id,
            {
                "contextWindow": f"{m[1]} tokens · max output {m[2]}",
                "inputPrice": f"{m[3]} / 1M tokens{suffix}",
                "outputPrice": f"{m[4]} / 1M tokens{suffix}",
            },
            [id],
            "Anthropic direct API base prices; excludes Batch discounts and cache read/write pricing.",
            datetime.strptime(released[1], "%B %d, %Y").date().isoformat() if released else None,  # noqa: DTZ007 - source supplies a calendar date, not an instant.
        )

    old_claude = {
        "e-claude-opus-3": ("claude3", 15, 75),
        "e-claude-sonnet-3": ("claude3", 3, 15),
        "e-claude-haiku-3": ("claude3", 0.25, 1.25),
        "e-claude-35": ("claude35", 3, 15),
        "e-claude-sonnet-35-v2": ("claude35", 3, 15),
        "e-claude-sonnet-37": ("claude37", 3, 15),
        "e-claude-haiku-35": ("claude35-v2", 0.8, 4),
        "e-claude-opus-4": ("claude-pricing", 15, 75),
        "e-claude-opus-41": ("claude-pricing", 15, 75),
        "e-claude-4": ("claude-pricing", 3, 15),
    }
    for id, (source, input, output) in old_claude.items():
        sources = [source, "claude-context"]
        if id in ("e-claude-sonnet-35-v2", "e-claude-sonnet-37", "e-claude-haiku-35"):
            sources.append("claude-legacy")
        if id in ("e-claude-opus-4", "e-claude-4"):
            sources.append("claude4-news")
        if id == "e-claude-opus-41":
            sources.append("claude41-news")
        sources = [s for s in sources if s in references]
        add(
            id,
            {
                "contextWindow": "200K tokens",
                "inputPrice": f"${input:g} / 1M tokens · historical API",
                "outputPrice": f"${output:g} / 1M tokens · historical API",
            },
            sources,
            "Historical Anthropic API base price for this release; retirement does not imply free API access. 200K standard context, not the selective experimental 1M access.",
        )

    # Gemini: only Standard paid tier, never Free/Batch/Flex/Vertex pricing.
    tables = json.loads((REF / "gemini-price-tables.json").read_text(encoding="utf-8"))
    google_map = {
        "e-gemini-38-live": "Gemini 3.8 Live,",
        "e-gemini-38-live-thinking": "Gemini 3.8 Live,",
        "e-gemini-31-flash-live": "Gemini 3.8 Live,",
        "e-gemini-31-flash-lite-image": "Gemini 3.1 Flash Lite Image",
        "e-gemini-25-flash-live": "Gemini 2.5 Flash Native Audio",
        "e-gemini-25-flash-tts": "Gemini 2.5 Flash Preview TTS",
        "e-gemini-25-pro-tts": "Gemini 2.5 Pro Preview TTS",
        "e-gemini-3-1-pro": "Gemini 3.1 Pro Preview",
        "e-gemini-3-pro-image": "Gemini 3 Pro Image",
        "e-gemini-25-flash-image": "Gemini 2.5 Flash Image",
        "e-gemini-31-flash-image": "Gemini 3.1 Flash Image",
        "e-gemini-3-flash": "Gemini 3 Flash Preview",
    }
    for id, e in entities.items():
        if e.get("familyId") != "e-gemini":
            continue
        specs, sources = {}, []
        if id in references:
            t = text(id)
            m = re.search(r"Input token limit\s+([\d,]+)\s+Output token limit\s+([\d,]+)", t)
            if m:
                specs["contextWindow"] = f"{m[1]} input tokens · max output {m[2]}"
                sources.append(id)
        label = google_map.get(id, e["name"]["en"])
        table = next(
            (
                t
                for t in tables
                if t["model"].startswith(label)
                and (t["heading"] == "Standard" or t["heading"] == t["model"])
            ),
            None,
        )
        if table:
            details = []
            for r in table["rows"]:
                if len(r) < 3 or not (
                    "input price" in r[0].lower() or "output price" in r[0].lower()
                ):
                    continue
                value = r[-1]
                if "$" not in value:
                    continue
                details.append(f"{r[0]}: {value}")
                short = value.split("Equivalent")[0].split(", equivalent")[0]
                if "through December 31, 2026" in short:
                    short = (
                        short.split("through December 31, 2026")[0].strip()
                        + " · through 2026-12-31"
                    )
                short = re.sub(r" or \$[\d.]+/min\*?", "", short)
                short = re.sub(r"(?<=[\w)])\$", "; $", short)
                unit = " / image" if "per image" in short else " / 1M tokens"
                short = short.replace("per image*", "").strip() + unit
                field = "inputPrice" if "input price" in r[0].lower() else "outputPrice"
                if field not in specs:
                    specs[field] = short
            if details:
                sources.append("gemini-pricing")
                note = (
                    "Gemini Developer API Standard paid tier; includes thinking tokens. "
                    + " | ".join(details)
                )
            else:
                note = "Official Gemini model token limits."
        else:
            note = "Official Gemini model token limits; no successor price substituted."
        if specs:
            add(id, specs, sources, note)
    add(
        "e-gemini-31-flash-live",
        {},
        ["gemini-changelog"],
        "Changelog announces this preview on March 26, 2026, but the existing official lifecycle date conflicts. Keep first release unresolved until reconciled.",
    )

    # Alibaba Cloud Beijing prices and exact dated snapshots.
    qwen = {
        "e-qwen-25-max": ("32K", "2.4", "9.6", "qwen-max; flat base price"),
        "e-qwen-3-max": (
            "256K",
            "6–15",
            "24–60",
            "qwen3-max-2025-09-23: <=32K 6/24; (32K,128K] 10/40; (128K,256K] 15/60",
        ),
        "e-qwen-37-max": ("1M", "12", "36", "qwen3.7-max; flat base price"),
        "e-qwen-36-max-preview": ("256K", "9–15", "54–90", "<=128K 9/54; (128K,256K] 15/90"),
        "e-qwen-3-plus": (
            None,
            ".8",
            "2 (non-thinking); ¥8 (thinking)",
            "qwen-plus-2025-04-28; output mode has separate prices",
        ),
        "e-qwen-35-plus": (
            "1M",
            ".8–4",
            "4.8–24",
            "<=128K .8/4.8; (128K,256K] 2/12; (256K,1M] 4/24",
        ),
        "e-qwen-36-plus": ("1M", "2–8", "12–48", "<=256K 2/12; (256K,1M] 8/48"),
        "e-qwen-3-flash": (
            "1M",
            ".15–1.2",
            "1.5–12",
            "qwen-flash-2025-07-28: <=128K .15/1.5; (128K,256K] .6/6; (256K,1M] 1.2/12",
        ),
        "e-qwen-35-flash": (
            "1M · max output 65,536",
            ".2–1.2",
            "2–12",
            "qwen3.5-flash-2026-02-23: <=128K .2/2; (128K,256K] .8/8; (256K,1M] 1.2/12",
        ),
        "e-qwen-35-397b": (
            "256K",
            "1.2–3",
            "7.2–18",
            "qwen3.5-397b-a17b hosted API: <=128K 1.2/7.2; (128K,256K] 3/18",
        ),
        "e-qwen-3-235b": (
            None,
            "2",
            "8 (non-thinking); ¥20 (thinking)",
            "qwen3-235b-a22b hosted API; native open-weight context is different from hosted context",
        ),
        "e-qwen-3-next": (
            None,
            "1",
            "4 (instruct); ¥10 (thinking)",
            "qwen3-next-80b-a3b hosted variants; native open-weight context is different from hosted context",
        ),
        "e-qwen-3-coder-next": (
            "262,144 native tokens",
            "1–2.5",
            "4–10",
            "qwen3-coder-next: <=32K 1/4; (32K,128K] 1.5/6; (128K,256K] 2.5/10",
        ),
        "e-qwen-38-omni-flash": (
            "1M · max output 131,072",
            ".8",
            "2.7",
            "qwen3.8-omni-flash China mainland; uncached input (cache hit .1)",
        ),
    }
    for id, (context, input, output, basis) in qwen.items():
        tier = " · tiered" if "–" in input else ""
        sources = ["qwen-pricing", "qwen-models"]
        if id == "e-qwen-35-flash":
            sources.append("qwen-flash")
        if id == "e-qwen-38-omni-flash":
            sources.append("qwen38omni")
        add(
            id,
            {
                "contextWindow": f"{context} tokens" if context else None,
                "inputPrice": f"¥{input} / 1M tokens · Beijing{tier}",
                "outputPrice": f"¥{output} / 1M tokens · Beijing{tier}",
            },
            sources,
            "Beijing standard online uncached API; excludes cache and Batch discounts. Input/output CNY per million: "
            + basis,
        )
        availability = e_availability = entities[id].get("specs", {}).get("availability")
        if not availability or "未核实" in e_availability:
            patches[id]["specs"]["availability"] = "Alibaba Cloud hosted API · Beijing"
    add(
        "e-qwen-3-plus",
        {"contextWindow": "131,072 total tokens · max input 98,304 · max output 16,384"},
        ["qwen-plus-model"],
        "Exact qwen-plus-2025-04-28 snapshot table, not the newer qwen-plus alias with 1M context.",
    )
    open_qwen = {
        "e-qwen-25-72b": ("qwen25", "32,768 native · 131,072 with YaRN"),
        "e-qwen-3-235b": ("qwen3", "32,768 native · 131,072 with YaRN"),
        "e-qwen-3-next": ("qwen-next", "262,144 native · up to 1,010,000 extended"),
        "e-qwen-36-27b": ("qwen36", "262,144 native · up to 1,010,000 extended"),
        "e-qwen-25-coder-32b": ("qwen-coder25", "32,768 native · 131,072 with YaRN"),
        "e-qwen-3-coder-next": ("qwen-coder-next", "262,144 native"),
        "e-qwen-25-omni": ("qwen-omni25", "32,768"),
        "e-qwen-3-omni": ("qwen-omni3", "32,768"),
    }
    for id, (source, context) in open_qwen.items():
        price = "Self-hosted weights · infrastructure cost; no uniform API tariff"
        specs = {"contextWindow": context + " tokens"}
        if id not in qwen:
            specs.update(inputPrice=price, outputPrice=price)
        add(
            id,
            specs,
            [source],
            "Native open-weight limits. Self-hosting charges depend on deployment resources; this does not mean hosted API calls are free.",
        )
    releases = text("qwen-releases")
    for id, api in {
        "e-qwen-38-flash": "qwen3.8-flash",
        "e-qwen-38-27b": "qwen3.8-27b",
        "e-qwen-38-24t": "qwen3.8-2.4t-a95b",
        "e-qwen-38-omni-flash": "qwen3.8-omni-flash",
    }.items():
        match = re.search(r"(2026-\d{2}-\d{2})\s*\|\s*" + re.escape(api) + r"\s*\|", releases)
        if match:
            add(
                id,
                {},
                ["qwen-releases"],
                "Alibaba Cloud official model launch listing (platform availability date).",
                match[1],
            )

    # Kimi current official prices include cache-hit/miss, never mix the two.
    kimi = text("kimi-pricing-md")
    for id in ("e-kimi-k26", "e-kimi-k27-code", "e-kimi-k27-code-highspeed"):
        api = entities[id]["release"]["apiModelIds"][0]
        row = re.search(
            r'\["'
            + re.escape(api)
            + r'", "1M tokens", "([^\"]+)", "([^\"]+)", "([^\"]+)", "([^\"]+)"\]',
            kimi,
        )
        if row:
            add(
                id,
                {
                    "contextWindow": row[4],
                    "inputPrice": row[2] + " / 1M tokens · cache miss",
                    "outputPrice": row[3] + " / 1M tokens",
                },
                ["kimi-pricing-md"],
                f"Official Kimi API; uncached input {row[2]}, cached input {row[1]}, output {row[3]} per million tokens.",
            )
    for id, source in {
        "e-kimi-k25": "kimi-k25-card",
        "e-kimi-k2": "kimi-k2-card",
        "e-kimi-k2-thinking": "kimi-k2-thinking-card",
        "e-kimi-k2-0905": "kimi-k2-0905-card",
    }.items():
        t = text(source)
        match = re.search(r"\*\*Context Length\*\*\s*\|\s*([^\n|]+)", t)
        if match and re.search(r"128|256|262", match[1]):
            add(
                id,
                {"contextWindow": match[1].strip(" *")},
                [source],
                "Official open-weight model card context limit; model platform confirms the historical API is retired.",
            )
        add(
            id,
            {
                "inputPrice": "Retired official API · no current tariff",
                "outputPrice": "Retired official API · no current tariff",
            },
            ["kimi-models-md", source],
            "Official Kimi model list marks this API as shut down. Historical tariffs are not replaced with K2.6/K3 prices; open weights can still be self-hosted.",
        )

    # Doubao: regular online inference, not the low-latency or Batch table.
    doubao = {
        "e-doubao-seed21-turbo": ("256K", "3", "15", "flat price"),
        "e-doubao-seed20-pro": (
            "256K",
            "3.2–9.6",
            "16–48",
            "<=32K 3.2/16; (32K,128K] 4.8/24; (128K,256K] 9.6/48",
        ),
        "e-doubao-seed20-code": (
            "256K",
            "3.2–9.6",
            "16–48",
            "<=32K 3.2/16; (32K,128K] 4.8/24; (128K,256K] 9.6/48",
        ),
        "e-doubao-seed20-mini": (
            "256K",
            ".2–.8 text/image/video; ¥3–12 audio",
            "2–8",
            "input-length tiers <=32K/(32K,128K]/(128K,256K]; uncached non-audio .2/.4/.8, audio 3/6/12; output 2/4/8",
        ),
        "e-doubao-seed20-lite": (
            "256K",
            ".6–1.8 text/image/video; ¥9–27 audio",
            "3.6–10.8",
            "input-length tiers <=32K/(32K,128K]/(128K,256K]; uncached non-audio .6/.9/1.8, audio 9/13.5/27; output 3.6/5.4/10.8",
        ),
        "e-doubao-seed20-lite-0428": (
            "256K",
            ".6–1.8 text/image/video; ¥9–27 audio",
            "3.6–10.8",
            "same listed Seed 2.0 Lite family tariff; exact API snapshot 260428",
        ),
    }
    for id, (context, input, output, basis) in doubao.items():
        add(
            id,
            {
                "contextWindow": context + " tokens",
                "inputPrice": f"¥{input} / 1M tokens · regular",
                "outputPrice": f"¥{output} / 1M tokens · regular",
            },
            ["doubao-pricing-old", "doubao-models"],
            "Volcengine regular online inference, CNY per million tokens; not low-latency, low-priority or Batch. "
            + basis,
        )
    for id in ("e-doubao-seed18", "e-doubao-seed16"):
        add(
            id,
            {
                "contextWindow": "256K tokens",
                "inputPrice": "¥0.8–2.4 / 1M tokens · Beijing Flink",
                "outputPrice": "¥2–24 / 1M tokens · Beijing Flink",
            },
            ["doubao18-pricing-text"],
            "Official Flink managed integration tariff, not assumed identical to all Ark endpoints. Input <=32K: .8; output <=.2K: 2, otherwise 8. Input (32K,128K]: 1.2/16; (128K,256K]: 2.4/24 CNY per million. Source lists these supported request lengths.",
        )

    for id in ("e-ernie-45", "e-ernie-45-03b", "e-ernie-45-21b-a3b", "e-ernie-45-vl-28b-a3b"):
        add(
            id,
            {
                "contextWindow": "128K tokens",
                "inputPrice": "Self-hosted weights · infrastructure cost; no uniform API tariff",
                "outputPrice": "Self-hosted weights · infrastructure cost; no uniform API tariff",
            },
            ["ernie-45-open"],
            "Official ERNIE open-weight repository: 128K context. Self-hosting is distinct from Qianfan managed API tariffs.",
        )

    # Qianfan API docs explicitly define units as CNY / 1K; normalize to 1M.
    # These are documented response examples (2026-05-29), not an authenticated live quote.
    examples = {
        e["id"]: e for e in json.loads((REF / "ernie-api-example.json").read_text(encoding="utf-8"))
    }
    for id, model in {
        "e-ernie-51": "ernie-5.1",
        "e-ernie-x11-generation": "ernie-x1.1",
        "e-ernie-x1-turbo": "ernie-x1-turbo-32k",
        "e-ernie-45-turbo-launch": "ernie-4.5-turbo-128k",
    }.items():
        row = examples[model]

        def price(value):
            if isinstance(value, list):
                return "–".join(f"{float(p['price']) * 1000:g}" for p in value)
            return f"{float(value) * 1000:g}"

        add(
            id,
            {
                "contextWindow": f"{row['context_length']:,} total tokens · max input {row['prompt_tokens']:,} · max output {row['max_tokens']:,}",
                "inputPrice": f"¥{price(row['pricing']['prompt'])} / 1M tokens · documented API",
                "outputPrice": f"¥{price(row['pricing']['completion'])} / 1M tokens · documented API",
                "availability": "Qianfan API · official model-list example 2026-05-29",
            },
            ["ernie-api-models"],
            "Qianfan GET /v2/models documentation response example, updated 2026-05-29. context_length includes input, output and reasoning; prompt_tokens is the separate input cap. Prices normalized from CNY/1K to CNY/1M; tier boundaries <=32K and >32K where arrays are present. Not a live authenticated quote.",
        )
        patches[id]["apiModelIds"] = [model]

    # Explicit DeepSeek historical prices survive in the original launch notices.
    for id, source, input, output in [
        ("e-deepseek-v3", "deepseek-news1226", 0.27, 1.1),
        ("e-deepseek-r1", "deepseek-news250120", 0.55, 2.19),
    ]:
        add(
            id,
            {
                "contextWindow": "128K native tokens",
                "inputPrice": f"${input:g} / 1M tokens · historical API",
                "outputPrice": f"${output:g} / 1M tokens · historical API",
            },
            [source, "deepseek-v3-card" if id.endswith("v3") else "deepseek-r1-card"],
            "Historical official launch tariff, cache-miss input. Native open-weight context differs from the historical API input cap; do not use these prices for today's V4.1 alias.",
        )
    deepseek_context = {
        "e-deepseek-v2-0517": ("deepseek-v2-card", "128K native tokens"),
        "e-deepseek-v31": ("deepseek-v31-card", "128K native tokens"),
        "e-deepseek-v32-exp": ("qwen-models", "128K tokens · Alibaba Cloud hosted API"),
    }
    for id, (source, context) in deepseek_context.items():
        add(
            id,
            {
                "contextWindow": context,
                "inputPrice": "Self-hosted weights · infrastructure cost; legacy API tariff not retained",
                "outputPrice": "Self-hosted weights · infrastructure cost; legacy API tariff not retained",
            },
            [source, "deepseek-news260424"],
            "Official model card or explicitly labeled hosted API limit. Today's deepseek-chat/reasoner prices cannot be assigned to these earlier snapshots. Historical tariff absent from current official pricing table.",
        )
    for id, source in {
        "e-deepseek-v25": "deepseek-v25-config",
        "e-deepseek-v25-1210": "deepseek-v25-1210-config",
        "e-deepseek-v3-0324": "deepseek-v3-0324-config",
        "e-deepseek-v32": "deepseek-v32-config",
        "e-deepseek-v32-speciale": "deepseek-speciale-config",
        "e-deepseek-r1-0528": "deepseek-r1-0528-config",
        "e-deepseek-v31-terminus": "deepseek-terminus-config",
    }.items():
        limit = json.loads(text(source))["max_position_embeddings"]
        add(
            id,
            {
                "contextWindow": f"{limit:,} tokens · open-weight configuration cap",
                "inputPrice": "Self-hosted weights · infrastructure cost; legacy API tariff not retained",
                "outputPrice": "Self-hosted weights · infrastructure cost; legacy API tariff not retained",
            },
            [source, "deepseek-news260424"],
            "Exact official checkpoint config max_position_embeddings, not a hosted API input limit. Legacy API tariff is not retained by current pricing; self-hosting incurs infrastructure costs.",
        )
    for id in (
        "e-deepseek-v4-flash",
        "e-deepseek-v4-flash-preview",
        "e-deepseek-v4-flash-vision-exp",
    ):
        add(
            id,
            {
                "contextWindow": "1M tokens",
                "inputPrice": "Retired original API · alias routes to V4.1 Flash",
                "outputPrice": "Retired original API · alias routes to V4.1 Flash",
            },
            ["deepseek-news260424", "deepseek-news260910", "deepseek-pricing"],
            "Original V4 Flash and Vision Exp retired Sept 10, 2026. Legacy names route to V4.1 Flash; current routing costs are not the original model's historical tariff.",
        )
    add(
        "e-deepseek-v4-pro-preview",
        {
            "contextWindow": "1M tokens",
            "inputPrice": "¥9 / 1M tokens · Volcengine regular",
            "outputPrice": "¥27 / 1M tokens · Volcengine regular",
        },
        ["deepseek-news260424", "doubao-pricing-old"],
        "Exact V4 Pro preview listing in Volcengine regular online inference table; separate from DeepSeek's current V4 Pro 0813 direct API tariff.",
    )

    add(
        "e-gemini-embedding-2",
        {
            "inputPrice": "$0.20 text; $0.45 image; $6.50 audio; $12 video / 1M tokens",
            "outputPrice": "Embedding vectors · no generated-token output tariff",
        },
        ["gemini-pricing", "gemini-embedding"],
        "Embedding 2 Standard paid tier separates text, image, audio and video input. No text generation output billing.",
    )
    add(
        "e-gemini-embedding-001",
        {
            "inputPrice": "$0.15 / 1M tokens · historical API",
            "outputPrice": "Embedding vectors · no generated-token output tariff",
        },
        ["gemini-embedding-launch"],
        "Google Developers launch article explicitly prices gemini-embedding-001 at $0.15 per million input tokens; current pricing table no longer lists this entry. Historical published tariff, distinct from Embedding 2.",
    )
    for id in ("e-gemini-deep-research", "e-gemini-deep-research-max"):
        add(
            id,
            {
                "contextWindow": "Managed research agent · underlying model context",
                "inputPrice": "Underlying model input + intermediate agent-loop tokens",
                "outputPrice": "Underlying model output + tool usage fees",
            },
            ["gemini-pricing", "gemini-agents"],
            "Official agent pricing: underlying model Standard list rates, including intermediate input/reasoning tokens and tool fees. The agent itself has no universal flat context/price.",
        )
    add(
        "e-gemini-31-flash-tts",
        {},
        ["gemini-changelog"],
        "Changelog announces this preview on April 15, 2026, but the existing official lifecycle date conflicts. Keep first release unresolved until reconciled.",
    )
    add(
        "e-gemini-35-transcribe",
        {
            "contextWindow": "Audio limit 1 hour per request · 30 minutes with diarization or timestamps"
        },
        ["e-gemini-35-transcribe"],
        "Official unary audio duration cap; the provider defines an audio-duration limit rather than a chat token context. Live endpoint has a separate 10-minute session limit.",
    )

    add(
        "e-ernie-x1",
        {
            "inputPrice": "¥2 / 1M tokens · historical API",
            "outputPrice": "¥8 / 1M tokens · historical API",
        },
        ["ernie-x1-price"],
        "Baidu Cloud Developer Center official answer 2025-03-21: 0.002/0.008 CNY per thousand tokens, normalized to per million. Historical tariff, not a live current quote.",
    )
    add(
        "e-ernie-40-turbo",
        {
            "inputPrice": "From ¥30 / 1M tokens · historical API",
            "outputPrice": "From ¥60 / 1M tokens · historical API",
        },
        ["ernie40-turbo-news"],
        "Official WAIC 2024 announcement quotes input/output prices starting at 0.03/0.06 CNY per thousand tokens. Normalized to millions; historical starting rates, not a current fixed tariff.",
    )

    add(
        "e-kimi-k27-code",
        {},
        ["kimi-code-releases"],
        "Official Kimi Code model release entry dated June 12, 2026; HighSpeed was still coming soon in that announcement.",
        released="2026-06-12",
    )
    patches["e-kimi-k27-code"]["releaseSourceNames"] = ["kimi-code-releases"]
    add(
        "e-grok-4-7-fast",
        {},
        ["grok47-release"],
        "Official September 21, 2026 Grok 4.7 announcement explicitly includes the fast variant as available at twice the speed and price.",
        released="2026-09-21",
    )
    patches["e-grok-4-7-fast"]["releaseSourceNames"] = ["grok47-release"]

    for id, patch in patches.items():
        if entities[id].get("familyId") == "e-claude" and not (entities[id].get("specs") or {}).get(
            "availability"
        ):
            patch["specs"]["availability"] = (
                "Retired Claude API · historical reference"
                if entities[id].get("release", {}).get("stage") == "retired"
                else "Claude API"
            )

    entries = [p for p in patches.values() if p["specs"] or p.get("releasedAt")]
    for p in entries:
        p["sources"] = [
            {"name": n, **v, "excerpt": source_excerpt(n)} for n, v in p["sources"].items()
        ]
    unresolved = []
    by_id = {p["entityId"]: p for p in entries}
    for id, e in entities.items():
        if e.get("type") != "model" or not e.get("familyId"):
            continue
        specs = {**(e.get("specs") or {}), **by_id.get(id, {}).get("specs", {})}
        missing = [k for k in ("contextWindow", "inputPrice", "outputPrice") if not specs.get(k)]
        if missing:
            stage = e.get("release", {}).get("stage")
            reason = (
                "Unreleased/unverified model; no confirmed API specifications"
                if stage == "pending"
                else "Historical endpoint removed from current official documents; exact historical tariff/limits not recovered"
                if stage == "retired"
                else "Exact API variant/channel requires additional official specification evidence"
            )
            unresolved.append({"entityId": id, "fields": missing, "reason": reason})
    result = {
        "verifiedAt": DATE,
        "policy": "Exact official model/channel only; historical and non-token billing explicitly labeled",
        "entries": entries,
        "unresolved": unresolved,
        "releaseConflicts": ["e-gemini-31-flash-live", "e-gemini-31-flash-tts"],
    }
    LEDGER.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(
        json.dumps(
            {
                "entries": len(entries),
                "fields": sum(len(p["specs"]) + bool(p.get("releasedAt")) for p in entries),
            }
        )
    )


def apply():
    ledger = json.loads(LEDGER.read_text(encoding="utf-8"))
    path = ROOT / "data/frontier_catalog_v1.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    all_entities = catalog()
    entities = {e["id"]: e for e in data["entities"]}
    evidence = {s["id"]: s for s in data["evidence"]}
    for patch in ledger["entries"]:
        id = patch["entityId"]
        e = entities[id] = copy.deepcopy(all_entities[id])
        e.setdefault("specs", {}).update(patch["specs"])
        if patch.get("releasedAt"):
            e.setdefault("release", {})["releasedAt"] = patch["releasedAt"]
            e["firstReleasedAt"] = patch["releasedAt"]
        if patch.get("apiModelIds"):
            e.setdefault("release", {})["apiModelIds"] = patch["apiModelIds"]
            channels = e["release"].setdefault("accessChannels", [])
            if not any(c.get("modelId") == patch["apiModelIds"][0] for c in channels):
                channels.append(
                    {
                        "type": "official-api",
                        "provider": "Baidu Qianfan",
                        "url": "https://cloud.baidu.com/doc/qianfan-api/s/Dmba8k71y",
                        "modelId": patch["apiModelIds"][0],
                    }
                )
            if id == "e-ernie-51":
                e["specs"]["modalities"] = "文本、图像输入；文本输出（千帆官方 API 示例）"
        e["lastUpdatedAt"] = DATE
        if e.get("release"):
            e["release"]["lastVerifiedAt"] = DATE
        source_ids = []
        for source in patch["sources"]:
            sid = "s-specs-" + source["name"]
            source_ids.append(sid)
            publisher = source_publisher(source["url"])
            label = all_entities.get(source["name"], {}).get(
                "name",
                {"zh": SOURCE_LABELS.get(source["name"], source["name"]), "en": source["name"]},
            )
            language = (
                "en"
                if source["name"].startswith(("e-gpt", "e-claude", "claude", "gemini"))
                or any(
                    host in source["url"]
                    for host in (
                        "huggingface.co",
                        "raw.githubusercontent.com",
                        "api-docs.deepseek.com",
                    )
                )
                else "zh"
            )
            evidence[sid] = {
                "id": sid,
                "title": {
                    "zh": label["zh"] + " · 官方规格与计费资料",
                    "en": label["en"] + " · official specifications and billing",
                },
                "url": source["url"],
                "publisher": publisher,
                "publishedAt": "",
                "collectedAt": DATE,
                "verifiedAt": DATE,
                "sourceExcerpt": source.get("excerpt") or source_excerpt(source["name"]),
                "originalLanguage": language,
                "type": "official",
            }
        description = "\n".join(patch["notes"]) + "\nVerified: " + DATE
        zh_description = billing_summary(patch)
        section = {
            "id": "official-model-specifications",
            "title": {
                "zh": "官方规格与计费依据",
                "en": "Official specifications and billing basis",
            },
            "summary": {"zh": zh_description, "en": description},
            "items": [
                {"zh": f"{SPEC_LABELS.get(k, k)}：{localize_spec(v)}", "en": f"{k}: {v}"}
                for k, v in patch["specs"].items()
            ],
            "sourceIds": source_ids,
        }
        knowledge = e.setdefault("knowledge", {})
        knowledge.setdefault("introduction", [e["summary"]])
        knowledge.setdefault(
            "significance",
            {
                "zh": "按具体型号核对上下文、可用渠道与成本，避免套用同系列其他型号的规格。",
                "en": "Check this exact release's limits, channels and costs rather than substituting another release's specifications.",
            },
        )
        knowledge.setdefault("useCases", [])
        knowledge.setdefault("limitations", [{"zh": zh_description, "en": description}])
        sections = knowledge.setdefault("sections", [])
        sections[:] = [s for s in sections if s["id"] != section["id"]] + [section]
        points = knowledge.setdefault("keyPoints", [])
        title = {"zh": "规格与计费口径", "en": "Specifications and billing basis"}
        points[:] = [p for p in points if p["title"] != title] + [
            {
                "title": title,
                "description": {"zh": zh_description, "en": description},
                "sourceIds": source_ids,
            }
        ]
        if patch.get("releasedAt"):
            events = data.setdefault("timeline", {}).setdefault(e["familyId"], [])
            release_sources = (
                ["s-specs-" + name for name in patch["releaseSourceNames"]]
                if patch.get("releaseSourceNames")
                else ["s-specs-qwen-releases"]
                if any(s["name"] == "qwen-releases" for s in patch["sources"])
                else source_ids
            )
            for event in events:
                if event["id"] == "t-spec-release-" + id:
                    event["sourceIds"] = release_sources
            if not any(
                event.get("releaseEntityId") == id and event.get("dateKind") == "release"
                for event in events
            ):
                events.append(
                    {
                        "id": "t-spec-release-" + id,
                        "date": patch["releasedAt"],
                        "kind": "release",
                        "dateKind": "release",
                        "releaseEntityId": id,
                        "title": {
                            "zh": e["name"]["zh"] + " 官方发布",
                            "en": e["name"]["en"] + " official release",
                        },
                        "summary": {
                            "zh": "按官方发布记录补充日期；不从型号名称推断。",
                            "en": "Date sourced from the official release record, not inferred from the model ID.",
                        },
                        "sourceIds": release_sources,
                        "confidence": "verified",
                    }
                )
    data["entities"] = list(entities.values())
    data["evidence"] = list(evidence.values())
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"entities": len(ledger["entries"]), "sources": len(evidence)}))


SPEC_LABELS = {
    "contextWindow": "上下文",
    "inputPrice": "输入价格",
    "outputPrice": "输出价格",
    "availability": "可用渠道",
}
SOURCE_LABELS = {
    "qwen-pricing": "百炼模型定价",
    "qwen-models": "百炼文本生成模型列表",
    "qwen-releases": "百炼模型上新记录",
    "qwen38omni": "Qwen3.8 Omni Flash 型号页",
    "qwen-flash": "Qwen3.5 Flash 型号页",
    "qwen-plus-model": "Qwen Plus 各快照规格",
    "claude-pricing": "Claude API 定价",
    "claude-context": "Claude 上下文窗口",
    "gemini-pricing": "Gemini Developer API 标准计费",
    "gemini-changelog": "Gemini API 发布记录",
    "gemini-embedding-launch": "Gemini Embedding 001 正式发布",
    "ernie-api-models": "千帆模型列表接口与计费单位",
    "ernie40-turbo-news": "ERNIE 4.0 Turbo 企业开放公告",
    "kimi-pricing-md": "Kimi API 计费",
    "kimi-models-md": "Kimi API 型号与生命周期",
    "doubao-pricing-old": "火山方舟常规推理计费",
    "doubao-models": "火山方舟模型规格",
    "doubao18-pricing-text": "Flink 托管模型计费",
    "kimi-code-releases": "Kimi Code 官方版本发布记录",
    "grok47-release": "Grok 4.7 官方发布公告",
}


def source_publisher(url):
    host = urlparse(url).hostname or ""
    for domain, publisher in {
        "openai.com": "OpenAI",
        "claude.com": "Anthropic",
        "anthropic.com": "Anthropic",
        "google.dev": "Google",
        "developers.googleblog.com": "Google",
        "aliyun.com": "Alibaba Cloud",
        "kimi.com": "Moonshot AI",
        "volcengine.com": "Volcengine",
        "baidu.com": "Baidu",
        "deepseek.com": "DeepSeek",
        "x.ai": "SpaceXAI",
    }.items():
        if host == domain or host.endswith("." + domain):
            return publisher
    if "/deepseek-ai/" in url:
        return "DeepSeek"
    if "/Qwen/" in url:
        return "Qwen"
    if "/moonshotai/" in url:
        return "Moonshot AI"
    if "/PaddlePaddle/" in url:
        return "PaddlePaddle"
    raise ValueError("Unrecognized official publisher: " + url)


def source_excerpt(name):
    body = text(name)
    if name == "kimi-code-releases":
        start = body.index("Kimi K2.7 Code June 12, 2026")
        return body[start : start + 1200].strip()
    if name == "grok47-release":
        return (
            "Sep 21, 2026\n"
            + body[
                body.index("Pricing and availability") : body.index("Pricing and availability")
                + 900
            ].strip()
        )
    match = re.search(
        r"context window|Context Length|Context window|Input token limit|模型价格|输入价格|max_position_embeddings|Pricing|价格",
        body,
    )
    start = max(0, match.start() - 80) if match else 0
    return body[start : start + 1200].strip()


def localize_spec(value):
    replacements = json.loads(
        (ROOT.parent / "src/data/model-spec-labels.json").read_text(encoding="utf-8")
    )
    for original, translation in replacements.items():
        value = re.sub(
            r"(?<![A-Za-z])" + re.escape(original) + r"(?![A-Za-z])",
            lambda _, text=translation: text,
            value,
        )
    return value


def billing_summary(patch):
    values = " ".join(patch["specs"].values())
    parts = ["按具体型号和调用渠道核对；价格为 2026-10-05 记录的官方资料快照。"]
    if "historical" in values:
        parts.append("标注历史的报价来自旧版资料，不能当作当前报价。")
    if "Self-hosted" in values:
        parts.append("开放权重自部署按算力等资源计费，不代表免费 API。")
    if "Beijing" in values:
        parts.append("人民币报价对应北京地区；价格区间按输入长度或模式分档。")
    if "Flink" in values:
        parts.append("该项报价来自 Flink 托管集成，不能套用到所有方舟端点。")
    if "documented API" in values:
        parts.append(
            "千帆数据来自 2026-05-29 官方接口示例，已从千 token 归一到百万 token；非登录后实时报价。"
        )
    if "Retired" in values:
        parts.append("原 API 已下线；不以新型号价格填充旧型号。")
    if any("Standard" in n for n in patch["notes"]):
        parts.append(
            "使用标准付费层价格，排除 Batch 和缓存折扣；模态、上下文长度及工具费用按官方条件区分。"
        )
    return "".join(parts)


if __name__ == "__main__":
    import sys

    {"--build": build, "--apply": apply}[sys.argv[1]]()
