import { Link } from "@tanstack/react-router";
import { useApp } from "@/lib/app-state";
import type { ResearchSummary } from "@/services/user-api";

/** The owner's saved results, so reopening never depends on tab storage. */
export function ResearchHistory({ history }: { history: ResearchSummary[] | null }) {
  const { t, lang } = useApp();
  return (
    <section aria-labelledby="research-history-heading" className="paper-card p-5">
      <h2 id="research-history-heading" className="font-serif text-xl font-semibold">
        {t("我的研究记录", "My research")}
      </h2>
      {history === null ? (
        <p className="mt-3 text-sm text-muted-foreground" role="status">
          {t("记录暂时无法加载，刷新页面后重试。", "Records could not load. Reload to retry.")}
        </p>
      ) : history.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          {t(
            "还没有研究记录。在“帮我选择”提交一次后，结果会保存在这里。",
            "No research yet. Results are saved here after you submit a task.",
          )}
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-border">
          {history.map((item) => (
            <li key={item.id} className="py-3">
              <Link
                to="/research/$id"
                params={{ id: item.id }}
                className="block font-medium text-foreground hover:text-signal hover:underline"
              >
                {item.headline || item.question}
              </Link>
              <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{item.question}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {new Date(item.createdAt).toLocaleString(lang === "zh" ? "zh-CN" : "en")}
                {" · "}
                {item.modelLed
                  ? t("模型分析", "Model analysis")
                  : item.answerMode === "generated"
                    ? t("模型生成", "Model generated")
                    : t("资料摘录", "Evidence excerpt")}
                {item.publishedSlug ? t(" · 已公开", " · Public") : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
