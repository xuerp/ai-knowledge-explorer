"""Prepare review candidates from captured official decision sources.

This is an intake boundary, not publication or factual verification. Missing
publication dates remain missing; coding entry points never prove model API,
context capacity, price or measured task performance.
"""

import hashlib
import json
import re
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import urlsplit

from .decision_candidates import CATALOG
from .schemas import CandidateCreate, KnowledgeSnapshot

OFFICIAL_HOSTS = {
    "developers.openai.com",
    "learn.chatgpt.com",
    "openai.com",
    "code.claude.com",
    "www.anthropic.com",
    "geminicli.com",
    "docs.devin.ai",
    "x.ai",
    "docs.x.ai",
    "www.trae.ai",
    "docs.trae.ai",
    "ai.google.dev",
    "docs.langchain.com",
}
ENTRIES = {"terminal", "ide", "desktop", "web", "cloud-task"}
DOCUMENTED_PRODUCTS = {
    "ai.google.dev": {"e-gemini-3-1-pro"},
    "docs.langchain.com": {"e-langgraph"},
}


def prepare_decision_intake(
    root: Path, snapshot: KnowledgeSnapshot, captures: list[dict], drafts: list[dict]
) -> list[CandidateCreate]:
    """Validate the whole batch before any existing candidate API writes."""
    root = root.resolve()
    sources = {row["key"]: row for row in captures}
    if len(sources) != len(captures):
        raise ValueError("Duplicate source keys")
    entities = {entity.id: entity for entity in snapshot.entities}
    result = []
    seen = set()
    for draft in drafts:
        source = sources[draft["sourceKey"]]
        if source["status"] != "succeeded":
            raise ValueError("A failed capture cannot support a candidate")
        url = source.get("finalUrl") or source["url"]
        parsed = urlsplit(url)
        if parsed.scheme != "https" or parsed.hostname not in OFFICIAL_HOSTS or parsed.username:
            raise ValueError("Use a captured official HTTPS source")
        path = (root / source["contentPath"]).resolve()
        if not path.is_relative_to(root / "artifacts/decision-source-refresh"):
            raise ValueError("Capture path is outside the source refresh directory")
        body = path.read_text(encoding="utf-8")
        if hashlib.sha256(body.encode()).hexdigest() != source["contentSha256"]:
            raise ValueError("Captured content hash changed")
        excerpt = draft["sourceExcerpt"].strip()
        if not excerpt or excerpt not in body:
            raise ValueError("The support excerpt must occur verbatim in the captured source")
        entity = entities.get(draft["entityId"])
        if (
            not entity
            or entity.type not in {"application", "tool", "agent", "framework", "model"}
            or (entity.type == "model" and not entity.family_id)
        ):
            raise ValueError(
                "Resolve a concrete coding product, model or framework before submission"
            )
        if (
            parsed.hostname in DOCUMENTED_PRODUCTS
            and entity.id not in DOCUMENTED_PRODUCTS[parsed.hostname]
            and not documented_model(entity, parsed.hostname, parsed.path, body)
        ):
            # A concrete model page can establish its own scope without growing
            # an entity allowlist for every newly catalogued version. Require
            # its API alias in the URL and body; a family/platform guide fails.
            raise ValueError("The official source must document this specific product")
        if (
            entity.type == "model"
            and parsed.hostname == "developers.openai.com"
            and not documented_model(entity, parsed.hostname, parsed.path, body)
        ):
            raise ValueError("The official source must document this specific product")
        predicate, value = draft["predicate"], draft["value"]
        if predicate == "workflow-feature":
            if value not in CATALOG["features"]:
                raise ValueError("Unknown workflow feature")
        elif predicate == "product-entry":
            if entity.type not in {"application", "tool", "agent"}:
                raise ValueError(
                    "Coding entry points cannot establish model or framework deployment"
                )
            entries = json.loads(value)
            if (
                not isinstance(entries, list)
                or not entries
                or any(x not in ENTRIES for x in entries)
            ):
                raise ValueError("Invalid product entry points")
        elif predicate == "workflow-qualification":
            if value not in {"account-tier", "product-scope", "permissions", "model-configuration"}:
                raise ValueError("Unknown workflow qualification")
        elif predicate == "input_modality":
            if (
                entity.type != "model"
                or (
                    entity.id not in DOCUMENTED_PRODUCTS.get(parsed.hostname, set())
                    and not documented_model(entity, parsed.hostname, parsed.path, body)
                )
                or value not in {"text", "image", "audio", "video"}
            ):
                raise ValueError("Input modalities require a specific documented model")
        else:
            raise ValueError(
                "Product workflow intake cannot assert model specs, pricing or quality"
            )
        published = source.get("publicationDate")
        if published:
            date_excerpt = source.get("publicationDateExcerpt", "")
            if not date_excerpt or date_excerpt not in body:
                raise ValueError("A publication date needs its own source excerpt")
            # Source dates must match the cited date, not a collection timestamp.
            formats = ("%b %d, %Y", "%B %d, %Y", "%Y-%m-%d")
            matches = []
            for date_format in formats:
                try:
                    matches.append(
                        datetime.strptime(date_excerpt, date_format)
                        .replace(tzinfo=UTC)
                        .date()
                        .isoformat()
                    )
                except ValueError:
                    continue
            if published not in matches or published > source["observedAt"][:10]:
                raise ValueError("Publication date is unsupported or in the future")
        identity = "\n".join((draft["entityId"], predicate, value, source["contentSha256"]))
        key = "decision-refresh-" + hashlib.sha256(identity.encode()).hexdigest()[:20]
        if key in seen:
            raise ValueError("Duplicate fact in the intake batch")
        seen.add(key)
        # Different facts from one page can cite different excerpts. A shared
        # page-only ID would let a later intake overwrite an earlier quotation.
        excerpt_identity = source["contentSha256"] + "\n" + excerpt
        evidence_id = "source-" + hashlib.sha256(excerpt_identity.encode()).hexdigest()[:20]
        result.append(
            CandidateCreate.model_validate(
                {
                    "id": key,
                    "entityId": entity.id,
                    "claim": {
                        "id": "claim-" + key,
                        "entityId": entity.id,
                        "subject": entity.name.en,
                        "predicate": predicate,
                        "objectOrValue": value,
                        "text": {"zh": draft["zh"], "en": draft["en"]},
                        "confidence": "unverified",
                        "sourceIds": [evidence_id],
                        "updatedAt": source["observedAt"],
                        "observedAt": source["observedAt"],
                        "validFrom": published,
                    },
                    "evidence": [
                        {
                            "id": evidence_id,
                            "title": {"zh": draft["sourceTitle"], "en": draft["sourceTitle"]},
                            "url": url,
                            "publisher": draft["publisher"],
                            "type": "official",
                            "publishedAt": published or "",
                            "collectedAt": source["observedAt"],
                            "sourceExcerpt": excerpt,
                            "originalLanguage": "en",
                        }
                    ],
                }
            )
        )
    return result


def documented_model(entity, host: str, path: str, body: str) -> bool:
    prefixes = {
        "ai.google.dev": "/gemini-api/docs/models/",
        "developers.openai.com": "/api/docs/models/",
    }
    prefix = prefixes.get(host)
    if not prefix or entity.type != "model" or not entity.family_id:
        return False
    model_id = path.removeprefix(prefix).removesuffix(".md").strip("/")
    if not path.startswith(prefix) or "/" in model_id:
        return False
    aliases = [entity.slug, *entity.aliases]
    if model_id not in aliases or not re.fullmatch(r"[a-z0-9][a-z0-9._-]+", model_id):
        return False
    return bool(re.search(r"(?<![\w.-])" + re.escape(model_id) + r"(?![\w.-])", body))
