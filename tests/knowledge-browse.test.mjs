import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "vite";

const vite = await createServer({
  server: { middlewareMode: true },
  appType: "custom",
  optimizeDeps: { noDiscovery: true },
});
const {
  parseKnowledgeSearch,
  knowledgeReturnSearch,
  knowledgeBrowseHref,
  CATEGORY_TYPES,
  knowledgePurpose,
} = await vite.ssrLoadModule("/src/domain/knowledge-browse.ts");
const { DEMO_KNOWLEDGE_SNAPSHOT: snapshot } = await vite.ssrLoadModule("/src/data/demo-adapter.ts");
const { authResponseError, AuthSessionExpiredError } = await vite.ssrLoadModule(
  "/src/services/auth-errors.ts",
);
const { changeDetailFields } = await vite.ssrLoadModule("/src/domain/change-presentation.ts");
const { claimTopicLabel } = await vite.ssrLoadModule("/src/domain/claim-reading-mode.ts");
test.after(() => vite.close());

test("模型家族入口保留全部家族且排除具体版本，不改变核心历史范围", async () => {
  const { browseModelFamilies } = await vite.ssrLoadModule("/src/domain/model-families.ts");
  const families = browseModelFamilies([...snapshot.entities].reverse());
  assert.deepEqual(
    families.slice(0, 3).map((entity) => entity.id),
    ["e-gpt", "e-claude", "e-gemini"],
  );
  assert.equal(
    families.length,
    snapshot.entities.filter((entity) => entity.type === "model" && !entity.familyId).length,
  );
  assert.ok(families.some((entity) => entity.id === "e-glm"));
  assert.ok(families.some((entity) => entity.id === "e-hunyuan"));
  assert.ok(families.every((entity) => !entity.familyId));
  const { groupModelProductLines } = await vite.ssrLoadModule("/src/domain/model-product-lines.ts");
  for (const id of ["e-glm", "e-hunyuan"]) {
    const versions = snapshot.entities.filter((entity) => entity.familyId === id);
    const lines = groupModelProductLines(versions);
    assert.deepEqual(
      lines.flatMap((line) => line.versions.map((entity) => entity.id)).sort(),
      versions.map((entity) => entity.id).sort(),
    );
  }
});

test("事实主题将结构化谓词转换为可读分类", () => {
  assert.equal(claimTopicLabel("capability-updated-on", "zh"), "能力与机制");
  assert.equal(claimTopicLabel("pricing-changed-on", "zh"), "价格与额度");
  assert.equal(claimTopicLabel("scheduled-for-retirement-on", "zh"), "弃用与下线");
  assert.equal(claimTopicLabel("availability", "en"), "Access & availability");
});

test("事件说明按变化类型呈现，弃用和空白前态不会套能力更新模板", () => {
  const value = (zh) => ({ zh, en: zh });
  const detail = {
    before: value("尚无本次下线公告。"),
    after: value("计划下线"),
    affected: value("旧版用户"),
    action: value("迁移到新版本"),
  };
  const retirement = changeDetailFields({ kind: "deprecated", detail }, "zh");
  assert.equal(retirement.length, 3);
  assert.deepEqual(
    retirement.map((field) => field.label),
    ["弃用 / 下线安排", "受影响用户", "迁移建议"],
  );
  assert.equal(retirement[0].value.zh, "计划下线");
  assert.equal(changeDetailFields({ kind: "updated", detail }, "zh").length, 4);
  assert.equal(changeDetailFields({ kind: "availability", detail }, "zh").length, 3);
  assert.equal(
    changeDetailFields(
      { kind: "pricing", detail: { ...detail, before: value("每百万令牌 3 美元") } },
      "en",
    )[0].label,
    "Previous pricing / limits",
  );
  assert.deepEqual(changeDetailFields({ kind: "new" }, "zh"), []);
});

test("工具及组织分类完整覆盖目录，Agent 不再漏出分类", () => {
  for (const entity of snapshot.entities.filter((item) => !item.familyId)) {
    assert.equal(
      Object.values(CATEGORY_TYPES).filter((types) => types.includes(entity.type)).length,
      1,
      entity.id,
    );
  }
  assert.equal(
    snapshot.entities.filter(
      (entity) => !entity.familyId && CATEGORY_TYPES.ecosystem.includes(entity.type),
    ).length,
    17,
  );
});

