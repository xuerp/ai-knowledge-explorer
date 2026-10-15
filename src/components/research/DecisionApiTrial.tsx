import { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { useApp } from "@/lib/app-state";
import type { DecisionValidationItem, ResearchResult } from "@/services/user-api";
import {
  apiTrialCandidates,
  apiTrialPlan,
  apiTrialReceipt,
  mergeApiTrialReceipt,
} from "@/domain/decision-api-trial";

export function DecisionApiTrial({
  research,
  items,
  entityName,
  onApply,
}: {
  research: ResearchResult;
  items: DecisionValidationItem[];
  entityName: (id: string) => string;
  onApply: (next: DecisionValidationItem[]) => void;
}) {
  const { t, lang } = useApp();
  const inputId = useId();
  const ids = apiTrialCandidates(research, items);
  const [samples, setSamples] = useState("");
  const [instruction, setInstruction] = useState(research.decisionContext?.task ?? "");
  const [minimum, setMinimum] = useState("");
  const [ceiling, setCeiling] = useState("");
  const [currency, setCurrency] = useState<"USD" | "CNY">("USD");
  const [imported, setImported] = useState<ReturnType<typeof apiTrialReceipt> | null>(null);
  const [replace, setReplace] = useState(false);
  const [message, setMessage] = useState("");
  const [file, setFile] = useState<{ url: string; name: string } | null>(null);
  useEffect(
    () => () => {
      if (file) URL.revokeObjectURL(file.url);
    },
    [file],
  );
  useEffect(() => {
    setImported(null);
    setReplace(false);
    setMessage("");
  }, [research.id]);
  if (!ids.length) return null;
  return (
    <details className="decision-api-trial decision-secondary-details">
      <summary>
        {t("自动批量 API 试测（本地运行）", "Automatic API batch trial (run locally)")}
      </summary>
      <p>
        {t(
          "如果你有模型 API 入口，可用同一批材料自动试测并回填。密钥留在你的电脑；这个网页不会上传样本或发起付费请求。此流程测 API 输出，不测 IDE 编辑文件的效果。",
          "With model API access, run the same samples automatically and import the results. Keys stay on your computer; this page sends no samples or paid requests. This tests API outputs, not IDE file editing.",
        )}
      </p>
      <p>
        {t("本批候选", "Candidates in this batch")}: {ids.map(entityName).join("、")}
      </p>
      <h4>{t("准备你自己的样本和标准", "Prepare your samples and acceptance criteria")}</h4>
      <label>
        {t("给模型的处理要求", "Processing instruction")}
        <textarea
          rows={3}
          maxLength={5000}
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
        />
      </label>
      <label>
        {t("实际样本 JSON", "Actual samples as JSON")}
        <textarea
          rows={5}
          maxLength={500000}
          value={samples}
          onChange={(e) => setSamples(e.target.value)}
          placeholder={
            '[{"id":"样本编号","input":"你有权使用的实际输入","expected":{"字段":"你标注的正确值"}}]'
          }
        />
      </label>
      <p className="decision-choice__hint">
        {t(
          "先标注正确结果。逐个样本严格核对 JSON 全部字段与值；不会让模型自己给自己打分。不要放入密码、密钥或无权发送的材料。",
          "Label expected results first. Every JSON field and value is checked exactly; models do not grade themselves. Exclude passwords, keys and material you cannot transmit.",
        )}
      </p>
      <div className="decision-api-trial__limits">
        <label>
          {t("最少合格样本数", "Minimum passing samples")}
          <input
            type="number"
            min={1}
            max={20}
            value={minimum}
            onChange={(e) => setMinimum(e.target.value)}
          />
        </label>
        <label>
          {t("本批预计费用上限", "Estimated cost ceiling for this batch")}
          <input
            type="number"
            min={0.01}
            step="any"
            value={ceiling}
            onChange={(e) => setCeiling(e.target.value)}
          />
        </label>
        <label>
          {t("计费币种", "Billing currency")}
          <select value={currency} onChange={(e) => setCurrency(e.target.value as "USD" | "CNY")}>
            <option value="USD">USD</option>
            <option value="CNY">CNY</option>
          </select>
        </label>
      </div>
      <Button
        type="button"
        variant="outline"
        onClick={() => {
          try {
            const plan = apiTrialPlan(research, ids, {
              samples,
              instruction,
              minimum: Number(minimum),
              ceiling: Number(ceiling),
              currency,
            });
            const name = `${research.id}-api-trial.json`;
            const url = URL.createObjectURL(
              new Blob([JSON.stringify(plan, null, 2)], { type: "application/json" }),
            );
            setFile({ url, name });
            const link = document.createElement("a");
            link.href = url;
            link.download = name;
            link.click();
            setMessage(
              t(
                "运行文件已准备。下一步在本地配置你能使用的 API 入口，并先预览请求与费用。",
                "Plan prepared. Configure your available API interfaces locally, then preview requests and estimated costs.",
              ),
            );
          } catch {
            setMessage(
              t(
                "请检查样本 JSON、唯一编号、正确答案、合格数量和正数费用上限；尚未发起调用。",
                "Check sample JSON, unique ids, expected answers, passing count and a positive cost ceiling. No call was sent.",
              ),
            );
          }
        }}
      >
        {t("下载自动试测文件", "Download automatic trial plan")}
      </Button>
      {file && (
        <a className="decision-api-trial__download" href={file.url} download={file.name}>
          {t("再次下载运行文件", "Download plan again")}
        </a>
      )}
      <ol>
        <li>
          {t(
            "用本地运行器填写实际 API 地址、模型标识、单价和密钥的环境变量名，先预览。",
            "Use the local runner to configure your API endpoint, model id, rates and key environment variable, then preview.",
          )}
        </li>
        <li>
          {t(
            "确认发送范围和费用后执行；最多20个样本、3个候选，默认120秒，失败保留记录并停止。",
            "Confirm data transfer and costs, then execute. Up to 20 samples and 3 candidates, default 120 seconds. Failures stop with a saved receipt.",
          )}
        </li>
        <li>
          {t(
            "将生成的 receipt.json 导入下面，预览后回填；最后点击本页“保存结果，更新判断”。",
            "Import receipt.json below, preview and apply it, then use Save actual results on this page.",
          )}
        </li>
      </ol>
      <a
        className="text-signal hover:underline"
        href="https://github.com/xuerp/ai-knowledge-explorer/blob/main/docs/AUTOMATIC_API_TRIALS.md"
        target="_blank"
        rel="noreferrer"
      >
        {t("打开本地运行步骤", "Open local execution instructions")}
      </a>
      <h4>{t("导入并核对执行记录", "Import and inspect execution records")}</h4>
      <label htmlFor={inputId}>{t("选择本地 receipt.json", "Choose local receipt.json")}</label>
      <input
        id={inputId}
        type="file"
        accept="application/json,.json"
        onChange={async (event) => {
          const selected = event.target.files?.[0];
          setImported(null);
          setReplace(false);
          if (!selected) return;
          try {
            if (selected.size > 2_000_000) throw new Error("large");
            setImported(apiTrialReceipt(research, await selected.text(), lang));
            setMessage(
              t(
                "已读取，尚未回填或保存。请核对候选、批次和失败记录。",
                "Read locally, not applied or saved. Check candidates, batch and failures.",
              ),
            );
          } catch {
            setMessage(
              t(
                "记录不完整、格式不符或不属于当前分析。请选择原始 receipt.json；现有记录没有改变。",
                "Receipt is incomplete, invalid or belongs to another decision. Select the original receipt.json; existing records are unchanged.",
              ),
            );
          }
          event.target.value = "";
        }}
      />
      {imported && (
        <div className="decision-api-trial__preview">
          <ul>
            {imported.summaries.map((summary, index) => (
              <li key={summary}>
                {entityName(imported.receipt.results[index].candidateId)} · {summary}
              </li>
            ))}
          </ul>
          <p>
            {t(
              "这些是你导入的私人 API 执行记录，不是已审核公开事实。费用是估算；时延是否达标、实际扣费和数据条款仍需核对。",
              "These imported private API records are not verified public facts. Costs are estimates; latency fitness, actual billing and data terms still require checks.",
            )}
          </p>
          <label className="decision-api-trial__replace">
            <input
              type="checkbox"
              checked={replace}
              onChange={(e) => setReplace(e.target.checked)}
            />
            {t(
              "允许替换本批候选已有的效果、时延与费用记录（条款记录保留）",
              "Allow replacing this batch's existing quality, latency and cost records (preserve terms)",
            )}
          </label>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              try {
                const currentImport = apiTrialReceipt(
                  research,
                  JSON.stringify(imported.receipt),
                  lang,
                );
                onApply(mergeApiTrialReceipt(items, currentImport, replace));
                setImported(null);
                setMessage(
                  t(
                    "已回填未保存草稿。核对后点击“保存结果，更新判断”；条款记录保持原样。",
                    "Applied to the unsaved draft. Inspect it, then Save actual results; terms remain unchanged.",
                  ),
                );
              } catch {
                setMessage(
                  t(
                    "已有结果受到保护。请先备份原记录，或明确勾选允许替换后再回填。",
                    "Existing results are protected. Back them up, or explicitly allow replacement before applying.",
                  ),
                );
              }
            }}
          >
            {t("回填到本页草稿", "Apply to this page's draft")}
          </Button>
        </div>
      )}
      {message && (
        <p role="status" aria-live="polite">
          {message}
        </p>
      )}
    </details>
  );
}
