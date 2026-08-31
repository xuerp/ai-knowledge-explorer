import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { Button } from "@/components/ui/button";
import { DataStatePanel } from "@/components/data-state";
import { ResearchReport } from "@/components/research/ResearchReport";
import { RetrievalStatus } from "@/components/research/RetrievalStatus";
import type { ResearchAnswer } from "@/domain/types";
import { useKnowledgeSnapshot } from "@/hooks/use-knowledge";
import { useApp } from "@/lib/app-state";
import { readAuthToken } from "@/services/auth-session";
import { userApi, type ResearchResult } from "@/services/user-api";

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
  const [liveResearch, setLiveResearch] = useState<ResearchResult | null>(null);
  const [liveError, setLiveError] = useState("");
  const token = readAuthToken();

  useEffect(() => {
    if (!userApi.configured || !token) return;
    userApi
      .researchDetail(token, id)
      .then(setLiveResearch)
      .catch((reason: unknown) =>
        setLiveError(reason instanceof Error ? reason.message : "Research record failed to load."),
      );
  }, [id, token]);

  const liveAnswer = useMemo<ResearchAnswer | null>(() => {
    if (!liveResearch) return null;
    return {
      id: liveResearch.id,
      question: { zh: liveResearch.question, en: liveResearch.question },
      summary: { zh: liveResearch.summary, en: liveResearch.summary },
      claimIds: liveResearch.claimIds,
      steps: liveResearch.steps,
      generatedAt: liveResearch.createdAt,
      status: liveResearch.status,
    };
  }, [liveResearch]);

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

  if (userApi.configured) {
    if (!token) {
      return (
        <AppShell>
          <DataStatePanel
            kind="empty"
            title={t("登录后查看私密研究", "Sign in to view private research")}
            description={t(
              "私密研究记录只属于创建它的账户，不会自动公开。",
              "Private research belongs only to the account that created it and is never public by default.",
            )}
          />
          <div className="mx-auto max-w-3xl px-4 pb-10 text-center">
            <Button asChild>
              <Link to="/account">{t("前往登录", "Go to sign in")}</Link>
            </Button>
          </div>
        </AppShell>
      );
    }
    if (liveError) {
      return (
        <AppShell>
          <DataStatePanel
            kind="error"
            title={t("研究记录加载失败", "Research record failed to load")}
            description={liveError}
          />
        </AppShell>
      );
    }
    if (!liveAnswer || !liveResearch) {
      return (
        <AppShell>
          <DataStatePanel
            kind="loading"
            title={t("正在加载私密研究", "Loading private research")}
            description={t("正在校验账户和引用。", "Validating account access and citations.")}
          />
        </AppShell>
      );
    }
    return (
      <AppShell>
        <div className="mx-auto max-w-5xl px-4 pt-6 md:px-6">
          <RetrievalStatus research={liveResearch} />
        </div>
        <ResearchReport answer={liveAnswer} snapshot={snapshotQuery.data} dataMode="live" />
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
