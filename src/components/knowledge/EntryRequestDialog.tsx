import { useRef, useState, type FormEvent } from "react";
import { CheckCircle2, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useApp } from "@/lib/app-state";
import { userApi } from "@/services/user-api";
import type { EntryRequestPayload, EntryRequestReceipt } from "@/services/entry-request-types";

export function EntryRequestDialog() {
  const { t } = useApp();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [entityType, setEntityType] = useState<EntryRequestPayload["entityType"]>("model");
  const [sourceUrl, setSourceUrl] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<EntryRequestReceipt | null>(null);
  const submission = useRef<{ fingerprint: string; id: string } | null>(null);
  const inFlight = useRef(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    const fields = {
      name: name.trim(),
      entityType,
      sourceUrl: sourceUrl.trim(),
      reason: reason.trim(),
    };
    let url: URL;
    try {
      url = new URL(fields.sourceUrl);
    } catch {
      setError(t("请填写有效的官方来源网址。", "Enter a valid official source URL."));
      return;
    }
    if (url.protocol !== "https:" || url.username || url.password) {
      setError(
        t("请填写不含登录凭据的 HTTPS 官方来源。", "Use an HTTPS source URL without credentials."),
      );
      return;
    }
    if (fields.name.length < 2 || fields.reason.length < 10) {
      setError(
        t(
          "名称至少 2 个字符，收录理由至少 10 个字符。",
          "Use at least 2 characters for the name and 10 for the reason.",
        ),
      );
      return;
    }
    if (!userApi.configured) {
      setError(
        t(
          "提交服务未连接，填写内容已保留。",
          "The service is disconnected; your inputs are preserved.",
        ),
      );
      return;
    }
    const fingerprint = JSON.stringify(fields);
    if (submission.current?.fingerprint !== fingerprint)
      submission.current = { fingerprint, id: crypto.randomUUID() };
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      const result = await userApi.submitEntryRequest({
        ...fields,
        requestId: submission.current.id,
      });
      setReceipt(result);
    } catch {
      setError(
        t(
          "提交未能确认，填写内容已保留。请检查连接后重试；重试不会重复创建同一请求。",
          "Submission could not be confirmed. Inputs are preserved; check the connection and retry without creating a duplicate.",
        ),
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  function changeOpen(next: boolean) {
    if (busy && !next) return;
    if (next && receipt) {
      setReceipt(null);
      setName("");
      setSourceUrl("");
      setReason("");
      submission.current = null;
      setError("");
    }
    setOpen(next);
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild>
        <button type="button">{t("提交收录请求", "Request an entry")}</button>
      </DialogTrigger>
      <DialogContent
        className="entry-request-dialog"
        onEscapeKeyDown={busy ? (event) => event.preventDefault() : undefined}
        onInteractOutside={busy ? (event) => event.preventDefault() : undefined}
      >
        <DialogHeader>
          <DialogTitle>
            {receipt
              ? t("收录请求已收到", "Request received")
              : t("提交收录请求", "Request an entry")}
          </DialogTitle>
          <DialogDescription>
            {receipt
              ? t(
                  "请求已保存，等待人工审核；审核后才会进入知识库。",
                  "Saved for staff review before it can enter the knowledge base.",
                )
              : t(
                  "请提供对象名称、官方来源和收录理由。无需注册。",
                  "Provide a name, official source and reason. No account required.",
                )}
          </DialogDescription>
        </DialogHeader>
        {receipt ? (
          <div className="entry-request-receipt" role="status">
            <CheckCircle2 aria-hidden="true" />
            <p>{t("请求编号", "Request ID")}</p>
            <code>{receipt.id}</code>
            <p>
              {t("状态", "Status")}：
              {
                {
                  pending: t("待审核", "Pending review"),
                  "in-review": t("处理中", "In review"),
                  resolved: t("已收录", "Resolved"),
                  rejected: t("不收录", "Rejected"),
                }[receipt.status]
              }
            </p>
            <Button type="button" onClick={() => changeOpen(false)}>
              {t("完成", "Done")}
            </Button>
          </div>
        ) : (
          <form className="entry-request-form" onSubmit={(event) => void submit(event)}>
            <fieldset disabled={busy}>
              <label htmlFor="entry-name">{t("对象名称", "Name")}</label>
              <Input
                id="entry-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                required
                minLength={2}
                maxLength={120}
                autoComplete="off"
              />
              <label htmlFor="entry-type">{t("对象类型", "Type")}</label>
              <select
                id="entry-type"
                value={entityType}
                onChange={(event) =>
                  setEntityType(event.target.value as EntryRequestPayload["entityType"])
                }
              >
                {(
                  [
                    ["model", "模型", "Model"],
                    ["product", "应用产品（IDE / 工作台）", "Application (IDE / workbench)"],
                    ["organization", "组织", "Organization"],
                    ["tool", "工具 / SDK / 框架", "Tool / SDK / framework"],
                    ["paper", "论文", "Paper"],
                    ["benchmark", "评测", "Evaluation"],
                    ["other", "其他", "Other"],
                  ] as const
                ).map(([value, zh, en]) => (
                  <option key={value} value={value}>
                    {t(zh, en)}
                  </option>
                ))}
              </select>
              <small>
                {t(
                  "按提交对象本身选择：完整应用选产品；SDK、框架或独立工具选工具。Agent 描述任务执行方式，也可以是产品；审核时会核对具体入口与用途。",
                  "Classify the submitted object: choose Product for a full application, or Tool for an SDK, framework or standalone utility. Agent describes task execution and may also be a product; review checks the specific surface and purpose.",
                )}
              </small>
              <label htmlFor="entry-source">{t("官方来源网址", "Official source URL")}</label>
              <Input
                id="entry-source"
                type="url"
                inputMode="url"
                value={sourceUrl}
                onChange={(event) => setSourceUrl(event.target.value)}
                placeholder="https://"
                required
                maxLength={2048}
                aria-describedby="entry-source-help"
              />
              <small id="entry-source-help">
                {t(
                  "填写官方产品页、文档或论文地址。",
                  "Use an official product, documentation or paper URL.",
                )}
              </small>
              <label htmlFor="entry-reason">{t("收录理由", "Reason")}</label>
              <Textarea
                id="entry-reason"
                rows={3}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                required
                minLength={10}
                maxLength={2000}
                placeholder={t(
                  "它是什么，为什么值得追踪？至少 10 个字符。",
                  "What is it and why track it? At least 10 characters.",
                )}
              />
            </fieldset>
            {error && (
              <p role="alert" className="entry-request-error">
                {error}
              </p>
            )}
            {!userApi.configured && (
              <p role="status">
                {t(
                  "当前环境尚未连接提交服务。",
                  "Submission service is not connected in this environment.",
                )}
              </p>
            )}
            <div className="entry-request-actions">
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => changeOpen(false)}
              >
                {t("取消", "Cancel")}
              </Button>
              <Button type="submit" disabled={busy || !userApi.configured}>
                {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                {busy ? t("正在提交…", "Submitting…") : t("提交请求", "Submit request")}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
