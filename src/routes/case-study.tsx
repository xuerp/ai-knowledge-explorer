import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/layout/AppShell";
import { WorkspaceHeader } from "@/components/common";
import { useApp } from "@/lib/app-state";
import status from "../../product/delivery-status.json";

export const Route = createFileRoute("/case-study")({
  head: () => ({
    meta: [
      { title: "项目介绍 · AI Radar" },
      { name: "description", content: "AI Radar 的产品流程、工程设计与当前验收进度。" },
    ],
  }),
  component: CaseStudyPage,
});

function CaseStudyPage() {
  const { t } = useApp();
  return (
    <AppShell>
      <main className="workspace-page pb-16">
        <WorkspaceHeader
          title={t("项目介绍", "About this project")}
          description={t(
            "了解 AI Radar 的用途、工程设计与当前进度。",
            "Explore AI Radar's purpose, engineering and delivery status.",
          )}
        />
        <div className="mx-auto w-[calc(100%-2rem)] max-w-[70rem] space-y-8 pt-8">
          <section className="paper-card p-6">
            <h2 className="text-xl font-semibold">
              {t("让 AI 技术选型有据可查", "Make AI technology choices traceable")}
            </h2>
            <p className="mt-3 leading-7 text-muted-foreground">
              {t(
                "AI Radar 把分散的模型公告、能力描述和使用条件整理为动态、知识与关系，帮助用户查变化、看依据，再结合任务开展选型研究。下面介绍产品流程与工程设计，也可以直接进入功能开始使用。",
                "AI Radar organizes model announcements, capabilities and usage conditions into updates, knowledge and relationships for task-based research. Explore the product workflow and engineering below, or follow the links to start using it.",
              )}
            </p>
            <nav
              aria-label={t("产品功能", "Product features")}
              className="mt-5 flex flex-wrap gap-x-6 gap-y-3 text-sm font-medium text-primary"
            >
              <Link to="/updates">{t("查看动态", "Updates")} →</Link>
              <Link to="/knowledge">{t("浏览知识库", "Knowledge")} →</Link>
              <Link to="/graph">{t("探索关系", "Graph")} →</Link>
              <Link to="/ask">{t("决策助手", "Decision assistant")} →</Link>
            </nav>
          </section>
          <section aria-labelledby="delivery-heading">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="delivery-heading" className="text-xl font-semibold">
                {t("当前项目进度", "Current delivery status")}
              </h2>
              <span className="text-sm text-muted-foreground">
                {t("记录更新", "Record updated")}: {status.updatedAt}
              </span>
            </div>
            <p className="mt-3 font-medium">{t(status.summary.zh, status.summary.en)}</p>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {t(status.boundary.zh, status.boundary.en)}
            </p>
            <div className="paper-card mt-5 divide-y divide-border">
              {status.modules.map((module) => (
                <article
                  key={module.name.en}
                  className="grid gap-4 p-5 md:grid-cols-[12rem_1fr_1.3fr]"
                >
                  <h3 className="font-semibold">{t(module.name.zh, module.name.en)}</h3>
                  <div>
                    <p className="mb-1 text-xs text-muted-foreground">
                      {t("已实现范围", "Implemented scope")}
                    </p>
                    <p className="text-sm leading-6">
                      {t(module.implemented.zh, module.implemented.en)}
                    </p>
                  </div>
                  <div>
                    <p className="mb-1 text-xs text-muted-foreground">
                      {t("验证与待完成项", "Verification and remaining work")}
                    </p>
                    <p className="text-sm leading-6">{t(module.verified.zh, module.verified.en)}</p>
                  </div>
                </article>
              ))}
            </div>
          </section>
          <div className="grid gap-6 md:grid-cols-2">
            <section className="paper-card p-6">
              <h2 className="text-xl font-semibold">{t("使用流程", "User journey")}</h2>
              <ol className="mt-4 list-decimal space-y-3 pl-5 text-sm leading-7">
                <li>
                  {t(
                    "从动态进入模型、产品或模型家族。",
                    "Open a model, product or family from updates.",
                  )}
                </li>
                <li>
                  {t(
                    "核对知识、版本差异、关系和原始来源。",
                    "Check facts, version differences, relationships and sources.",
                  )}
                </li>
                <li>
                  {t(
                    "结合任务开展研究，登录后保存、修改和导出报告。",
                    "Research a task, then sign in to save, revise and export reports.",
                  )}
                </li>
              </ol>
            </section>
            <section className="paper-card p-6">
              <h2 className="text-xl font-semibold">{t("工程设计", "Engineering choices")}</h2>
              <ul className="mt-4 list-disc space-y-3 pl-5 text-sm leading-7">
                <li>
                  {t(
                    "对象、事实与证据分离，动态与研究共享知识目录。",
                    "Entities, claims and evidence are separate; updates and research share the catalog.",
                  )}
                </li>
                <li>
                  {t(
                    "采集候选需审核后发布，公共知识与个人研究分开保存。",
                    "Collected candidates require review; public knowledge and private research are stored separately.",
                  )}
                </li>
                <li>
                  {t(
                    "保留来源限制与未知条件；证据数量不作为能力排名，未知价格不视为免费。",
                    "Preserve source limitations and unknown conditions; evidence counts are not rankings and unknown prices are not free.",
                  )}
                </li>
              </ul>
            </section>
          </div>
          <section className="border-t border-border pt-6">
            <h2 className="text-lg font-semibold">{t("代码与验证记录", "Code and validation")}</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {t(
                "本页进度与项目验证文档来自同一份记录。数据数量不等于核验质量，测试通过不等于完整产品已验收。",
                "This page and the project validation documents share one status record. Data volume does not establish quality, and passing tests does not establish full product acceptance.",
              )}
            </p>
            <div className="mt-4 flex flex-wrap gap-5 text-sm text-primary">
              <a href="https://github.com/xuerp/ai-knowledge-explorer">GitHub / README</a>
              <a href="https://github.com/xuerp/ai-knowledge-explorer/blob/main/docs/portfolio/VALIDATION.md">
                {t("验证记录", "Validation record")}
              </a>
              <Link to="/quality">{t("数据质量", "Data quality")}</Link>
            </div>
          </section>
        </div>
      </main>
    </AppShell>
  );
}
