from __future__ import annotations

import ipaddress
import socket
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from html.parser import HTMLParser
from urllib.parse import urljoin, urlsplit

import httpx


class FetchPolicyError(ValueError):
    pass


PERMANENT_FETCH_FAILURE_KINDS = {"blocked", "redirect", "allowlist", "content"}


def classify_fetch_failure(error: Exception) -> str:
    if isinstance(error, httpx.TimeoutException):
        return "timeout"
    if isinstance(error, httpx.HTTPStatusError):
        status_code = error.response.status_code
        if status_code in {401, 403}:
            return "blocked"
        if status_code == 429:
            return "rate-limited"
        if status_code >= 500:
            return "upstream"
        return "content"
    if isinstance(error, httpx.NetworkError | OSError):
        return "network"
    if isinstance(error, FetchPolicyError):
        message = str(error).casefold()
        if "redirect" in message:
            return "redirect"
        if any(
            marker in message
            for marker in (
                "not in ai_radar_fetch_allowed_hosts",
                "non-public address",
                "only https",
                "plain hostname",
                "standard https port",
                "did not resolve",
            )
        ):
            return "allowlist"
        if any(
            marker in message for marker in ("content type", "exceeds", "too little readable text")
        ):
            return "content"
    return "unknown"


class _TextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.ignored_depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in {"script", "style", "noscript", "svg"}:
            self.ignored_depth += 1
        elif tag in {"p", "div", "article", "section", "li", "br", "h1", "h2", "h3"}:
            self.parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in {"script", "style", "noscript", "svg"} and self.ignored_depth:
            self.ignored_depth -= 1

    def handle_data(self, data: str) -> None:
        if not self.ignored_depth:
            self.parts.append(data)

    def text(self) -> str:
        lines = (" ".join(part.split()) for part in "".join(self.parts).splitlines())
        return "\n".join(line for line in lines if line)


@dataclass(frozen=True, slots=True)
class FetchedDocument:
    content: str
    content_type: str
    etag: str | None
    last_modified: str | None
    not_modified: bool = False
    final_url: str | None = None


def _default_resolver(host: str) -> Iterable[str]:
    return {address[4][0] for address in socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)}


class SafeHttpFetcher:
    allowed_hosts: tuple[str, ...]

    def __init__(
        self,
        allowed_hosts: tuple[str, ...],
        max_bytes: int,
        *,
        resolver: Callable[[str], Iterable[str]] = _default_resolver,
        transport: httpx.BaseTransport | None = None,
    ):
        self.allowed_hosts = tuple(host.casefold() for host in allowed_hosts)
        self.max_bytes = max_bytes
        self.resolver = resolver
        self.transport = transport

    def validate_url(self, url: str) -> None:
        parsed = urlsplit(url)
        host = (parsed.hostname or "").casefold()
        if parsed.scheme != "https":
            raise FetchPolicyError("Only HTTPS source URLs are allowed.")
        if not host or parsed.username or parsed.password:
            raise FetchPolicyError("Source URL must contain a plain hostname.")
        if parsed.port not in {None, 443}:
            raise FetchPolicyError("Only the standard HTTPS port is allowed.")
        if not self.allowed_hosts or not any(
            host == allowed or host.endswith(f".{allowed}") for allowed in self.allowed_hosts
        ):
            raise FetchPolicyError("Source hostname is not in AI_RADAR_FETCH_ALLOWED_HOSTS.")
        addresses = tuple(self.resolver(host))
        if not addresses:
            raise FetchPolicyError("Source hostname did not resolve.")
        for address in addresses:
            ip = ipaddress.ip_address(address)
            if (
                ip.is_private
                or ip.is_loopback
                or ip.is_link_local
                or ip.is_multicast
                or ip.is_reserved
                or ip.is_unspecified
            ):
                raise FetchPolicyError("Source hostname resolves to a non-public address.")

    def fetch(
        self,
        url: str,
        *,
        etag: str | None = None,
        last_modified: str | None = None,
    ) -> FetchedDocument:
        self.validate_url(url)
        headers = {
            "Accept": ("text/markdown,text/html,text/plain,application/json,application/xml;q=0.9"),
            "User-Agent": "AI-Radar-Collector/0.1 (+evidence-first; contact configured operator)",
        }
        if etag:
            headers["If-None-Match"] = etag
        if last_modified:
            headers["If-Modified-Since"] = last_modified
        current_url = url
        visited_urls = {url}
        with httpx.Client(
            transport=self.transport,
            timeout=httpx.Timeout(15.0, connect=5.0),
            follow_redirects=False,
        ) as client:
            for _ in range(4):
                with client.stream("GET", current_url, headers=headers) as response:
                    if 300 <= response.status_code < 400:
                        location = response.headers.get("location")
                        canonical_url = urljoin(current_url, location) if location else None
                        if not canonical_url:
                            raise FetchPolicyError("Redirect was returned without a canonical URL.")
                        self.validate_url(canonical_url)
                        if canonical_url in visited_urls:
                            raise FetchPolicyError("Source URL entered a redirect loop.")
                        visited_urls.add(canonical_url)
                        current_url = canonical_url
                        continue

                    if response.status_code == 304:
                        return FetchedDocument(
                            content="",
                            content_type="",
                            etag=response.headers.get("etag") or etag,
                            last_modified=response.headers.get("last-modified") or last_modified,
                            not_modified=True,
                            final_url=current_url,
                        )
                    response.raise_for_status()
                    content_type = response.headers.get("content-type", "").split(";", 1)[0].lower()
                    if content_type not in {
                        "text/markdown",
                        "text/html",
                        "text/plain",
                        "application/json",
                        "application/xml",
                        "text/xml",
                    }:
                        raise FetchPolicyError(
                            f"Unsupported content type: {content_type or 'unknown'}"
                        )
                    chunks: list[bytes] = []
                    size = 0
                    for chunk in response.iter_bytes():
                        size += len(chunk)
                        if size > self.max_bytes:
                            raise FetchPolicyError(
                                "Source document exceeds AI_RADAR_FETCH_MAX_BYTES."
                            )
                        chunks.append(chunk)
                    encoding = response.encoding or "utf-8"
                    raw = b"".join(chunks).decode(encoding, errors="replace")
                    if content_type == "text/html":
                        parser = _TextExtractor()
                        parser.feed(raw)
                        content = parser.text()
                    else:
                        content = raw.strip()
                    if len(content) < 20:
                        raise FetchPolicyError("Source document contains too little readable text.")
                    return FetchedDocument(
                        content=content,
                        content_type=content_type,
                        etag=response.headers.get("etag"),
                        last_modified=response.headers.get("last-modified"),
                        final_url=current_url,
                    )
            raise FetchPolicyError("Source URL exceeded the safe redirect limit.")
