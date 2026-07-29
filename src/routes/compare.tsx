import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/layout/AppShell";
import { PageHeader, DemoBadge, ConfidenceChip } from "@/components/common";
import { DataStatePanel } from "@/components/data-state";
import { ENTITY_TYPE_LABELS } from "@/domain/labels";
import { useApp, pick } from "@/lib/app-state";
import { useKnowledgeSnapshot } from "@/hooks/use-knowledge";
import { useState } from "react";

export const Route = createFileRoute("/compare")({
  head: () => ({
    meta: [
      { title: "对比 · AI Radar" },
      { name: "description", content: "并排对比模型能力、指标、上下文与最近更新。" },
      { property: "og:title", content: "AI Radar · 对比" },
      { property: "og:description", content: "并排对比模型。" },
    ],
  }),
  component: ComparePage,
});

function ComparePage() {
  const { t, lang } = useApp();
  const snapshotQuery = useKnowledgeSnapshot();
  const [selected, setSelected] = useState<string[]>(["e-gpt", "e-claude"]);
  const models = (snapshotQuery.data?.entities ?? []).filter((e) => e.type === "model");
  const chosen = models.filter((m) => selected.includes(m.id));

  const toggle = (id: string) =>
    setSelected((p) =>
      p.includes(id) ? p.filter((x) => x !== id) : p.length < 4 ? [...p, id] : p,
    );

  if (!snapshotQuery.data) {
    return (
      <AppShell>
        <DataStatePanel
          kind={snapshotQuery.unavailableKind}
          title={t(
            snapshotQuery.error ? "对比数据加载失败" : "正在加载对比",
            snapshotQuery.error ? "Comparison failed to load" : "Loading comparison",
          )}
          description={t("请稍后重试。", "Please retry shortly.")}
          onRetry={snapshotQuery.error ? () => snapshotQuery.refetch() : undefined}
        />
      </AppShell>
    );
  }

  return (
    <AppShell>
      <PageHeader
        title={t("横向对比", "Compare side by side")}
        subtitle={t(
          "最多选择 4 个模型，比较能力、指标与最近更新。",
          "Pick up to 4 models to compare capabilities and recent updates.",
        )}
      />
      <div className="page-container space-y-6 pb-12 pt-3">
        <div className="paper-card flex flex-wrap items-center gap-3 p-4">
          {models.map((m) => (
            <button
              key={m.id}
              onClick={() => toggle(m.id)}
              className={
                "inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm " +
                (selected.includes(m.id)
                  ? "border-signal bg-accent font-medium text-signal"
                  : "border-border text-muted-foreground hover:border-signal/50")
              }
            >
              <span
                className={`h-3 w-3 rounded-full ${
                  selected.includes(m.id) ? "bg-signal" : "bg-border-strong"
                }`}
              />
              {pick(m.name, lang)}
            </button>
          ))}
          <span className="ml-auto font-mono text-lg text-signal">VS</span>
          <DemoBadge />
        </div>

        <div className="flex flex-wrap gap-2">
          {[
            t("明确能力支持", "Confirmed capabilities"),
            t("API 与上下文", "API & context"),
            t("工具调用", "Tool use"),
            t("多模态", "Multimodal"),
            t("部署与开放性", "Deployment & openness"),
            t("有来源的 Benchmark", "Sourced benchmarks"),
          ].map((dimension, index) => (
            <button
              key={dimension}
              type="button"
              className={`h-8 rounded-md border px-3 text-xs ${
                index === 0 || index === 2 || index === 3
                  ? "border-signal bg-signal text-white"
                  : "border-border bg-card text-muted-foreground hover:text-foreground"
              }`}
            >
              {dimension}
            </button>
          ))}
        </div>

        <div className="paper-card overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead className="border-b border-border bg-card text-xs text-muted-foreground">
              <tr>
                <th className="text-left py-4 px-5 font-medium w-52">
                  {t("对比维度", "Dimension")}
                </th>
                {chosen.map((m) => (
                  <th key={m.id} className="text-left py-4 px-5 font-semibold text-signal">
                    <Link
                      to="/knowledge/model/$slug"
                      params={{ slug: m.slug }}
                      className="hover:text-signal"
                    >
                      {pick(m.name, lang)}
                    </Link>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              <Row
                label={t("类型", "Type")}
                values={chosen.map((m) => pick(ENTITY_TYPE_LABELS[m.type], lang))}
              />
              <Row label={t("厂商", "Vendor")} values={chosen.map((m) => m.vendor ?? "—")} />
              <Row
                label={t("最新版本", "Latest")}
                values={chosen.map((m) => m.latestVersion ?? "—")}
              />
              <Row
                label={t("首次发布", "First released")}
                values={chosen.map((m) => m.firstReleasedAt ?? "—")}
              />
              <Row label={t("最近更新", "Updated")} values={chosen.map((m) => m.lastUpdatedAt)} />
              <Row label={t("标签", "Tags")} values={chosen.map((m) => m.tags.join(" · "))} />
              <tr>
                <td className="py-3 px-4 text-muted-foreground align-top">
                  {t("能力样本", "Capabilities")}
                </td>
                {chosen.map((m) => (
                  <td key={m.id} className="py-3 px-4 align-top">
                    <ul className="space-y-1.5">
                      {(m.capabilities ?? []).slice(0, 3).map((c, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <ConfidenceChip level={c.confidence} />
                          <span className="text-foreground">{pick(c, lang)}</span>
                        </li>
                      ))}
                      {!m.capabilities && <span className="text-muted-foreground">—</span>}
                    </ul>
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
        <p className="text-xs text-unverified">
          △{" "}
          {t(
            "所有 Benchmark 数据都必须绑定来源和截止时间，不作为脱离场景的通用总分。",
            "Every benchmark is source- and date-bound; no universal score is implied.",
          )}
        </p>
      </div>
    </AppShell>
  );
}

function Row({ label, values }: { label: string; values: string[] }) {
  return (
    <tr>
      <td className="py-3 px-4 text-muted-foreground">{label}</td>
      {values.map((v, i) => (
        <td key={i} className="py-3 px-4 text-foreground">
          {v}
        </td>
      ))}
    </tr>
  );
}
