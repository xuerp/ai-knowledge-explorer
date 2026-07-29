import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { DataStatePanel } from "@/components/data-state";
import { ResearchReport } from "@/components/research/ResearchReport";
import { useKnowledgeSnapshot } from "@/hooks/use-knowledge";
import { useApp } from "@/lib/app-state";
import { userApi, type PublishedResearch } from "@/services/user-api";

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
  const [liveResearch, setLiveResearch] = useState<PublishedResearch | null>(null);
  const [liveError, setLiveError] = useState("");

  useEffect(() => {
    if (!userApi.configured) return;
    userApi
      .publicResearch(id)
      .then(setLiveResearch)
      .catch((reason: unknown) =>
        setLiveError(reason instanceof Error ? reason.message : "Public research failed to load."),
      );
  }, [id]);

  if (userApi.configured) {
    if (liveError) {
      return (
        <AppShell>
          <DataStatePanel
            kind="error"
            title={t("公开研究页加载失败", "Public research failed to load")}
            description={liveError}
          />
        </AppShell>
      );
    }
    if (!liveResearch) {
      return (
        <AppShell>
          <DataStatePanel
            kind="loading"
            title={t("正在加载公开研究页", "Loading public research")}
            description={t(
              "正在校验已发布记录和引用。",
              "Validating the published record and citations.",
            )}
          />
        </AppShell>
      );
    }
    return (
      <AppShell>
        <article className="print-report mx-auto max-w-4xl space-y-7 px-4 py-10 md:px-6">
          <header>
            <div className="text-xs font-medium uppercase tracking-widest text-signal">
              {t("用户主动公开", "Published by the user")}
            </div>
            <h1 className="mt-2 font-serif text-3xl font-semibold md:text-4xl">
              {liveResearch.question}
            </h1>
            <div className="mt-3 text-sm text-muted-foreground">{liveResearch.status}</div>
          </header>
          <section className="paper-card p-6">
            <h2 className="font-serif text-xl font-semibold">{t("结论", "Answer")}</h2>
            <div className="mt-4 whitespace-pre-wrap text-sm leading-relaxed">
              {liveResearch.summary}
            </div>
          </section>
          <section className="space-y-3">
            <h2 className="font-serif text-2xl font-semibold">{t("引用与来源", "Citations")}</h2>
            {liveResearch.citations.map((citation) => (
              <div key={citation.claim.id} className="paper-card p-5">
                <div className="font-mono text-xs text-muted-foreground">
                  {citation.claim.id} · {citation.claim.confidence}
                </div>
                <p className="mt-2 text-sm">{t(citation.claim.text.zh, citation.claim.text.en)}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {citation.evidence.map((source) => (
                    <a
                      key={source.id}
                      href={source.url}
                      target="_blank"
                      rel="noreferrer"
                      className="chip hover:text-foreground"
                    >
                      {source.publisher} · {source.publishedAt}
                    </a>
                  ))}
                </div>
              </div>
            ))}
          </section>
        </article>
      </AppShell>
    );
  }

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
