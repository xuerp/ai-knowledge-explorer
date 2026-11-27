import assert from "node:assert/strict";
import test from "node:test";

import { createServer } from "vite";

const vite = await createServer({
  server: { middlewareMode: true },
  appType: "custom",
  optimizeDeps: { noDiscovery: true },
});
const { answerSourceNotice } = await vite.ssrLoadModule("/src/domain/answer-source.ts");

test.after(async () => vite.close());

test("未受邀账号显示仅对受邀账号开放，而不是服务故障", () => {
  assert.equal(answerSourceNotice("generation-not-entitled"), "invite-only");
});

test("服务异常仍提示模型综合暂不可用", () => {
  for (const reason of [
    "generation-invalid",
    "generation-provider-error",
    "generation-unavailable",
  ]) {
    assert.equal(answerSourceNotice(reason), "model-unavailable");
  }
});

test("模型已生成、证据不足或未记录原因时不显示来源提示", () => {
  for (const reason of [undefined, null, "", "generation-insufficient-evidence"]) {
    assert.equal(answerSourceNotice(reason), null);
  }
});

test("模型分析失败时单独提示，并区分次数用完与校验失败", () => {
  for (const reason of [
    "model-led-invalid",
    "model-led-provider-error",
    "model-led-too-large",
    "model-led-unavailable",
    "model-led-busy",
  ]) {
    assert.equal(answerSourceNotice(reason), "model-analysis-failed");
  }
});
