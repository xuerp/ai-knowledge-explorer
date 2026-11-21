"""Extract review leads from explicitly scoped official indexes."""

import re
from dataclasses import dataclass
from urllib.parse import urljoin, urlsplit, urlunsplit
from uuid import NAMESPACE_URL, uuid5

from sqlalchemy import func, select

from .database import EntryRequestRecord, KnowledgeEntityRecord, SourceRecord

OPENAI_RELEASE_ROOTS = ("s-openai-api-changelog", "s-openai-models")
OPENAI_RELEASE_SLUG = r"gpt-\d+(?:\.\d+)?-(?:astra|sol|terra|luna|pro)\Z"
MARKDOWN_LINK = re.compile(r"\[([^\]\r\n]{1,120})\]\(([^)\s]{1,512})\)")
DISCOVERY_ROOTS = {
    "s-google-model-card-index": ("deepmind.google", "/models/model-cards/", r"gemini-|gemma-"),
    "s-moonshot-research-index": ("www.kimi.ai", "/blog/", r"kimi-k"),
    **{
        source_id: ("developers.openai.com", "/api/docs/models/", OPENAI_RELEASE_SLUG)
        for source_id in OPENAI_RELEASE_ROOTS
    },
}


@dataclass(frozen=True)
class ReleaseDiscoveryResult:
    queued: int = 0
    deferred: bool = False


def discover_release_leads(session, source, document, current):
    policy = DISCOVERY_ROOTS.get(source.id)
    if policy is None or document.not_modified:
        return ReleaseDiscoveryResult()
    host, prefix, accepted_slug = policy
    openai_index = source.id in OPENAI_RELEASE_ROOTS
    links = document.links
    if openai_index and document.content_type == "text/markdown":
        links = tuple((url, label) for label, url in MARKDOWN_LINK.findall(document.content))
    candidates = {}
    for href, label in links:
        try:
            parsed = urlsplit(urljoin(document.final_url or source.url, href))
            slug = parsed.path.removeprefix(prefix).rstrip("/")
            if openai_index:
                slug = slug.removesuffix(".md")
            allowed_slug = (
                r"[a-z0-9]+(?:[.-][a-z0-9]+)*" if openai_index else r"[a-z0-9]+(?:-[a-z0-9]+)*"
            )
            if (
                parsed.scheme != "https"
                or parsed.hostname != host
                or parsed.username
                or parsed.password
                or parsed.port not in {443, None}
                or parsed.query
                or not parsed.path.startswith(prefix)
                or not re.fullmatch(allowed_slug, slug)
                or not re.match(accepted_slug, slug)
            ):
                continue
        except ValueError:
            continue
        url = urlunsplit(("https", host, prefix + slug + "/", "", ""))
        if openai_index or host == "www.kimi.ai":
            url = url.rstrip("/")
        display_name = label if label.lower() != "view model card" else slug.replace("-", " ")
        candidates[url] = (display_name[:120], slug)
    if not candidates:
        return ReleaseDiscoveryResult()
    pending = session.scalar(
        select(func.count())
        .select_from(EntryRequestRecord)
        .where(
            EntryRequestRecord.status.in_(("pending", "in-review")),
            EntryRequestRecord.reason.startswith("Official release discovery:"),
        )
    )
    limit = min(4, max(0, 50 - pending))
    count = 0
    for url, (label, slug) in candidates.items():
        key = str(uuid5(NAMESPACE_URL, url.rstrip("/")))
        if session.scalar(
            select(KnowledgeEntityRecord.id).where(KnowledgeEntityRecord.slug == slug).limit(1)
        ):
            continue
        if session.get(EntryRequestRecord, key) or session.scalar(
            select(SourceRecord.id).where(SourceRecord.url.in_([url, url.rstrip("/")])).limit(1)
        ):
            continue
        if count >= limit:
            return ReleaseDiscoveryResult(queued=count, deferred=True)
        session.add(
            EntryRequestRecord(
                id=key,
                name=label,
                entity_type="model",
                source_url=url,
                version=1,
                status="pending",
                created_at=current,
                reason=f"Official release discovery: {source.publisher}. Verify model and release scope.",
            )
        )
        count += 1
    return ReleaseDiscoveryResult(queued=count)
