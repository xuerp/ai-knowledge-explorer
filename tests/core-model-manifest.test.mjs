import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const manifest = JSON.parse(await readFile("product/core-models.v1.json", "utf8"));
const snapshot = JSON.parse(await readFile("backend/data/demo_snapshot.json", "utf8"));

test("versioned core model manifest resolves to eight published model families", () => {
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.models.length, 8);
  assert.equal(manifest.models.filter((item) => item.tier === "anchor").length, 3);
  const entities = new Map(snapshot.entities.map((entity) => [entity.id, entity]));
  for (const entry of manifest.models) {
    const entity = entities.get(entry.entityId);
    assert.equal(entity?.slug, entry.slug);
    assert.equal(entity?.type, "model");
  }
});

test("each core model has at least one published evidence source in the bundled snapshot", () => {
  const evidenceIds = new Set(snapshot.evidence.map((item) => item.id));
  for (const entry of manifest.models) {
    const timelineSourceIds = (snapshot.timeline[entry.entityId] ?? []).flatMap(
      (item) => item.sourceIds ?? [],
    );
    assert.ok(
      timelineSourceIds.some((id) => evidenceIds.has(id)),
      `${entry.slug} must resolve to evidence`,
    );
  }
});
