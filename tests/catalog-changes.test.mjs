import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { applyCatalogOverlays } from "../src/data/catalog-overlay.mjs";
import { catalogReleaseChanges, catalogChanges } from "../src/data/catalog-changes.mjs";

const [baseline, extension, frontier] = await Promise.all(
  ["demo_snapshot", "catalog_extension", "frontier_catalog_v1"].map(async (name) =>
    JSON.parse(await readFile(`backend/data/${name}.json`, "utf8")),
  ),
);
const snapshot = applyCatalogOverlays(baseline, extension, frontier);

test("reviewed non-release events contain dated evidence, differences and affected scope", () => {
  const changes = catalogChanges(snapshot);
  const events = changes.filter((item) => item.kind !== "new");
  assert.equal(events.length, 58);
  assert.equal(changes.length, 260);
  assert.deepEqual(
    new Set(events.map((item) => item.kind)),
    new Set(["updated", "deprecated", "pricing", "availability", "benchmark"]),
  );
  for (const event of events) {
    assert.ok(
      event.detail.before.zh &&
        event.detail.after.zh &&
        event.detail.affected.zh &&
        event.detail.action.zh,
    );
    assert.ok(event.sourceIds.length);
    assert.notEqual(event.date, "2026-10-02");
  }
});

test("non-release coverage spans every family and preserves event dates versus publication dates", () => {
  const events = catalogChanges(snapshot).filter((item) => item.kind !== "new");
  const entities = new Map(snapshot.entities.map((entity) => [entity.id, entity]));
  assert.equal(
    new Set(
      events.map((event) => {
        const entity = entities.get(event.entityId);
        return entity.familyId ?? entity.id;
      }),
    ).size,
    8,
  );
  for (const [slug, occurred, published] of [
    ["kimi-k2-turbo-price-cut", "2025-11-06", "2025-11-07"],
    ["ernie40-35-price-reduction", "2024-07-05", "2024-07-08"],
    ["deepseek-peak-offpeak-effective", "2026-08-16", "2026-08-13"],
  ]) {
    const event = events.find((item) => item.id === `change-event-t-change-${slug}`);
    assert.equal(event.date, occurred);
    assert.equal(
      snapshot.evidence.find((source) => source.id === event.sourceIds[0]).publishedAt,
      published,
    );
  }
  const benchmarks = events.filter((item) => item.kind === "benchmark");
  assert.equal(benchmarks.length, 2);
  assert.ok(benchmarks.every((item) => item.detail.affected.en.includes("provider")));
});

test("non-release projection fails closed when event facts or supporting claims are missing", () => {
  const original = snapshot.timeline["e-claude"].find((item) => item.changeKind === "deprecated");
  const run = (edit) => {
    const fixture = structuredClone(snapshot);
    fixture.timeline = { "e-claude": [structuredClone(original)] };
    edit(fixture, fixture.timeline["e-claude"][0]);
    return catalogChanges(fixture);
  };
  assert.equal(run(() => {}).length, 1);
  for (const edit of [
    (_, event) => {
      event.changeKind = null;
    },
    (_, event) => {
      event.dateKind = "catalog-review";
    },
    (_, event) => {
      event.confidence = "conflict";
    },
    (_, event) => {
      event.detail = null;
    },
    (_, event) => {
      event.date = "2026-02-30";
    },
    (_, event) => {
      event.releaseEntityId = "e-gpt-61-sol";
    },
    (fixture) => {
      fixture.claims = [];
    },
    (fixture) => {
      fixture.claims.forEach((item) => {
        item.confidence = "unverified";
      });
    },
    (fixture) => {
      fixture.evidence.forEach((source) => {
        source.sourceExcerpt = null;
      });
    },
  ])
    assert.deepEqual(run(edit), []);
});

test("all confirmed releases produce unique, date-exact, sourced changes across thirteen families", () => {
  const changes = catalogReleaseChanges(snapshot);
  const entities = new Map(snapshot.entities.map((entity) => [entity.id, entity]));
  assert.equal(changes.length, 202);
  assert.equal(new Set(changes.map((change) => change.entityId)).size, changes.length);
  assert.equal(new Set(changes.map((change) => entities.get(change.entityId).familyId)).size, 13);
  assert.equal(changes[0].date, "2026-10-13");
  assert.equal(entities.get(changes[0].entityId).release.releaseId, "gemini-4-argon");
  assert.equal(
    snapshot.meta.retrievedAt.slice(0, 10),
    [frontier.meta.changeEventsVerifiedAt, frontier.meta.verifiedAt, extension.meta.verifiedAt]
      .filter(Boolean)
      .sort()
      .at(-1),
  );
  for (const change of changes) {
    assert.equal(change.date, entities.get(change.entityId).release.releasedAt);
    assert.equal(change.kind, "new");
    assert.equal(change.confidence, "verified");
    assert.ok(change.sourceIds.length);
  }
  for (const id of ["e-gemini-3-1-flash-live", "e-gemini-3-1-flash-tts"]) {
    assert.ok(!changes.some((change) => change.entityId === id));
  }
});

