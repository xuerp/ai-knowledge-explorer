import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/layout/AppShell";
import { DataStatePanel } from "@/components/data-state";
import { ResearchReport } from "@/components/research/ResearchReport";
import { useKnowledgeSnapshot } from "@/hooks/use-knowledge";
import { useApp } from "@/lib/app-state";

export const Route = createFileRoute("/share/$id")({
  head: () => ({
    meta: [
      { title: "公开研究页 · AI Radar" },
      {
        name: "description",
        content: "由用户主动公开、保留逐结论引用和证据边界的 AI Radar 研究页面。",
      },
      { property: "og:type", content: "article" },
    ],
  }),
  component: PublicResearchPage,
});

function PublicResearchPage() {
  const { t } = useApp();
  const { id } = Route.useParams();
  const snapshotQuery = useKnowledgeSnapshot();

  if (!snapshotQuery.data) {
    return (
      <AppShell>
        <DataStatePanel
          kind={snapshotQuery.unavailableKind}
          title={t(
            snapshotQuery.error ? "公开研究页加载失败" : "正在加载公开研究页",
            snapshotQuery.error ? "Public research failed to load" : "Loading public research",
          )}
          description={t(
            "无法读取来源时不会显示不完整结论。",
            "Incomplete conclusions are not shown when sources cannot be loaded.",
          )}
          onRetry={snapshotQuery.error ? () => snapshotQuery.refetch() : undefined}
        />
      </AppShell>
    );
  }

  const answer = snapshotQuery.data.researchAnswers.find((item) => item.id === id);
  if (!answer) {
    return (
      <AppShell>
        <DataStatePanel
          kind="empty"
          title={t("公开研究页不存在", "Public research page not found")}
          description={t(
            "该记录尚未公开，或不在当前演示快照中。",
            "This record is not public or is absent from the current snapshot.",
          )}
        />
      </AppShell>
    );
  }

  return (
    <AppShell>
      <ResearchReport answer={answer} snapshot={snapshotQuery.data} publicView />
    </AppShell>
  );
}
