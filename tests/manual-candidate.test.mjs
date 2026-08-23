import assert from "node:assert/strict";
import test from "node:test";

import { createServer } from "vite";

const vite = await createServer({
  server: { middlewareMode: true },
  appType: "custom",
  optimizeDeps: { noDiscovery: true },
});
const { buildManualCandidate, suggestedEntityId } = await vite.ssrLoadModule(
  "/src/domain/manual-candidate.ts",
);

test.after(async () => vite.close());

const source = {
  id: "s-mcp-architecture",
  title: "MCP 官方架构概览",
  publisher: "Model Context Protocol",
  url: "https://modelcontextprotocol.io/docs/2026-07-28/learn/architecture",
};

const snapshot = {
  id: "A53F097E-4E78-4FB8-8062-10D67B6E496B",
  sourceId: source.id,
  contentHash: "hash",
  contentPreview: "preview",
  readableCharacters: 1000,
  observedAt: "2026-08-12T11:00:00Z",
};

test("MCP 官方信源会建议关联到 MCP 实体", () => {
  assert.equal(suggestedEntityId(source.id), "e-mcp");
  assert.equal(suggestedEntityId("s-langchain-overview"), "e-langchain");
  assert.equal(suggestedEntityId("s-openai-about"), "e-openai");
  assert.equal(suggestedEntityId("s-unknown"), "");
});

test("人工候选使用快照生成稳定且可追溯的事实与证据", () => {
  const candidate = buildManualCandidate(
    source,
    snapshot,
    {
      entityId: " e-mcp ",
      claimZh: " MCP 采用客户端—服务器架构。 ",
      claimEn: " MCP uses a client-server architecture. ",
    },
    new Date("2026-08-12T12:00:00Z"),
  );

  assert.equal(candidate.entityId, "e-mcp");
  assert.equal(candidate.claim.text.zh, "MCP 采用客户端—服务器架构。");
  assert.equal(candidate.claim.sourceIds[0], candidate.evidence[0].id);
  assert.equal(candidate.evidence[0].url, source.url);
  assert.equal(candidate.evidence[0].verifiedAt, "2026-08-12");
  assert.ok(candidate.evidence[0].supportsClaimIds.includes(candidate.claim.id));
  assert.match(candidate.id, /^[a-z0-9][a-z0-9._-]+$/);
  assert.ok(candidate.id.length <= 128);
});

test("中英文事实缺失时拒绝创建人工候选", () => {
  assert.throws(
    () => buildManualCandidate(source, snapshot, { claimZh: "只有中文", claimEn: "" }),
    /同时填写中文事实和英文事实/,
  );
});
