import httpx
import pytest

from app.fetching import FetchPolicyError
from app.safe_dns import GoogleHttpsResolver, PinnedPublicBackend


@pytest.mark.parametrize(
    "addresses",
    [[], ["198.18.0.173"], ["127.0.0.1"], ["10.0.0.1"], ["8.8.8.8", "192.168.0.1"], ["224.0.0.1"]],
)
def test_invalid_dns_cannot_reach_socket(addresses):
    class Connector:
        def connect_tcp(self, *args, **kwargs):
            pytest.fail("Unsafe DNS must be rejected before connecting")

    backend = PinnedPublicBackend(("example.com",), lambda host: addresses, connector=Connector())
    with pytest.raises(FetchPolicyError):
        backend.connect_tcp("example.com", 443)


def test_connection_uses_dynamic_validated_ip_and_keeps_dns_host_separate():
    calls = []

    class Connector:
        def connect_tcp(self, host, port, **kwargs):
            calls.append((host, port))
            return object()

    backend = PinnedPublicBackend(("example.com",), lambda host: ["8.8.8.8"], connector=Connector())
    backend.connect_tcp("docs.example.com", 443)
    assert calls == [("8.8.8.8", 443)]
    with pytest.raises(FetchPolicyError):
        backend.connect_tcp("evil.test", 443)
    with pytest.raises(FetchPolicyError):
        backend.connect_tcp("example.com", 80)


def test_https_dns_responses_are_validated_and_short_ttl_cached():
    calls = []

    def handler(request):
        calls.append(str(request.url))
        return httpx.Response(
            200, json={"Status": 0, "Answer": [{"type": 1, "TTL": 600, "data": "8.8.8.8"}]}
        )

    resolver = GoogleHttpsResolver(transport=httpx.MockTransport(handler))
    assert resolver("example.com") == ("8.8.8.8",)
    assert resolver("example.com") == ("8.8.8.8",)
    assert len(calls) == 1
    assert resolver.observations["example.com"]["ttlSeconds"] == 60


def test_no_fallback_to_fake_system_dns_after_https_lookup_failure():
    resolver = GoogleHttpsResolver(
        transport=httpx.MockTransport(lambda request: httpx.Response(200, json={"Status": 2}))
    )
    with pytest.raises(FetchPolicyError):
        resolver("example.com")
