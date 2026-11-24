import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useApp } from "@/lib/app-state";
import type { ResearchSummary } from "@/services/user-api";
import "./research-history.css";

/** The owner's saved results, so reopening never depends on tab storage. */
export function ResearchHistory({
  history,
  onDelete,
}: {
  history: ResearchSummary[] | null;
  onDelete: (id: string) => Promise<void>;
}) {
  const { t, lang } = useApp();
  const [confirming, setConfirming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState("");
  const remove = async (id: string) => {
    setDeleting(id);
    setError("");
    try {
      await onDelete(id);
      setConfirming(null);
    } catch {
      setError(t("删除失败，请稍后重试。", "Could not delete. Try again later."));
    } finally {
      setDeleting(null);
    }
  };
  return (
    <section aria-labelledby="research-history-heading" className="paper-card research-history">
      <div className="research-history__header">
        <h2 id="research-history-heading" className="font-serif">
          {t("我的研究记录", "My research")}
        </h2>
        {history && history.length > 0 && (
          <span>{t(`${history.length} 条`, `${history.length} records`)}</span>
        )}
      </div>
      {error && (
        <p role="alert" className="research-history__error">
          {error}
        </p>
      )}
      {history === null ? (
        <p className="research-history__empty" role="status">
          {t("记录暂时无法加载，刷新页面后重试。", "Records could not load. Reload to retry.")}
        </p>
      ) : history.length === 0 ? (
        <p className="research-history__empty">
          {t(
            "还没有研究记录。在“帮我选择”提交一次后，结果会保存在这里。",
            "No research yet. Results are saved here after you submit a task.",
          )}
        </p>
      ) : (
        <ul className="research-history__list">
          {history.map((item) => (
            <li key={item.id} className="research-history__item">
              <div className="research-history__body">
                <Link
                  to="/research/$id"
                  params={{ id: item.id }}
                  className="research-history__title"
                >
                  {item.headline || item.question}
                </Link>
                <p className="research-history__question">
                  <span>{t("提问：", "Asked: ")}</span>
                  {item.question}
                </p>
                <p className="research-history__meta">
                  <span
                    className="research-history__badge"
                    data-kind={item.modelLed ? "model" : "rules"}
                  >
                    {item.modelLed
                      ? t("模型分析", "Model analysis")
                      : item.answerMode === "generated"
                        ? t("模型生成", "Model generated")
                        : t("资料摘录", "Evidence excerpt")}
                  </span>
                  <time dateTime={item.createdAt}>
                    {new Date(item.createdAt).toLocaleString(lang === "zh" ? "zh-CN" : "en")}
                  </time>
                  {item.publishedSlug && <span>{t("已公开", "Public")}</span>}
                </p>
              </div>
              <div className="research-history__actions">
                {confirming === item.id ? (
                  <div role="group" aria-label={t("确认删除", "Confirm deletion")}>
                    <p>
                      {item.publishedSlug
                        ? t(
                            "删除后无法恢复，公开链接也会失效。",
                            "This cannot be undone and the public link will stop working.",
                          )
                        : t("删除后无法恢复。", "This cannot be undone.")}
                    </p>
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={deleting === item.id}
                      onClick={() => void remove(item.id)}
                    >
                      {deleting === item.id ? t("删除中…", "Deleting…") : t("确认删除", "Delete")}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={deleting === item.id}
                      onClick={() => setConfirming(null)}
                    >
                      {t("取消", "Cancel")}
                    </Button>
                  </div>
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setConfirming(item.id)}
                    aria-label={t(
                      `删除“${item.headline || item.question}”`,
                      `Delete “${item.headline || item.question}”`,
                    )}
                  >
                    <Trash2 aria-hidden="true" />
                    {t("删除", "Delete")}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
