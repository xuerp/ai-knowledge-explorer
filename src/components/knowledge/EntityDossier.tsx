import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { ExternalLink, Network } from "lucide-react";
import type { Entity, KnowledgeSnapshot } from "@/domain/types";
import { pick, useApp } from "@/lib/app-state";
import { referenceSectionsForMode } from "@/domain/reference-reading";

export function EntityDossier({
  entity,
  snapshot,
}: {
  entity: Entity;
  snapshot: KnowledgeSnapshot;
}) {
  const { t, lang, mode } = useApp();
  const sections = referenceSectionsForMode(entity, mode);
  const sources = new Map(snapshot.evidence.map((source) => [source.id, source]));
  const edges = snapshot.graph.edges.filter(
    (edge) => edge.fromId === entity.id || edge.toId === entity.id,
  );
  const relatedIds = new Set(
    edges.map((edge) => (edge.fromId === entity.id ? edge.toId : edge.fromId)),
  );
  const related = snapshot.entities.filter((item) => relatedIds.has(item.id));
  const [showAll, setShowAll] = useState(false);
  return (
    <section
      className="entity-dossier"
      aria-label={t("使用与技术资料", "Usage and technical reference")}
    >
      <nav className="entity-dossier__nav" aria-label={t("资料目录", "Profile contents")}>
        {mode !== "general" && (
          <a href="#reference-focus">
            {mode === "product"
              ? t("采用与限制", "Adoption and limits")
              : t("接入与核对", "Integration and verification")}
          </a>
        )}
        {sections.map((section) => (
          <a key={section.id} href={`#reference-${section.id}`}>
            {pick(section.title, lang)}
          </a>
        ))}
        <a href="#reference-ecosystem">
          {t(entity.type === "company" ? "模型与产品目录" : "关联对象", "Related catalog")}
        </a>
      </nav>
      <div className="entity-dossier__layout">
        <div className="entity-dossier__content">
          {mode !== "general" && entity.knowledge && (
            <article id="reference-focus" className="entity-dossier__focus">
              <h2>
                {mode === "product"
                  ? t("采用与限制", "Adoption and limits")
                  : t("接入与核对", "Integration and verification")}
              </h2>
              {mode === "product" ? (
                <>
                  <dl>
                    {entity.knowledge.useCases.map((item, index) => (
                      <div key={index}>
                        <dt>{pick(item.title, lang)}</dt>
                        <dd>{pick(item.description, lang)}</dd>
                      </div>
                    ))}
                  </dl>
                  <h3>{t("采用前确认", "Confirm before adoption")}</h3>
                  <ul>
                    {entity.knowledge.limitations.map((item, index) => (
                      <li key={index}>{pick(item, lang)}</li>
                    ))}
                  </ul>
                </>
              ) : (
                <>
                  <dl>
                    {entity.knowledge.keyPoints.map((item, index) => (
                      <div key={index}>
                        <dt>{pick(item.title, lang)}</dt>
                        <dd>
                          {pick(item.description, lang)}
                          {item.sourceIds
                            ?.map((id) => sources.get(id))
                            .filter((source) => source !== undefined)
                            .map((source) => (
                              <a key={source.id} href={source.url} target="_blank" rel="noreferrer">
                                {t("查阅原文", "Read source")} <ExternalLink aria-hidden="true" />
                              </a>
                            ))}
                        </dd>
                      </div>
                    ))}
                  </dl>
                  {entity.knowledge.officialUrl && (
                    <a
                      className="entity-dossier__sources"
                      href={entity.knowledge.officialUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {t("官方文档与接入入口", "Official documentation and access")}
                    </a>
                  )}
                </>
              )}
            </article>
          )}
          {sections.map((section) => (
            <article key={section.id} id={`reference-${section.id}`}>
              <h2>{pick(section.title, lang)}</h2>
              <p>{pick(section.summary, lang)}</p>
              {section.items.length > 0 && (
                <ul>
                  {section.items.map((item, index) => (
                    <li key={index}>{pick(item, lang)}</li>
                  ))}
                </ul>
              )}
              <div className="entity-dossier__sources">
                {section.sourceIds
                  .map((id) => sources.get(id))
                  .filter((source) => source !== undefined)
                  .filter(
                    (source, index, list) =>
                      list.findIndex((item) => item.url === source.url) === index,
                  )
                  .map((source) => (
                    <a href={source.url} key={source.id} target="_blank" rel="noreferrer">
                      {source.publisher} · {pick(source.title, lang)}{" "}
                      <ExternalLink aria-hidden="true" />
                    </a>
                  ))}
              </div>
            </article>
          ))}
        </div>
        <aside id="reference-ecosystem">
          <h2>{t(entity.type === "company" ? "模型与产品目录" : "关联对象", "Related catalog")}</h2>
          <p>
            {t(
              "以下对象来自已收录关系，可继续查看版本、使用条件和证据。",
              "Follow recorded relationships to versions, access conditions and evidence.",
            )}
          </p>
          {related.length ? (
            <ul>
              {(showAll ? related : related.slice(0, 6)).map((item) => (
                <li key={item.id}>
                  <Link to="/knowledge/$type/$slug" params={{ type: item.type, slug: item.slug }}>
                    <strong>{pick(item.name, lang)}</strong>
                    <span>{pick(item.summary, lang)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p>
              {t(
                "尚无已收录的直接关联；未绑定关系不等于没有产品或合作。",
                "No direct relationships have been recorded yet.",
              )}
            </p>
          )}
          {related.length > 6 && (
            <button
              type="button"
              className="text-sm text-signal"
              onClick={() => setShowAll(!showAll)}
            >
              {showAll
                ? t("收起目录", "Show fewer")
                : t(`展开全部（${related.length}）`, `Show all (${related.length})`)}
            </button>
          )}
          <Link
            to="/graph"
            search={{ entity: entity.id, mode: "ecosystem" }}
            className="entity-dossier__graph"
          >
            <Network aria-hidden="true" />
            {t("在知识图谱中探索", "Explore the graph")}
          </Link>
          <dl>
            <div>
              <dt>{t("资料更新", "Updated")}</dt>
              <dd>{entity.lastUpdatedAt}</dd>
            </div>
            <div>
              <dt>{t("直接关系", "Direct relationships")}</dt>
              <dd>{edges.length}</dd>
            </div>
          </dl>
        </aside>
      </div>
    </section>
  );
}
