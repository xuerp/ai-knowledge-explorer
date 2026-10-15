import { useEffect, useRef, useState } from "react";
import { Copy, Download, Check } from "lucide-react";
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
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const [copied, setCopied] = useState(false);
  const [message, setMessage] = useState("");
  const [file, setFile] = useState<{ url: string; name: string } | null>(null);
  useEffect(
    () => () => {
      if (file) URL.revokeObjectURL(file.url);
    },
    [file],
  );
  useEffect(() => {
    setFile(null);
    setCopied(false);
    setMessage("");
  }, [candidateId, research.id, lang]);
  if (!kit) return null;
  const download = (format: "html" | "md") => {
    const url = URL.createObjectURL(
      new Blob([format === "html" ? kit.html : kit.markdown], {
        type: format === "html" ? "text/html;charset=utf-8" : "text/markdown;charset=utf-8",
      }),
    );
    const name = `${research.id}-${candidateId}-trial.${format}`;
    setFile({ url, name });
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    setMessage(
      t(
        "任务说明已准备，下载不会开始试测。",
        "Instructions prepared. Downloading does not start a trial.",
      ),
    );
  };
  return (
    <section
      className="decision-trial-kit"
      aria-label={t("带到现有产品执行的试用任务", "Trial task for your existing product")}
    >
      <h4>
        {t(
          `把任务带到 ${entityName(candidateId)} 中试一次`,
          `Try this task in ${entityName(candidateId)}`,
        )}
      </h4>
      <p className="decision-trial-kit__intro">
        {t(
          "复制下面的提示，粘贴到你已有的产品入口，并附上实际材料。用过以后，再切换到“记录实际结果”。",
          "Copy the prompt into your existing product and attach actual inputs. After trying it, switch to Record actual results.",
        )}
      </p>
      <div className="decision-trial-kit__actions">
        <Button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(kit.prompt);
              setCopied(true);
              setMessage(
                t(
                  "已复制。现在去所选产品中粘贴，并附上实际材料。",
                  "Copied. Paste into your chosen product and attach actual inputs.",
                ),
              );
            } catch {
              setCopied(false);
              promptRef.current?.focus();
              promptRef.current?.select();
              setMessage(
                t(
                  "浏览器未允许自动复制。提示已选中，请按 Ctrl/Cmd+C 复制。",
                  "Automatic copying was blocked. The prompt is selected; press Ctrl/Cmd+C.",
                ),
              );
            }
          }}
        >
          {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
          {copied ? t("已复制任务", "Task copied") : t("复制试用任务", "Copy trial task")}
        </Button>
        <Button type="button" variant="outline" onClick={() => download("html")}>
          <Download aria-hidden="true" />
          {t("下载任务说明", "Download instructions")}
        </Button>
        <Button type="button" variant="ghost" onClick={() => download("md")}>
          Markdown
        </Button>
      </div>
      <aside className="decision-note">
        <span>{t("需要的材料", "Inputs needed")}</span>
        <p>{kit.starterInputs}</p>
      </aside>
      <label className="decision-trial-kit__prompt-label">
        {t("可直接复制的任务提示", "Task prompt to copy")}
        <textarea
          ref={promptRef}
          readOnly
          rows={7}
          aria-label={t("试用任务提示", "Trial task prompt")}
          value={kit.prompt}
        />
      </label>

      <p className="decision-choice__hint">
        {t(
          "下载是可选项：排版版可离线阅读或打印，Markdown 适合编辑器。任务说明不会自动调用产品或产生测试成绩。",
          "Download is optional: the formatted version is for offline reading or printing; Markdown is for editors. Instructions do not invoke a product or create scores.",
        )}
      </p>
      {message && (
        <p role="status" className="decision-trial-kit__feedback">
          {message}
          {file && (
            <>
              {" "}
              <a className="decision-control-link" href={file.url} download={file.name}>
                {t("重新下载", "Download again")}
              </a>
            </>
          )}
        </p>
      )}
      <details className="decision-secondary-details">
        <summary>{t("操作步骤与合格标准", "Procedure and acceptance criteria")}</summary>
        <ol>
          {kit.protocol.procedure.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ol>
        <ul>
          {kit.protocol.acceptance.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </details>
    </section>
  );
}
