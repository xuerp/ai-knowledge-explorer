import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useApp } from "@/lib/app-state";
import { decisionTrialKit } from "@/domain/decision-trial-kit";
import type { ResearchResult } from "@/services/user-api";

export function DecisionTrialKit({
  research,
  candidateId,
  entityName,
}: {
  research: ResearchResult;
  candidateId: string;
  entityName: (id: string) => string;
}) {
  const { t, lang } = useApp();
  const kit = decisionTrialKit(research, [candidateId], entityName, lang);
  const [file, setFile] = useState<{ url: string; name: string } | null>(null);
  useEffect(
    () => () => {
      if (file) URL.revokeObjectURL(file.url);
    },
    [file],
  );
  useEffect(() => {
    setFile(null);
  }, [candidateId, research.id, lang]);
  if (!kit) return null;
  return (
    <section
      className="decision-trial-kit"
      aria-label={t("带到现有产品执行的试用任务", "Trial task for your existing product")}
    >
      <h4>{t("先做一次实际试用，再填写结果", "Run an actual trial, then record its results")}</h4>
      <ol>
        <li>
          <strong>{t("准备材料", "Prepare inputs")}</strong>
          <p>{kit.protocol.sample}</p>
        </li>
        <li>
          <strong>{t("在你已有的入口执行", "Run in your existing interface")}</strong>
          <p>
            {t(
              "把任务包中的提示和实际样本带到所选产品。先定合格标准，再执行；这里不会自动调用模型或产生测试成绩。",
              "Use the kit prompt and actual samples in the selected product. Define acceptance criteria before execution. This page does not invoke a model or generate test scores.",
            )}
          </p>
        </li>
        <li>
          <strong>{t("核对并保存实际结果", "Check and save actual results")}</strong>
          <p>{kit.protocol.acceptance.join(" ")}</p>
        </li>
      </ol>
      <Button
        type="button"
        variant="outline"
        onClick={() => {
          const url = URL.createObjectURL(
            new Blob([kit.markdown], { type: "text/markdown;charset=utf-8" }),
          );
          const name = `${research.id}-${candidateId}-trial-kit.md`;
          setFile({ url, name });
          const anchor = document.createElement("a");
          anchor.href = url;
          anchor.download = name;
          anchor.click();
        }}
      >
        {t("下载这次试用任务包", "Download this trial kit")}
      </Button>
      {file && (
        <p role="status">
          <a className="decision-choice__link" href={file.url} download={file.name}>
            {t("任务包已生成，点击保存", "Kit generated; click to save")}
          </a>
        </p>
      )}
      <details className="decision-secondary-details">
        <summary>
          {t("查看可带到产品入口的任务提示", "Inspect the task prompt for your product")}
        </summary>
        <textarea
          readOnly
          rows={8}
          aria-label={t("试用任务提示", "Trial task prompt")}
          value={kit.prompt}
        />
        <p className="decision-choice__hint">
          {t(
            "这是待执行任务，不是实际交付。你还需提供输入样本、具体字段或验收测试。",
            "This is an unexecuted task, not a deliverable. Supply input samples, specific fields or acceptance tests.",
          )}
        </p>
      </details>
    </section>
  );
}
