import assert from "node:assert/strict";
import test from "node:test";

import { createServer } from "vite";

const vite = await createServer({ server: { middlewareMode: true }, appType: "custom" });
const { splitClaimsForDisplay } = await vite.ssrLoadModule("/src/domain/claim-display.ts");

test.after(async () => vite.close());

test("实体事实默认展示最新八条并完整保留历史", () => {
  const claims = Array.from({ length: 12 }, (_, index) => ({
    id: `claim-${index + 1}`,
    updatedAt: `2026-${String(index + 1).padStart(2, "0")}-01`,
  }));

  const result = splitClaimsForDisplay(claims);

  assert.equal(result.visible.length, 8);
  assert.equal(result.history.length, 4);
  assert.equal(result.visible[0].id, "claim-12");
  assert.equal(result.history.at(-1).id, "claim-1");
  assert.deepEqual(
    [...result.visible, ...result.history].map((claim) => claim.id).sort(),
    claims.map((claim) => claim.id).sort(),
  );
  assert.throws(() => splitClaimsForDisplay(claims, 0), /正整数/);
});
