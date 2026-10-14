import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { adminApi, type ReviewQueueItem } from "@/services/admin-api";

export function ReviewRevisionForm({
  item,
  token,
  onCreated,
}: {
  item: ReviewQueueItem;
  token: string;
  onCreated: (created: ReviewQueueItem) => void;
}) {
  const [textZh, setTextZh] = useState(item.claim.text.zh);
  const [textEn, setTextEn] = useState(item.claim.text.en);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<ReviewQueueItem | null>(null);
  const [attempt, setAttempt] = useState<{ fingerprint: string; key: string } | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || created) return;
    const content = { textZh: textZh.trim(), textEn: textEn.trim(), reason: reason.trim() };
    const fingerprint = JSON.stringify(content);
    const key = attempt?.fingerprint === fingerprint ? attempt.key : crypto.randomUUID();
    setAttempt({ fingerprint, key });
    setBusy(true);
    setError("");
    try {
      const result = await adminApi.reviseCandidate(token, item, {
        ...content,
        idempotencyKey: key,
      });
      setCreated(result);
      onCreated(result);
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "修订未提交。保留输入，可重试或刷新后复核。",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="mt-3 border-t border-border pt-3">
      <summary className="cursor-pointer text-sm font-medium">修订为待审候选</summary>
      <p className="mt-2 text-sm text-muted-foreground">
        对照原文补充或纠正中英文表述。原记录、证据摘录、结构字段、事实有效期和来源日期保留；新候选仍需单独审核，已公开事实需经“替代此事实”才会更新。
      </p>
      {created ? (
        <p className="mt-3 text-sm" role="status">
          修订已进入待审队列，原事实保留。请到“待审核队列”核验并决定是否发布。
        </p>
      ) : (
        <form className="mt-3 space-y-3" onSubmit={submit}>
          <label className="block space-y-1 text-sm">
            <span>中文事实</span>
            <Textarea
              aria-label="中文事实"
              value={textZh}
              onChange={(event) => setTextZh(event.target.value)}
              required
              maxLength={10000}
              rows={4}
              disabled={busy}
            />
          </label>
          <label className="block space-y-1 text-sm">
            <span>英文事实</span>
            <Textarea
              aria-label="英文事实"
              value={textEn}
              onChange={(event) => setTextEn(event.target.value)}
              required
              maxLength={10000}
              rows={4}
              disabled={busy}
            />
          </label>
          <label className="block space-y-1 text-sm">
            <span>修订理由</span>
            <Input
              aria-label="修订理由"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              required
              minLength={3}
              maxLength={500}
              disabled={busy}
            />
          </label>
          {error && (
            <p className="text-sm text-conflict" role="alert">
              {error}
            </p>
          )}
          <Button type="submit" disabled={busy || !item.evidenceItems.length}>
            {busy ? "正在创建待审修订…" : "创建待审修订"}
          </Button>
        </form>
      )}
    </details>
  );
}
