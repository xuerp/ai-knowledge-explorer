import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { PageHeader, DemoBadge, ConfidenceChip } from "@/components/common";
import { DEMO_KNOWLEDGE_SNAPSHOT } from "@/data/demo-adapter";
import { useApp, pick } from "@/lib/app-state";
import { useModelCatalog, useModelVersionComparison } from "@/hooks/use-knowledge";

export const Route = createFileRoute("/compare")({
  head: () => ({
    meta: [
      { title: "AI 路线对比 · AI Radar" },
      { name: "description", content: "默认对比 GPT、Claude 与 Gemini，并可下钻到具体模型版本。" },
      { property: "og:title", content: "AI Radar · AI 路线对比" },
      { property: "og:description", content: "在一致维度下理解主流 AI 的产品路线与能力差异。" },
    ],
  }),
  component: ComparePage,
});

type Scope = "versions" | "families";

function ComparePage() {
  const { t, lang } = useApp();
  const catalogQuery = useModelCatalog();
  const [scope, setScope] = useState<Scope>("families");
  const [selected, setSelected] = useState<string[]>(["e-gpt", "e-claude", "e-gemini"]);
  const allModels =
    catalogQuery.data ??
    DEMO_KNOWLEDGE_SNAPSHOT.entities.filter((entity) => entity.type === "model");
  const models = allModels.filter((model) =>
    scope === "versions" ? Boolean(model.familyId) : !model.familyId,
  );
  const comparisonQuery = useModelVersionComparison(scope === "versions" ? selected : []);
  const chosen =
    scope === "versions" && selected.length >= 2
      ? (comparisonQuery.data ?? models.filter((model) => selected.includes(model.id)))
      : models.filter((model) => selected.includes(model.id));

  const changeScope = (next: Scope) => {
    setScope(next);
    setSelected(
      next === "versions" ? ["e-gpt-5", "e-claude-45"] : ["e-gpt", "e-claude", "e-gemini"],
    );
  };

  const toggle = (id: string) =>
    setSelected((previous) =>
      previous.includes(id)
        ? previous.filter((item) => item !== id)
        : previous.length < 4
          ? [...previous, id]
          : previous,
    );

  return (
    <AppShell>
      <PageHeader
        title={t("AI 路线对比", "Compare AI product directions")}
        subtitle={t(
          "默认对比 GPT、Claude 与 Gemini 的长期定位、能力重点和生态方向；需要采购决策时再切换到具体版本。所有内容均保留演示数据边界。",
          "Start with GPT, Claude, and Gemini at the family level, then switch to concrete versions for purchasing decisions. Demo-data boundaries remain explicit.",
        )}
      />
      <div className="page-container space-y-6 pb-12 pt-3">
        {!catalogQuery.data && (
          <div className="rounded-md border border-signal/20 bg-accent/60 px-4 py-3 text-xs leading-6 text-muted-foreground">
            {t(
              catalogQuery.error
                ? "实时目录暂时不可用，当前明确使用内置演示快照进行比较。"
                : "实时目录正在连接，当前先使用内置演示快照进行比较。",
              catalogQuery.error
                ? "The live catalog is temporarily unavailable; comparison explicitly uses the bundled demo snapshot."
                : "The live catalog is connecting; comparison uses the bundled demo snapshot in the meantime.",
            )}
          </div>
        )}
        <div className="inline-flex rounded-lg border border-border bg-card p-1">
          {(["versions", "families"] as const).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => changeScope(item)}
              className={`rounded-md px-4 py-2 text-sm transition-colors ${
                scope === item
                  ? "bg-signal font-medium text-signal-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {item === "versions"
                ? t("具体版本", "Concrete versions")
                : t("模型系列", "Model families")}
            </button>
          ))}
        </div>

        <div className="paper-card flex flex-wrap items-center gap-3 p-4">
          {models.map((model) => (
            <button
              key={model.id}
              onClick={() => toggle(model.id)}
              className={
                "inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm " +
                (selected.includes(model.id)
                  ? "border-signal bg-accent font-medium text-signal"
                  : "border-border text-muted-foreground hover:border-signal/50")
              }
            >
              <span
                className={`h-3 w-3 rounded-full ${
                  selected.includes(model.id) ? "bg-signal" : "bg-border-strong"
                }`}
              />
              {pick(model.name, lang)}
            </button>
          ))}
          <span className="ml-auto font-mono text-lg text-signal">VS</span>
          <DemoBadge />
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <DecisionCard
            title={t("看价格", "Price")}
            body={t(
              "同一单位展示输入与输出成本，避免只看单边报价。",
              "Normalized input and output cost.",
            )}
          />
          <DecisionCard
            title={t("看能力变化", "Capability change")}
            body={t(
              "区分上下文、多模态和工具调用，不用笼统的“更强”。",
              "Separate context, modality and tool use.",
            )}
          />
          <DecisionCard
            title={t("看可用范围", "Availability")}
            body={t(
              "明确 API、产品端和预览状态，避免把发布等同于可用。",
              "Distinguish API, product and preview access.",
            )}
          />
        </div>

        <div className="paper-card overflow-x-auto">
          <table className="min-w-[820px] w-full text-sm">
            <thead className="border-b border-border bg-card text-xs text-muted-foreground">
              <tr>
                <th className="w-52 px-5 py-4 text-left font-medium">
                  {t("决策维度", "Decision dimension")}
                </th>
                {chosen.map((model) => (
                  <th key={model.id} className="px-5 py-4 text-left font-semibold text-signal">
                    <Link
                      to="/knowledge/model/$slug"
                      params={{ slug: model.slug }}
                      className="hover:underline"
                    >
                      {pick(model.name, lang)}
                    </Link>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              <Row
                label={t("厂商", "Vendor")}
                values={chosen.map((model) => model.vendor ?? "—")}
              />
              <Row
                label={t("版本标识", "Version ID")}
                values={chosen.map((model) => model.latestVersion ?? "—")}
                mono
              />
              <Row
                label={t("上下文窗口", "Context window")}
                values={chosen.map((model) => model.specs?.contextWindow ?? "系列级不适用")}
              />
              <Row
                label={t("输入价格", "Input price")}
                values={chosen.map((model) => model.specs?.inputPrice ?? "随具体版本变化")}
              />
              <Row
                label={t("输出价格", "Output price")}
                values={chosen.map((model) => model.specs?.outputPrice ?? "随具体版本变化")}
              />
              <Row
                label={t("输入模态", "Modalities")}
                values={chosen.map((model) => model.specs?.modalities ?? model.tags.join(" · "))}
              />
              <Row
                label={t("工具与 Agent", "Tools & agents")}
                values={chosen.map((model) => model.specs?.toolUse ?? "查看具体版本")}
              />
              <Row
                label={t("可用范围", "Availability")}
                values={chosen.map((model) => model.specs?.availability ?? "系列级总览")}
              />
              <Row
                label={t("首次发布", "First released")}
                values={chosen.map((model) => model.firstReleasedAt ?? "—")}
                mono
              />
              <tr>
                <td className="px-4 py-4 align-top text-muted-foreground">
                  {t("关键能力变化", "Key capability changes")}
                </td>
                {chosen.map((model) => (
                  <td key={model.id} className="px-4 py-4 align-top">
                    <ul className="space-y-2">
                      {(model.capabilities ?? []).slice(0, 4).map((capability, index) => (
                        <li key={index} className="flex items-start gap-2">
                          <ConfidenceChip level={capability.confidence} />
                          <span className="text-foreground">{pick(capability, lang)}</span>
                        </li>
                      ))}
                      {!model.capabilities?.length && (
                        <span className="text-muted-foreground">
                          {t("请选择具体版本查看", "Select a concrete version")}
                        </span>
                      )}
                    </ul>
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
          {chosen.length === 0 && (
            <div className="border-t border-border p-8 text-center text-sm text-muted-foreground">
              {t("请至少选择一个版本。", "Select at least one version.")}
            </div>
          )}
        </div>

        <p className="text-xs text-unverified">
          △{" "}
          {t(
            "本页面中的未来版本与价格为演示数据，产品决策时必须回到带日期的官方来源核对；不同缓存、批处理和地区价格不可直接混用。",
            "Future-version and price values are demo data; verify dated official sources before making a purchase decision.",
          )}
        </p>
      </div>
    </AppShell>
  );
}

function DecisionCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="paper-card p-4">
      <div className="mb-1 text-sm font-semibold text-foreground">{title}</div>
      <p className="text-xs leading-relaxed text-muted-foreground">{body}</p>
    </div>
  );
}

function Row({ label, values, mono = false }: { label: string; values: string[]; mono?: boolean }) {
  return (
    <tr>
      <td className="px-4 py-3 text-muted-foreground">{label}</td>
      {values.map((value, index) => (
        <td key={index} className={`px-4 py-3 text-foreground ${mono ? "font-mono text-xs" : ""}`}>
          {value}
        </td>
      ))}
    </tr>
  );
}