test("reviewed Mistral cards preserve preview versus GA and leave unverified billing unknown", () => {
  for (const [id, stage, date, context] of [
    ["e-mistral-large-4", "preview", "2026-10-06", "1M tokens"],
    ["e-mistral-large-3", "stable", "2025-12-02", "256k tokens"],
  ]) {
    const entity = snapshot.entities.find((item) => item.id === id);
    assert.equal(entity.familyId, "e-mistral");
    assert.equal(entity.release.stage, stage);
    assert.equal(entity.release.releasedAt, date);
    assert.equal(entity.specs.contextWindow, context);
    assert.equal(entity.specs.inputPrice ?? null, null);
    assert.equal(entity.specs.outputPrice ?? null, null);
    for (const claim of snapshot.claims.filter(
      (item) => item.entityId === id && item.predicate !== "release",
    )) {
      assert.equal(claim.validFrom, null);
      assert.ok(claim.observedAt.startsWith("2026-10-07T"));
    }
    const edge = snapshot.graph.edges.find((item) => item.fromId === id && item.kind === "part-of");
    assert.equal(edge.validFrom, null);
    const event = catalogReleaseChanges(snapshot).find((item) => item.entityId === id);
    assert.equal(event.date, date);
    assert.ok(
      event.sourceIds.every((sourceId) =>
        snapshot.evidence
          .find((source) => source.id === sourceId)
          ?.supportsClaimIds?.some((claimId) =>
            snapshot.claims.some(
              (claim) =>
                claim.id === claimId && claim.entityId === id && claim.predicate === "release",
            ),
          ),
      ),
    );
  }
});

test("MiniMax M2 intake keeps legacy listing and source-file dates separate from releases", () => {
  const m27 = snapshot.entities.find((item) => item.id === "e-minimax-m2-7");
  const m25 = snapshot.entities.find((item) => item.id === "e-minimax-m2-5");
  assert.equal(m27.release.releasedAt, "2026-03-18");
  assert.equal(m25.release.releasedAt, "2026-02-12");
  assert.equal(m25.release.catalogCurrent, true);
  assert.notEqual(m25.release.stage, "retired");
  assert.match(m25.summary.en, /legacy.*retirement/i);
  for (const entity of [m27, m25]) {
    assert.equal(entity.familyId, "e-minimax");
    assert.equal(entity.specs.inputPrice ?? null, null);
    assert.equal(entity.specs.outputPrice ?? null, null);
    assert.equal(entity.specs.contextWindow ?? null, null);
    assert.ok(entity.knowledge.keyPoints.length >= 3);
    for (const claim of snapshot.claims.filter(
      (item) => item.entityId === entity.id && item.predicate !== "release",
    )) {
      assert.equal(claim.validFrom, null);
      assert.ok(claim.observedAt.startsWith("2026-10-07T"));
    }
  }
  const license = snapshot.claims.find(
    (item) => item.entityId === m27.id && item.predicate === "licensed-under",
  );
  assert.match(license.objectOrValue, /non-commercial.*prior written authorization/i);
  const source = snapshot.evidence.find((item) => item.id === license.sourceIds[0]);
  assert.equal(source.publishedAt, "2026-04-14");
  assert.notEqual(source.publishedAt, m27.release.releasedAt);
  assert.match(source.sourceExcerpt, /NON-COMMERCIAL LICENSE/);
  assert.match(source.sourceExcerpt, /commercial use requires prior written authorization/);
  assert.ok(
    !snapshot.claims.some(
      (item) => item.entityId === m25.id && item.predicate === "licensed-under",
    ),
  );
});

test("review dates, conflicts, pending versions and unverified or missing sources never fabricate releases", () => {
  const original = snapshot.timeline["e-gpt"].find(
    (event) => event.releaseEntityId === "e-gpt-61-sol",
  );
  const run = (edit) => {
    const fixture = structuredClone(snapshot);
    fixture.timeline = { "e-gpt": [structuredClone(original)] };
    edit(fixture, fixture.timeline["e-gpt"][0]);
    return catalogReleaseChanges(fixture);
  };
  assert.equal(run(() => {}).length, 1);
  for (const edit of [
    (_, event) => {
      event.dateKind = "catalog-review";
    },
    (_, event) => {
      event.confidence = "conflict";
    },
    (_, event) => {
      event.date = "2026-10-01";
    },
    (_, event) => {
      event.sourceIds = ["missing"];
    },
    (fixture) => {
      fixture.entities.find((entity) => entity.id === original.releaseEntityId).release.stage =
        "pending";
    },
    (fixture) => {
      fixture.evidence.forEach((source) => {
        source.verifiedAt = null;
      });
    },
    (fixture, event) => {
      event.date = "2026-02-30";
      fixture.entities.find((entity) => entity.id === event.releaseEntityId).release.releasedAt =
        event.date;
    },
  ])
    assert.deepEqual(run(edit), []);
});
