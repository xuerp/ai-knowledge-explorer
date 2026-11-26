import assert from "node:assert/strict";
import test from "node:test";

import { createServer } from "vite";

const vite = await createServer({
  server: { middlewareMode: true },
  appType: "custom",
  optimizeDeps: { noDiscovery: true },
});
const { normalizedSpec, sameSpec, specBasis, specFieldFor } = await vite.ssrLoadModule(
  "/src/domain/spec-fields.ts",
);

test.after(async () => vite.close());

// Same cases as backend/tests/test_spec_verification.py; the two rule sets must agree.
test("写法不同但数值相同的规格不算变化", () => {
  for (const [field, fact, card] of [
    ["input_price", "$10 USD per MTok", "$10 / 1M tokens"],
    [
      "input_price",
      "USD 4 / 1M uncached text input tokens; promotion at least through 2026-11-21",
      "$4 / 1M tokens",
    ],
    [
      "context_window",
      "1M tokens on Tencent Cloud TokenHub",
      "1,048,576 shared input and output tokens",
    ],
    ["context_window", "128K", "131,072 tokens"],
  ]) {
    assert.ok(sameSpec(field, normalizedSpec(field, fact), normalizedSpec(field, card)), fact);
  }
});

test("整句话、模型 ID 和多个价格不参与比较", () => {
  assert.equal(normalizedSpec("released_at", "gpt-6.2-astra"), null);
  assert.equal(
    normalizedSpec(
      "context_window",
      "GLM-5.3 官方文档列出文本模态、1M 上下文和 128K 最大输出，思考不可关闭。",
    ),
    null,
  );
  assert.equal(normalizedSpec("input_price", "$2 input and $8 output"), null);
});

test("只有当前的规格谓词对应卡片字段", () => {
  assert.equal(specFieldFor("standard-input-price"), "input_price");
  assert.equal(specFieldFor("historical-input-price"), null);
  assert.equal(specFieldFor("supports"), null);
});

test("卡片字段显示最新的审核依据，数值真的变了才标待更新", () => {
  const claim = (id, value, validFrom, confidence = "verified") => ({
    id,
    entityId: "e-model",
    text: { zh: value, en: value },
    confidence,
    sourceIds: [],
    updatedAt: "2026-11-26",
    predicate: "standard-input-price",
    objectOrValue: value,
    validFrom,
  });
  const claims = [
    claim("old", "$3", "2026-01-01"),
    claim("new", "$2.50", "2026-11-01"),
    claim("draft", "$1", "2026-11-20", "unverified"),
  ];
  const basis = specBasis("e-model", "input_price", "$3 / 1M tokens", claims);
  assert.equal(basis.claim.id, "new");
  assert.equal(basis.differs, true);
  assert.equal(specBasis("e-model", "input_price", "$2.5 / 1M tokens", claims).differs, false);
  assert.equal(specBasis("e-model", "context_window", "1M tokens", claims), null);
});
