import { useCallback, useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Trash2 } from "lucide-react";
import { visiblePageNumbers } from "@/domain/change-navigation";
import { Button } from "@/components/ui/button";
import { useApp } from "@/lib/app-state";
import { userApi, type ResearchHistoryPage } from "@/services/user-api";
import "./research-history.css";

const PAGE_SIZE = 5;

/** The owner's saved results, so reopening never depends on tab storage. */
export function ResearchHistory({ token }: { token: string }) {
  const { t, lang } = useApp();
  const [confirming, setConfirming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [page, setPage] = useState(0);
  // `undefined` while loading, `null` when the page could not load.
  const [data, setData] = useState<ResearchHistoryPage | null | undefined>(undefined);
  const load = useCallback(
    async (index: number) => {
      if (!token) return;
      try {
        const next = await userApi.researchHistory(token, index * PAGE_SIZE, PAGE_SIZE);
        // A deletion can leave the last page empty; step back to a real page.
        if (!next.items.length && next.total > 0 && index > 0) {
          setPage(Math.ceil(next.total / PAGE_SIZE) - 1);
          return;
        }
        setData(next);
      } catch {
        setData(null);
      }
    },
    [token],
  );
  useEffect(() => {
    void load(page);
  }, [load, page]);
  const history = data === undefined ? undefined : data ? data.items : null;
  const total = data?.total ?? 0;
  const pageCount = Math.ceil(total / PAGE_SIZE);
  const pageIndex = Math.min(page, Math.max(0, pageCount - 1));
  const shown = history ?? [];
  const pageNumbers = visiblePageNumbers(pageIndex, pageCount);
  const remove = async (id: string) => {
    setDeleting(id);
    setError("");
    try {
      await userApi.deleteResearch(token, id);
      setConfirming(null);
      await load(page);
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
        {total > 0 && <span>{t(`共 ${total} 条`, `${total} records`)}</span>}
      </div>
      {error && (
        <p role="alert" className="research-history__error">
          {error}
        </p>
      )}
      {history === undefined ? (
        <p className="research-history__empty" role="status">
          {t("正在加载研究记录…", "Loading research…")}
        </p>
      ) : history === null ? (
        <p className="research-history__empty" role="status">
          {t("记录暂时无法加载，刷新页面后重试。", "Records could not load. Reload to retry.")}
        </p>
      ) : total === 0 ? (
        <p className="research-history__empty">
          {t(
            "还没有研究记录。在“帮我选择”提交一次后，结果会保存在这里。",
            "No research yet. Results are saved here after you submit a task.",
          )}
        </p>
      ) : (
        <ul className="research-history__list">
          {shown.map((item) => (
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
      {pageCount > 1 && (
        <nav
          className="updates-pagination research-history__pagination"
          aria-label={t("研究记录分页", "Research pagination")}
        >
          <span>
            {t(
              `第 ${pageIndex * PAGE_SIZE + 1}–${Math.min((pageIndex + 1) * PAGE_SIZE, total)} 条，共 ${total} 条`,
              `${pageIndex * PAGE_SIZE + 1}–${Math.min((pageIndex + 1) * PAGE_SIZE, total)} of ${total}`,
            )}
          </span>
          <div className="updates-pagination__controls">
            <button type="button" disabled={pageIndex === 0} onClick={() => setPage(pageIndex - 1)}>
              {t("上一页", "Previous")}
            </button>
            <div className="updates-pagination__numbers">
              {pageNumbers[0] > 0 && <span aria-hidden="true">…</span>}
              {pageNumbers.map((index) => (
                <button
                  key={index}
                  type="button"
                  aria-label={t(`第 ${index + 1} 页`, `Page ${index + 1}`)}
                  aria-current={pageIndex === index ? "page" : undefined}
                  onClick={() => setPage(index)}
                >
                  {index + 1}
                </button>
              ))}
              {pageNumbers.at(-1)! < pageCount - 1 && <span aria-hidden="true">…</span>}
            </div>
            <button
              type="button"
              disabled={pageIndex + 1 >= pageCount}
              onClick={() => setPage(pageIndex + 1)}
            >
              {t("下一页", "Next")}
            </button>
          </div>
        </nav>
      )}
    </section>
  );
}
