import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/layout/AppShell";
import { WorkspaceHeader } from "@/components/common";
import { useApp } from "@/lib/app-state";

export const Route = createFileRoute("/case-study")({
  head: () => ({
    meta: [
      { title: "项目介绍 · AI Radar" },
      {
        name: "description",
        content: "了解 AI Radar 如何连接模型动态、来源证据与任务，帮助开展 AI 选型研究。",
      },
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
            "从了解模型到开展选型研究，看看资料与任务如何连接起来。",
            "See how model information and task requirements come together for selection research.",
          )}
        />
        <div className="mx-auto w-[calc(100%-2rem)] max-w-[70rem] space-y-8 pt-8">
          <section className="paper-card p-6">
            <h2 className="text-xl font-semibold">
              {t("让 AI 技术选型有据可查", "Make AI technology choices traceable")}
            </h2>
            <p className="mt-3 leading-7 text-muted-foreground">
              {t(
                "模型更新很快，能力、价格和使用条件却散落在不同资料里。AI Radar 把这些信息整理到一起，让你先了解变化，再核对依据，最后结合自己的任务判断哪些选择值得试用。",
                "Models change quickly, while capabilities, prices and usage conditions are scattered across sources. AI Radar brings them together so you can explore changes, check the evidence and decide which options to try for your task.",
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
          <div className="grid gap-6 md:grid-cols-2">
            <section className="paper-card p-6">
              <h2 className="text-xl font-semibold">{t("从哪里开始", "Where to start")}</h2>
              <ol className="mt-4 list-decimal space-y-3 pl-5 text-sm leading-7">
                <li>
                  {t(
                    "看变化：从动态了解模型发布、价格调整与服务下线。",
                    "Explore changes: follow model releases, price changes and retirements.",
                  )}
                </li>
                <li>
                  {t(
                    "查依据：打开模型档案，比较版本差异，查看使用条件与原始来源。",
                    "Check the evidence: open a model profile to compare versions, usage conditions and original sources.",
                  )}
                </li>
                <li>
                  {t(
                    "做研究：向决策助手描述任务，整理候选与试用计划；登录后可保存、修改和导出。",
                    "Research a task: use the decision assistant to organize candidates and a trial plan. Sign in to save, revise and export.",
                  )}
                </li>
              </ol>
            </section>
            <section className="paper-card p-6">
              <h2 className="text-xl font-semibold">
                {t("产品设计思路", "Product design choices")}
              </h2>
              <ul className="mt-4 list-disc space-y-3 pl-5 text-sm leading-7">
                <li>
                  {t(
                    "让结论可追溯：事实与来源分开记录，在浏览和研究时都能回到依据。",
                    "Keep conclusions traceable: record facts and sources separately, with evidence available in both browsing and research.",
                  )}
                </li>
                <li>
                  {t(
                    "把版本看清楚：区分模型家族、具体版本与产品入口，保留各自的使用条件。",
                    "Make versions clear: distinguish model families, specific versions and product interfaces, with their own usage conditions.",
                  )}
                </li>
                <li>
                  {t(
                    "围绕任务做选择：先看预算、部署与功能要求，再准备适合实际场景的试用。",
                    "Start from the task: consider budget, deployment and functional requirements, then prepare a relevant trial.",
                  )}
                </li>
              </ul>
            </section>
          </div>
          <section className="border-t border-border pt-6" aria-labelledby="project-scope-heading">
            <h2 id="project-scope-heading" className="text-xl font-semibold">
              {t("关于这个项目", "About the project")}
            </h2>
            <p className="mt-3 leading-7">
              {t("个人实践项目，正在持续完善。", "A personal project under active development.")}
            </p>
            <dl className="mt-4 grid gap-5 text-sm leading-7 md:grid-cols-3">
              <div>
                <dt className="font-semibold">{t("资料范围", "Information scope")}</dt>
                <dd className="mt-1 text-muted-foreground">
                  {t(
                    "以已收录资料为基础，包含示例内容；来源、日期与核验状态随条目展示。",
                    "Based on cataloged material, including sample content. Each entry shows its sources, dates and verification status.",
                  )}
                </dd>
              </div>
              <div>
                <dt className="font-semibold">{t("更新方式", "How updates work")}</dt>
                <dd className="mt-1 text-muted-foreground">
                  {t(
                    "页面同步后台已发布资料，来源的收录与审核持续维护。",
                    "Pages sync published records from the knowledge base. Source collection and review are maintained separately.",
                  )}
                </dd>
              </div>
              <div>
                <dt className="font-semibold">{t("研究与试用", "Research and trials")}</dt>
                <dd className="mt-1 text-muted-foreground">
                  {t(
                    "研究帮助梳理选择依据，具体效果需要结合你的实际任务试用判断。",
                    "Research helps you reason about options. Try them on your own tasks to assess their results.",
                  )}
                </dd>
              </div>
            </dl>
          </section>
          <section className="border-t border-border pt-6">
            <h2 className="text-lg font-semibold">{t("进一步了解", "Explore further")}</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {t(
                "查看项目源码、数据口径与实现记录。",
                "Explore the source code, data methodology and implementation records.",
              )}
            </p>
            <div className="mt-4 flex flex-wrap gap-5 text-sm text-primary">
              <a href="https://github.com/xuerp/ai-knowledge-explorer">GitHub / README</a>
              <a href="https://github.com/xuerp/ai-knowledge-explorer/blob/main/docs/portfolio/VALIDATION.md">
                {t("实现与验证记录", "Implementation and validation")}
              </a>
              <Link to="/quality">{t("数据质量", "Data quality")}</Link>
            </div>
          </section>
        </div>
      </main>
    </AppShell>
  );
}
