import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/layout/AppShell";
import { DataStatePanel } from "@/components/data-state";
import { ResearchReport } from "@/components/research/ResearchReport";
import { useKnowledgeSnapshot } from "@/hooks/use-knowledge";
import { useApp } from "@/lib/app-state";

export const Route = createFileRoute("/research/$id")({
  head: () => ({
    meta: [
      { title: "研究记录 · AI Radar" },
      {
        name: "description",
        content: "包含逐结论引用、研究过程和可信边界的 AI Radar 研究记录。",
      },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: ResearchRecordPage,
});

function ResearchRecordPage() {
  const { t } = useApp();
  const { id } = Route.useParams();
  const snapshotQuery = useKnowledgeSnapshot();

  if (!snapshotQuery.data) {
    return (
      <AppShell>
        <DataStatePanel
          kind={snapshotQuery.unavailableKind}
          title={t(
            snapshotQuery.error ? "研究记录加载失败" : "正在加载研究记录",
            snapshotQuery.error ? "Research record failed to load" : "Loading research record",
          )}
          description={t("请检查连接后重试。", "Check the connection and retry.")}
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
          title={t("研究记录不存在", "Research record not found")}
          description={t(
            "这份记录不在当前快照中，可能尚未生成或已被移除。",
            "This record is not present in the current snapshot.",
          )}
        />
      </AppShell>
    );
  }

  return (
    <AppShell>
      <ResearchReport answer={answer} snapshot={snapshotQuery.data} />
    </AppShell>
  );
}
