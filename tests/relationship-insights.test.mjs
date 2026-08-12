import assert from "node:assert/strict";
import test from "node:test";

import { createServer } from "vite";

const vite = await createServer({ server: { middlewareMode: true }, appType: "custom" });
const { ENTITIES, RELATIONS } = await vite.ssrLoadModule("/src/lib/demo-data.ts");
const { connectionPath, ecosystemGroups, impactScope, incidentRelations } =
  await vite.ssrLoadModule("/src/domain/relationship-insights.ts");

test.after(async () => vite.close());

test("生态组成按实体类型聚合直接关系", () => {
  const target = ENTITIES.find((entity) => incidentRelations(RELATIONS, entity.id).length >= 2);
  assert.ok(target);
  const groups = ecosystemGroups(ENTITIES, RELATIONS, target.id);
  assert.ok(groups.length > 0);
  assert.ok(groups.every((group) => group.entities.length > 0));
  assert.equal(
    groups.reduce((total, group) => total + group.entities.length, 0),
    new Set(
      incidentRelations(RELATIONS, target.id).map((edge) =>
        edge.fromId === target.id ? edge.toId : edge.fromId,
      ),
    ).size,
  );
});

test("关联范围明确区分一跳和二跳对象", () => {
  const target = ENTITIES.find((entity) => incidentRelations(RELATIONS, entity.id).length >= 2);
  assert.ok(target);
  const scope = impactScope(ENTITIES, RELATIONS, target.id, 2);
  assert.ok(scope.directIds.size > 0);
  assert.ok([...scope.indirectIds].every((id) => !scope.directIds.has(id)));
  assert.ok(scope.entityIds.every((id) => ENTITIES.some((entity) => entity.id === id)));
});

test("关系解释返回按路径方向排列的可读步骤", () => {
  const edge = RELATIONS[0];
  const result = connectionPath(ENTITIES, RELATIONS, edge.fromId, edge.toId);
  assert.deepEqual(result.path.nodeIds, [edge.fromId, edge.toId]);
  assert.equal(result.steps.length, 1);
  assert.equal(result.steps[0].from.id, edge.fromId);
  assert.equal(result.steps[0].to.id, edge.toId);
});
