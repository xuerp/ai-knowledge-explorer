import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { adminApi } from "@/services/admin-api";
import type { EntryRequestDecision, EntryRequestView } from "@/services/entry-request-types";
import type { Entity } from "@/domain/types";
import { useEntities } from "@/hooks/use-knowledge";

const labels = { pending: "待审核", "in-review": "处理中", resolved: "已收录", rejected: "不收录" };

export function EntryRequestsPanel({ token }: { token: string }) {
  const catalog = useEntities();
  const entities = catalog.data ?? [];
  const [rows, setRows] = useState<EntryRequestView[]>([]);
  const [offset, setOffset] = useState(0);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [status, setStatus] = useState("all");
  const [query, setQuery] = useState("");
  const [hasNext, setHasNext] = useState(false);
  useEffect(() => {
    const reload = () => setRefresh((value) => value + 1);
    window.addEventListener("focus", reload);
    return () => window.removeEventListener("focus", reload);
  }, []);
  useEffect(() => {
    let active = true;
    setBusy(true);
    setError("");
    adminApi
      .entryRequests(token, offset, status, query)
      .then((data) => {
        if (active) {
          setRows(data.slice(0, 20));
          setHasNext(data.length > 20);
        }
      })
      .catch(() => {
        if (active) setError("收录请求暂时无法加载，请重试。");
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [token, offset, refresh, status, query]);
  const changed = useCallback(() => {
    setOffset(0);
    setRefresh((value) => value + 1);
  }, []);
  return (
    <section className="paper-card entry-requests-panel p-5" aria-labelledby="entry-requests-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="entry-requests-title" className="text-xl font-semibold">
            收录请求
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            已提交的对象在这里处理；待审核请求不会直接出现在知识库。
          </p>
        </div>
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => {
            setOffset(0);
            void catalog.refetch();
            setRefresh((value) => value + 1);
          }}
        >
          刷新请求
        </Button>
      </div>
      <p className="entry-requests-panel__workflow">
        核对官方资料 → <a href="#catalog-editor">在目录编辑器收录对象</a> → 选择对象并完成审核。
        已收录后可直接打开资料页。决策补证必须关联原具体版本，先审核启用缺失事实；仅关联已有对象不能标记补证完成。
      </p>
      <div className="entry-requests-panel__filters">
        <Input
          aria-label="搜索收录请求"
          placeholder="搜索名称，例如 WorkBuddy、Trae"
          value={query}
          maxLength={120}
          onChange={(event) => {
            setQuery(event.target.value);
            setOffset(0);
          }}
        />
        <select
          aria-label="收录请求状态"
          value={status}
          onChange={(event) => {
            setStatus(event.target.value);
            setOffset(0);
          }}
        >
          <option value="all">全部状态</option>
          {Object.entries(labels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>
      {error && (
        <p className="mt-3 text-destructive" role="alert">
          {error}
        </p>
      )}
      {busy ? (
        <p className="mt-3" role="status">
          正在加载请求…
        </p>
      ) : error ? null : !rows.length ? (
        <p className="mt-3 text-muted-foreground">
          {query || status !== "all"
            ? "没有匹配请求，可清除搜索或切换状态。"
            : "尚无收录请求。成功提交后会保存在这里；可刷新查看。"}
        </p>
      ) : (
        <div className="mt-4 space-y-3">
          {rows.map((row) => (
            <EntryRequestRow
              key={row.id}
              row={row}
              entities={entities}
              token={token}
              onChange={changed}
            />
          ))}
        </div>
      )}
      {(offset > 0 || hasNext) && (
        <div className="mt-4 flex flex-wrap items-center justify-end gap-3">
          <Button
            variant="outline"
            disabled={busy || offset === 0}
            onClick={() => setOffset((value) => Math.max(0, value - 20))}
          >
            上一页请求
          </Button>
          <span>第 {offset / 20 + 1} 页</span>
          <Button
            variant="outline"
            disabled={busy || !hasNext || Boolean(error)}
            onClick={() => setOffset((value) => value + 20)}
          >
            下一页请求
          </Button>
        </div>
      )}
    </section>
  );
}

function EntryRequestRow({
  row,
  token,
  onChange,
  entities,
}: {
  row: EntryRequestView;
  token: string;
  onChange: (row: EntryRequestView) => void;
  entities: Entity[];
}) {
  const [note, setNote] = useState(row.reviewerNote ?? "");
  const [entityId, setEntityId] = useState(row.entityId ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [entityQuery, setEntityQuery] = useState("");
  const linked = entities.find((entity) => entity.id === entityId);
  const choices = entities.filter(
    (entity) =>
      entity.id === entityId ||
      [entity.name.zh, entity.name.en, entity.slug, ...(entity.aliases ?? [])].some((value) =>
        value.toLowerCase().includes(entityQuery.trim().toLowerCase()),
      ),
  );
  useEffect(() => {
    if (entityId || row.status === "resolved" || row.status === "rejected") return;
    const match = entities.find((entity) =>
      [entity.name.zh, entity.name.en, ...(entity.aliases ?? [])].some(
        (value) => value.toLowerCase() === row.name.toLowerCase(),
      ),
    );
    if (match) setEntityId(match.id);
  }, [entities, entityId, row.name, row.status]);
  const closed = row.status === "resolved" || row.status === "rejected";
  async function decide(status: EntryRequestDecision["status"]) {
    if (busy) return;
    if (note.trim().length < 2 || (status === "resolved" && !entityId.trim())) {
      setError(
        note.trim().length < 2
          ? "请填写核对了哪些资料及处理结论。"
          : "请选择已收录对象；如果列表里没有，请先在目录编辑器创建资料。",
      );
      return;
    }
    setBusy(true);
    setError("");
    try {
      onChange(
        await adminApi.reviewEntryRequest(token, row.id, {
          status,
          version: row.version,
          reviewerNote: note.trim(),
          ...(status === "resolved" ? { entityId: entityId.trim() } : {}),
        }),
      );
    } catch (error) {
      setError(error instanceof Error ? error.message : "更新失败，请刷新后重试。");
    } finally {
      setBusy(false);
    }
  }
  return (
    <article className="entry-request-row rounded-md border p-4">
      <div className="flex flex-wrap justify-between gap-2">
        <h3 className="font-semibold break-words">
          {row.name}{" "}
          <span className="text-sm font-normal text-muted-foreground">· {labels[row.status]}</span>
        </h3>
        <time className="text-sm text-muted-foreground" dateTime={row.createdAt}>
          {new Date(row.createdAt).toLocaleString("zh-CN")}
        </time>
      </div>
      <p className="mt-2 whitespace-pre-wrap break-words text-sm">{row.reason}</p>
      <a
        href={row.sourceUrl}
        target="_blank"
        rel="noreferrer"
        className="mt-2 block break-all text-sm text-signal underline"
      >
        {row.sourceUrl}
      </a>
      <p className="mt-2 break-all text-xs text-muted-foreground">
        {(
          {
            product: "应用产品",
            tool: "应用 / 开发工具",
            organization: "组织",
            model: "模型",
            paper: "论文",
            benchmark: "评测",
            other: "其他",
          } as Record<string, string>
        )[row.entityType] ?? row.entityType}{" "}
        · 请求编号 {row.id}
      </p>
      {closed ? (
        <p className="mt-2 text-sm">
          {row.reviewerNote}
          {linked && (
            <a
              className="ml-2 text-signal underline"
              href={
                linked.type === "model"
                  ? `/knowledge/model/${linked.slug}`
                  : `/knowledge/${linked.type}/${linked.slug}`
              }
            >
              查看 {linked.name.zh} 资料
            </a>
          )}
        </p>
      ) : (
        <details className="entry-request-row__review mt-3">
          <summary className="cursor-pointer text-sm font-medium text-signal">
            审核与关联收录
          </summary>
          <fieldset disabled={busy} className="mt-3 space-y-2">
            <label htmlFor={`note-${row.id}`} className="block text-sm">
              处理说明
            </label>
            <Textarea
              id={`note-${row.id}`}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={2000}
              rows={2}
            />
            <label htmlFor={`entity-${row.id}`} className="block text-sm">
              关联已收录对象
            </label>
            <Input
              aria-label={`搜索 ${row.name} 的关联对象`}
              value={entityQuery}
              onChange={(event) => setEntityQuery(event.target.value)}
              maxLength={120}
              placeholder="按名称搜索已收录对象"
            />
            <select
              id={`entity-${row.id}`}
              className="entry-request-row__entity"
              value={entityId}
              onChange={(event) => setEntityId(event.target.value)}
            >
              <option value="">选择已收录对象</option>
              {choices.map((entity) => (
                <option key={entity.id} value={entity.id}>
                  {entity.name.zh} · {entity.vendor || entity.type}
                </option>
              ))}
            </select>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => void decide("in-review")}>
                {busy ? "正在处理…" : "开始处理"}
              </Button>
              <Button onClick={() => void decide("resolved")}>标记已收录</Button>
              <Button variant="outline" onClick={() => void decide("rejected")}>
                不收录
              </Button>
            </div>
          </fieldset>
        </details>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      )}
    </article>
  );
}
