import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { specFieldLabel } from "@/domain/spec-fields";
import { adminApi, type SpecUpdateCandidate } from "@/services/admin-api";

/** Reviewed spec facts that differ from the curated entity card; nothing is overwritten. */
export function SpecUpdatesPanel({ token, canAdopt }: { token: string; canAdopt: boolean }) {
  const [rows, setRows] = useState<SpecUpdateCandidate[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(() => {
    setBusy(true);
    setError("");
    adminApi
      .specUpdateCandidates(token)
      .then(setRows)
      .catch(() => setError("规格核对结果暂时无法加载，请重试。"))
      .finally(() => setBusy(false));
  }, [token]);
  useEffect(load, [load]);

  const key = (row: SpecUpdateCandidate) => `${row.entityId}:${row.field}`;
  const adopt = async (row: SpecUpdateCandidate) => {
    const value = (drafts[key(row)] ?? row.factValue).trim();
    if (!value) return;
    setBusy(true);
    setError("");
    try {
      await adminApi.adoptSpecUpdate(token, {
        entityId: row.entityId,
        field: row.field,
        claimId: row.claimId,
        value,
      });
      setMessage(`已更新 ${row.entityName.zh} 的${specFieldLabel(row.field)}：${value}`);
      load();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "更新失败，请重试。");
      setBusy(false);
    }
  };

  return (
    <section className="paper-card p-5" aria-labelledby="spec-updates-title">
      <h2 id="spec-updates-title" className="font-serif text-xl font-semibold">
        待更新的规格（{rows.length}）
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        已审核的规格事实与实体卡片上的值不同时列在这里。写法不同但数值相同的不会列出；卡片不会被自动改写。
      </p>
      {message && <p className="mt-3 text-sm text-verified">{message}</p>}
      {error && <p className="mt-3 text-sm text-conflict">{error}</p>}
      {busy && rows.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">正在核对…</p>
      ) : rows.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">卡片规格与最新审核事实一致。</p>
      ) : (
        <div className="mt-4 divide-y divide-border">
          {rows.map((row) => (
            <article key={key(row)} className="py-4 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="text-sm font-medium">
                  {row.entityName.zh} · {specFieldLabel(row.field)}
                </h3>
                {row.validFrom && (
                  <span className="text-xs text-muted-foreground">生效 {row.validFrom}</span>
                )}
              </div>
              <dl className="mt-2 grid gap-1 text-sm sm:grid-cols-[6rem_1fr]">
                <dt className="text-muted-foreground">卡片现值</dt>
                <dd>{row.cardValue ?? "—"}</dd>
                <dt className="text-muted-foreground">审核事实</dt>
                <dd>
                  {row.factValue}
                  <span className="block text-xs text-muted-foreground">{row.claimText.zh}</span>
                </dd>
              </dl>
              {canAdopt && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Input
                    aria-label={`采用后的${specFieldLabel(row.field)}写法`}
                    className="h-9 max-w-xs"
                    value={drafts[key(row)] ?? row.factValue}
                    onChange={(event) =>
                      setDrafts((current) => ({ ...current, [key(row)]: event.target.value }))
                    }
                  />
                  <Button size="sm" disabled={busy} onClick={() => void adopt(row)}>
                    采用到卡片
                  </Button>
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
