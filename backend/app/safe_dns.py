"""Optional HTTPS DNS and connections pinned to validated public addresses."""

import ipaddress
import ssl
import time
from threading import Lock

import certifi
import httpcore
import httpx

from .fetching import FetchPolicyError


def public_addresses(values):
    addresses = tuple(dict.fromkeys(values))
    if not addresses:
        raise FetchPolicyError("Source hostname did not resolve.")
    for value in addresses:
        try:
            address = ipaddress.ip_address(value)
        except ValueError as exc:
            raise FetchPolicyError("DNS returned an invalid address.") from exc
        if not address.is_global or address.is_multicast:
            raise FetchPolicyError("Source hostname resolves to a non-public address.")
    return addresses


class GoogleHttpsResolver:
    """TLS-verified public DNS, no system changes and no fixed source IPs."""

    def __init__(self, *, transport=None):
        self.transport = transport
        self.cache = {}
        self.observations = {}
        self.lock = Lock()

    def __call__(self, host):
        with self.lock:
            cached = self.cache.get(host)
            if cached and cached[0] > time.monotonic():
                return cached[1]
            with httpx.Client(
                timeout=10, trust_env=False, follow_redirects=False, transport=self.transport
            ) as client:
                response = client.get(
                    "https://dns.google/resolve", params={"name": host, "type": "A"}
                )
                response.raise_for_status()
            result = response.json()
            if result.get("Status") != 0 or result.get("TC"):
                raise FetchPolicyError("Public DNS lookup failed or was truncated.")
            answers = [row for row in result.get("Answer", []) if row.get("type") == 1]
            addresses = public_addresses(row["data"] for row in answers)
            ttl = min([60, *(max(0, int(row.get("TTL", 0))) for row in answers)])
            self.cache[host] = (time.monotonic() + ttl, addresses)
            self.observations[host] = {
                "addresses": list(addresses),
                "ttlSeconds": ttl,
                "resolver": "https://dns.google/resolve",
            }
            return addresses


class PinnedPublicBackend(httpcore.SyncBackend):
    def __init__(self, allowed_hosts, resolver, *, connector=None):
        self.allowed_hosts = tuple(host.casefold() for host in allowed_hosts)
        self.resolver = resolver
        self.connector = connector or httpcore.SyncBackend()

    def connect_tcp(self, host, port, timeout=None, local_address=None, socket_options=None):
        host = host.decode("ascii") if isinstance(host, bytes) else host
        host = host.casefold()
        if port != 443 or not any(
            host == value or host.endswith("." + value) for value in self.allowed_hosts
        ):
            raise FetchPolicyError("Connection target is outside the HTTPS allowlist.")
        # Revalidate at the connection boundary, even if a prior URL check passed.
        addresses = public_addresses(self.resolver(host))
        failure = None
        for address in addresses:
            try:
                return self.connector.connect_tcp(
                    address,
                    port,
                    timeout=timeout,
                    local_address=local_address,
                    socket_options=socket_options,
                )
            except (httpcore.ConnectError, httpcore.ConnectTimeout) as exc:
                failure = exc
        raise failure


class PinnedPublicTransport(httpx.HTTPTransport):
    def __init__(self, allowed_hosts, resolver):
        super().__init__(trust_env=False)
        self._pool.close()
        # HTTPX does not expose network_backend; keep its request/TLS handling,
        # replacing only the pool with HTTPcore's supported backend argument.
        # Request host, Host header and TLS server_hostname remain official host.
        self._pool = httpcore.ConnectionPool(
            ssl_context=ssl.create_default_context(cafile=certifi.where()),
            network_backend=PinnedPublicBackend(allowed_hosts, resolver),
        )
