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
  const [selected, setSelected] = useState<string[]>(["e-gpt", "e-claude", "e-deepseek"]);
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
        title={t("并排对比", "Compare")}
        subtitle={t(
          "最多选择 4 个模型，比较能力、指标与最近更新。",
          "Pick up to 4 models to compare capabilities and recent updates.",
        )}
      />
      <div className="max-w-7xl mx-auto px-4 md:px-6 py-8 space-y-6">
        <div className="flex flex-wrap gap-2">
          {models.map((m) => (
            <button
              key={m.id}
              onClick={() => toggle(m.id)}
              className={
                "chip " +
                (selected.includes(m.id)
                  ? "!bg-signal !text-signal-foreground !border-signal"
                  : "hover:border-signal/50")
              }
            >
              {pick(m.name, lang)}
            </button>
          ))}
          <DemoBadge className="ml-auto" />
        </div>

        <div className="paper-card overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="text-left py-3 px-4 font-medium w-40">{t("对象", "Attribute")}</th>
                {chosen.map((m) => (
                  <th key={m.id} className="text-left py-3 px-4 font-medium">
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