test("目录状态可以从详情恢复，保留分类、地区、关键词", () => {
  const original = parseKnowledgeSearch({
    category: "organizations",
    region: "overseas",
    q: "Google & API",
  });
  assert.deepEqual(knowledgeReturnSearch("company", knowledgeBrowseHref(original)), original);
  assert.deepEqual(
    knowledgeReturnSearch(
      "framework",
      knowledgeBrowseHref(parseKnowledgeSearch({ category: "ecosystem", q: "Lang" })),
    ),
    parseKnowledgeSearch({ category: "ecosystem", q: "Lang" }),
  );
  assert.equal(knowledgeReturnSearch("company").category, "organizations");
  assert.equal(knowledgeReturnSearch("agent").category, "ecosystem");
  assert.equal(knowledgeReturnSearch("application").category, "ecosystem");
  assert.equal(knowledgeReturnSearch("paper").category, "research");
  const research = parseKnowledgeSearch({ category: "research", region: "overseas", q: "SWE" });
  assert.deepEqual(knowledgeReturnSearch("benchmark", knowledgeBrowseHref(research)), research);
  for (const value of [
    "https://evil.example/knowledge?category=all",
    "//evil.example/knowledge",
    "/admin/review",
    "%%%",
  ])
    assert.equal(knowledgeReturnSearch("company", value).category, "organizations");
  assert.equal(parseKnowledgeSearch({ category: "ecosystem", signal: "open" }).signal, "all");
});

test("浏览按用途组织，编码助手与 IDE 不再因产品形态分开", () => {
  for (const slug of ["cursor", "claude-code", "codex", "gemini-cli", "devin", "traecode"])
    assert.equal(
      knowledgePurpose(snapshot.entities.find((entity) => entity.slug === slug)),
      "coding",
      slug,
    );
  for (const slug of ["workbuddy", "traework", "manus"])
    assert.equal(
      knowledgePurpose(snapshot.entities.find((entity) => entity.slug === slug)),
      "work",
      slug,
    );
  for (const slug of ["mcp", "langchain", "langgraph", "autogen", "openai-agents-sdk"])
    assert.equal(
      knowledgePurpose(snapshot.entities.find((entity) => entity.slug === slug)),
      "infrastructure",
      slug,
    );
});

test("新增收录有直接来源，代表版本与未知发布日期分别记录", () => {
  const sources = new Set(snapshot.evidence.map((source) => source.id));
  const entities = new Set(snapshot.entities.map((entity) => entity.id));
  for (const id of [
    "e-workbuddy",
    "e-traecode",
    "e-traework",
    "e-glm",
    "e-hunyuan",
    "e-glm-5-3",
    "e-hy4-preview",
  ]) {
    const entity = snapshot.entities.find((entity) => entity.id === id);
    assert.ok(entity.knowledge.introduction.length, id);
    assert.ok(entity.knowledge.useCases.length >= 2, id);
    assert.ok(entity.knowledge.limitations.length, id);
    for (const point of entity.knowledge.keyPoints) {
      assert.ok(point.sourceIds.length, id);
      assert.ok(
        point.sourceIds.every((source) => sources.has(source)),
        id,
      );
    }
  }
  for (const relation of snapshot.graph.edges.filter((relation) =>
    relation.id.startsWith("r-intake-"),
  )) {
    assert.ok(entities.has(relation.fromId) && entities.has(relation.toId), relation.id);
    assert.ok(
      relation.sourceIds.every((source) => sources.has(source)),
      relation.id,
    );
  }
  assert.equal(
    snapshot.entities.find((entity) => entity.id === "e-glm-5-3").release.releasedAt,
    "2026-08-14",
  );
  assert.equal(
    snapshot.entities.find((entity) => entity.id === "e-hy4-preview").release.releasedAt,
    "2026-08-28",
  );
  assert.ok(
    snapshot.timeline["e-hunyuan"].some(
      (event) =>
        event.releaseEntityId === "e-hy4-preview" &&
        event.dateKind === "release" &&
        event.date === "2026-08-28",
    ),
  );
  assert.equal(snapshot.meta.retrievedAt.slice(0, 10), "2026-10-08");
});

test("密码错误、认证服务故障与真实会话过期分别处理", () => {
  const incorrect = authResponseError(401, false, "/api/v2/auth/login");
  assert.match(incorrect.message, /邮箱或密码不正确/);
  assert.equal(incorrect instanceof AuthSessionExpiredError, false);
  assert.equal(
    authResponseError(401, true, "/api/v2/auth/me") instanceof AuthSessionExpiredError,
    true,
  );
  assert.match(authResponseError(503, false, "/api/v2/auth/login").message, /服务暂时不可用/);
  assert.equal(authResponseError(500, true, "/api/v2/following"), null);
});

test("组织与产品详情均有用途、边界及可追溯的直接来源", () => {
  const evidence = new Map(snapshot.evidence.map((source) => [source.id, source]));
  for (const entity of snapshot.entities.filter((item) =>
    CATEGORY_TYPES.organizations.includes(item.type),
  )) {
    assert.ok(entity.knowledge?.introduction.length, entity.id);
    assert.ok(entity.knowledge?.useCases.length >= 2, entity.id);
    assert.ok(entity.knowledge?.limitations.length, entity.id);
    assert.ok(
      entity.knowledge?.keyPoints.some((point) => point.sourceIds?.length),
      entity.id,
    );
    for (const point of entity.knowledge.keyPoints)
      for (const id of point.sourceIds ?? []) assert.ok(evidence.has(id), `${entity.id}: ${id}`);
  }
});
