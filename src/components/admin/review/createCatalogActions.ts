import type { Entity, GraphEdge, TimelineEntry } from "@/domain/types";
import { adminApi } from "@/services/admin-api";

import { catalogExamples } from "./catalog-examples";
import type { CatalogRecordKind } from "./types";
import type { ReviewState } from "./useReviewState";
export function createCatalogActions(state: ReviewState) {
  const {
    catalogJson,
    catalogKind,
    refresh,
    setBusy,
    setCatalogJson,
    setCatalogKind,
    setCatalogMessage,
    setError,
    timelineEntityId,
    token,
  } = state;
  const switchCatalogKind = (kind: CatalogRecordKind) => {
    setCatalogKind(kind);
    setCatalogJson(catalogExamples[kind]);
    setCatalogMessage("");
  };

  const prepareRelationGap = (entityId: string) => {
    setCatalogKind("relation");
    setCatalogJson(
      JSON.stringify(
        {
          id: `edge-${entityId.replace(/^e-/, "")}-replace-target`,
          fromId: entityId,
          toId: "replace-with-existing-entity-id",
          kind: "uses",
          label: { zh: "填写可核验关系", en: "Describe verified relation" },
          confidence: "verified",
          sourceIds: ["replace-with-existing-evidence-id"],
        },
        null,
        2,
      ),
    );
    setCatalogMessage(`${entityId} 的关系模板已准备好；请只填写有证据支持的目标实体和关系类型。`);
    window.requestAnimationFrame(() => {
      document.getElementById("catalog-editor")?.scrollIntoView({ behavior: "smooth" });
    });
  };

  const saveCatalogRecord = async () => {
    setBusy(true);
    setError("");
    setCatalogMessage("");
    try {
      const payload = JSON.parse(catalogJson) as unknown;
      if (catalogKind === "entity") {
        const saved = await adminApi.upsertEntity(token, payload as Entity);
        setCatalogMessage(`已保存实体 ${saved.id}；公开目录会立即读取该记录。`);
      } else if (catalogKind === "relation") {
        const saved = await adminApi.upsertRelation(token, payload as GraphEdge);
        setCatalogMessage(`已保存关系 ${saved.id}。`);
      } else {
        if (!timelineEntityId.trim()) throw new Error("请填写时间线所属的实体 ID。");
        const saved = await adminApi.upsertTimeline(
          token,
          timelineEntityId.trim(),
          payload as TimelineEntry,
        );
        setCatalogMessage(`已保存时间线事件 ${saved.id}。`);
      }
      await refresh(token);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Catalog update failed.");
    } finally {
      setBusy(false);
    }
  };
  return { switchCatalogKind, prepareRelationGap, saveCatalogRecord };
}
