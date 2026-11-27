import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "vite";

const vite = await createServer({
  server: { middlewareMode: true },
  appType: "custom",
  optimizeDeps: { noDiscovery: true },
});
const { toggleChangeKind, matchesChangeKinds } = await vite.ssrLoadModule(
  "/src/domain/change-filters.ts",
);
test.after(() => vite.close());

test("变化多选取并集且不会复制同一事件", () => {
  const events = [
    { id: "price-a", kind: "pricing" },
    { id: "release", kind: "new" },
    { id: "access", kind: "availability" },
    { id: "price-b", kind: "pricing" },
  ];
  const selected = toggleChangeKind(toggleChangeKind([], "pricing"), "availability");
  assert.deepEqual(
    events.filter((event) => matchesChangeKinds(event, selected)).map((event) => event.id),
    ["price-a", "access", "price-b"],
  );
  assert.equal(events.filter((event) => matchesChangeKinds(event, [])).length, 4);
});

test("再次点击取消类型，全部与取消最后一个都恢复不限", () => {
  const selected = ["pricing", "availability"];
  assert.deepEqual(toggleChangeKind(selected, "pricing"), ["availability"]);
  assert.deepEqual(toggleChangeKind(["availability"], "availability"), []);
  assert.deepEqual(toggleChangeKind(selected, "all"), []);
  assert.deepEqual(selected, ["pricing", "availability"]);
});
