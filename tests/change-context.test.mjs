import assert from "node:assert/strict";
import test from "node:test";

import { createServer } from "vite";

const vite = await createServer({
  server: { middlewareMode: true },
  appType: "custom",
  optimizeDeps: { noDiscovery: true },
});
const { changeContext } = await vite.ssrLoadModule("/src/domain/change-context.ts");

test.after(async () => vite.close());

const line = {
  id: "gpt-6",
  name: { zh: "GPT-6", en: "GPT-6" },
  positioning: { zh: "通用", en: "General" },
};
function model(id, generation, variant, releasedAt, extra = {}) {
  return {
    id,
    type: "model",
    slug: id,
    name: { zh: `${generation} ${variant}`, en: `${generation} ${variant}` },
    summary: { zh: "", en: "" },
    status: "active",
    tags: [],
    lastUpdatedAt: releasedAt,
    familyId: "e-gpt",
    release: {
      generation,
      variant,
      releaseId: id,
      apiModelIds: [id],
      stage: "stable",
      productLine: line,
      catalogCurrent: true,
      releasedAt,
      lastVerifiedAt: releasedAt,
      accessChannels: [{ type: "official-api", provider: "OpenAI", modelId: id }],
      ...extra,
    },
  };
}
const family = {
  id: "e-gpt",
  type: "model",
  slug: "gpt",
  name: { zh: "GPT", en: "GPT" },
  summary: { zh: "", en: "" },
  status: "active",
  tags: [],
  lastUpdatedAt: "2026-11-17",
};
const entities = [
  family,
  model("sol-62", "GPT-6.2", "Sol", "2026-11-17"),
  model("astra-62", "GPT-6.2", "Astra", "2026-11-17"),
  model("sol-61", "GPT-6.1", "Sol", "2026-09-29", { catalogCurrent: false }),
  model("sol-preview", "GPT-6.2", "Sol", "2026-10-01", { stage: "preview" }),
];
entities[4].name = { zh: "GPT-6.2 Sol Preview", en: "GPT-6.2 Sol Preview" };
const changes = [
  {
    id: "c-sol-62",
    entityId: "sol-62",
    date: "2026-11-17",
    kind: "new",
    summary: { zh: "", en: "" },
    confidence: "verified",
  },
  {
    id: "c-astra-62",
    entityId: "astra-62",
    date: "2026-11-17",
    kind: "new",
    summary: { zh: "", en: "" },
    confidence: "verified",
  },
  {
    id: "c-sol-61",
    entityId: "sol-61",
    date: "2026-09-29",
    kind: "new",
    summary: { zh: "", en: "" },
    confidence: "verified",
  },
  {
    id: "c-family",
    entityId: "e-gpt",
    date: "2026-10-23",
    kind: "deprecated",
    summary: { zh: "", en: "" },
    confidence: "verified",
  },
];

test("产品线只列当前在售的同系列型号", () => {
  const context = changeContext(changes[0], entities, changes);
  assert.equal(context.lineup.lineName.zh, "GPT-6");
  assert.deepEqual(
    context.lineup.siblings.map((item) => item.id),
    ["astra-62", "sol-preview"],
  );
});

test("上一代是更早一代的同名型号，不把同代的预览版当成上一代", () => {
  assert.equal(changeContext(changes[0], entities, changes).previous.id, "sol-61");
  assert.equal(changeContext(changes[1], entities, changes).previous, undefined);
});

test("怎么用上来自已审核的接入渠道", () => {
  assert.deepEqual(changeContext(changes[0], entities, changes).access, [
    { type: "official-api", provider: "OpenAI", modelId: "sol-62" },
  ]);
});

test("相关动态包含同模型和同家族，最新在前，不含当前这条", () => {
  const related = changeContext(changes[0], entities, changes).related.map((item) => item.id);
  assert.deepEqual(related, ["c-astra-62", "c-family", "c-sol-61"]);
});

test("找不到实体时不显示任何补充内容", () => {
  const missing = { ...changes[0], entityId: "e-missing" };
  assert.deepEqual(changeContext(missing, entities, changes), { access: [], related: [] });
});
