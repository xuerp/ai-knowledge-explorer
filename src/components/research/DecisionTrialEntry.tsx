import { useEffect, useState } from "react";
import { useApp } from "@/lib/app-state";
import { Button } from "@/components/ui/button";
import type { DecisionContext, DecisionValidationItem, ResearchResult } from "@/services/user-api";
import {
  groupValidationItems,
  validationDimension,
  type ValidationItemPatch,
} from "@/domain/decision-validation-view";
import { DecisionMeasurements } from "./DecisionMeasurements";
import { DecisionTrialKit } from "./DecisionTrialKit";

/** A short entry path into the existing records, without a second data format. */
export function DecisionTrialEntry({
  items,
  priority,
  entityName,
  onChange,
  onReuse,
  requestedCandidate,
  research,
}: {
  items: DecisionValidationItem[];
  priority: DecisionContext["priority"];
  entityName: (id: string) => string;
  onChange: (id: string, patch: ValidationItemPatch) => void;
  onReuse: (sourceId: string) => void;
  requestedCandidate?: { id: string; nonce: number };
  research: ResearchResult;
}) {
  const { t } = useApp();
  const [selected, setSelected] = useState("");
  const [expanded, setExpanded] = useState(
    () => !groupValidationItems(items).some((row) => row.recorded),
  );
  const requestedId = requestedCandidate?.id;
  const requestedNonce = requestedCandidate?.nonce;
  useEffect(() => {
    if (!requestedId) return;
    setSelected(requestedId);
    setExpanded(true);
  }, [requestedId, requestedNonce]);
  const groups = groupValidationItems(items).filter(
    (group) =>
      group.candidateId &&
      group.items.filter((item) => validationDimension(item.id) === "terms").length === 1 &&
      group.items.filter((item) => validationDimension(item.id) === "quality").length <= 1,
  );
  const group = groups.find((row) => row.candidateId === selected) ?? groups[0];
  if (!group) return null;
  const quality = group.items.find((item) => validationDimension(item.id) === "quality");
  const terms = group.items.find((item) => validationDimension(item.id) === "terms")!;
  const source = quality ?? terms;
  const numeric = group.items.find(
    (item) => validationDimension(item.id) === (priority === "cost" ? "cost" : "latency"),
  );
  const fields = [
    ["modelVersion", t("具体版本与实际使用入口", "Exact version and actual interface")],
    [
      "configuration",
      t(
        "配置、工具和环境（比较时保持一致）",
        "Configuration, tools and environment (match across trials)",
      ),
    ],
    ["sampleCount", t("本批样本总数", "Total samples in this batch")],
    ["testedAt", t("实际测试日期", "Actual test date")],
    ["scope", t("使用的样本及合格标准", "Samples and acceptance criteria")],
  ] as const;
  return (
    <details
      className="decision-trial-entry"
      open={expanded}
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
      <summary>
        {quality
          ? t("准备任务，再记录试用结果", "Prepare the task, then record results")
          : t("填写资格核验记录", "Record qualification checks")}
      </summary>
      <p>
        {quality
          ? t(
              "先把任务带到你已有的模型入口执行。试用结束后，展开下方填写实际结果；没有试用过可以先保存计划。",
              "Run the task in your existing model interface first. After the trial, expand the form below to record actual results. You can save the plan before testing.",
            )
          : t(
              "先记录实际入口和必要条件的核对依据。这里没有业务效果测试，保存也不会把未知公开资格变成通过。",
              "Record evidence for interfaces and requirements. These are not task tests; saving cannot promote unknown public eligibility.",
            )}
      </p>
      <label>
        {t("当前填写的候选", "Candidate being recorded")}
        <select value={group.candidateId!} onChange={(event) => setSelected(event.target.value)}>
          {groups.map((row) => (
            <option key={row.candidateId} value={row.candidateId!}>
              {entityName(row.candidateId!)}
            </option>
          ))}
        </select>
      </label>
      {quality && group.candidateId && (
        <DecisionTrialKit
          research={research}
          candidateId={group.candidateId}
          entityName={entityName}
        />
      )}
      {quality?.suggestedProtocol && (
        <details className="decision-secondary-details">
          <summary>
            {t("查看建议样本与合格标准", "Inspect suggested samples and acceptance criteria")}
          </summary>
          <p>{quality.suggestedProtocol.sample}</p>
          <ul>
            {quality.suggestedProtocol.acceptance.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <p>
            {t(
              "这是尚未执行的建议，实际采用的口径由你填写。",
              "This suggestion has not been executed; record the conditions you actually use.",
            )}
          </p>
        </details>
      )}
      <details className="decision-trial-entry__results" open={quality ? undefined : true}>
        <summary>
          {quality
            ? t("已经试用过？填写实际结果", "Finished your trial? Record actual results")
            : t("填写入口与必要条件", "Record interface and required conditions")}
        </summary>
        <div className="decision-trial-entry__fields">
          {fields.map(([key, label]) => (
            <label key={key}>
              {label}
              <input
                type={key === "sampleCount" ? "number" : "text"}
                min={key === "sampleCount" ? 1 : undefined}
                maxLength={
                  key === "configuration" || key === "scope" ? 1000 : key === "testedAt" ? 10 : 200
                }
                placeholder={
                  key === "testedAt"
                    ? "YYYY-MM-DD"
                    : key === "modelVersion"
                      ? t("填写实际使用的产品、版本和入口", "Actual product, version and interface")
                      : key === "configuration"
                        ? t(
                            "提示词、工具权限、参数或环境",
                            "Prompt, tool permissions, settings or environment",
                          )
                        : key === "scope"
                          ? t(
                              "实际样本范围、必需字段或验收测试",
                              "Actual samples, required fields or acceptance tests",
                            )
                          : undefined
                }
                value={source.testConditions?.[key] ?? ""}
                onChange={(event) =>
                  onChange(source.id, {
                    testConditions: {
                      [key]:
                        key === "sampleCount"
                          ? event.target.value === ""
                            ? null
                            : Number(event.target.value)
                          : event.target.value,
                    },
                  })
                }
              />
            </label>
          ))}
        </div>
        <Button type="button" variant="outline" onClick={() => onReuse(source.id)}>
          {t(
            "将口径填入本候选其余空字段",
            "Reuse these conditions in this candidate's empty fields",
          )}
        </Button>
        <p className="decision-choice__hint">
          {t(
            "仅填空字段，已有不同配置不覆盖；状态、结果和数值不会自动变成通过。",
            "Only empty fields are filled. Existing settings, statuses, results and measurements stay unchanged.",
          )}
        </p>
        {(quality ? [quality, terms] : [terms]).map((item) => (
          <fieldset key={item.id}>
            <legend>
              {item.id === quality?.id
                ? t("任务是否达到标准", "Did the task meet your criteria?")
                : t(
                    "实际入口和数据条款是否核验",
                    "Were the actual interface and data terms verified?",
                  )}
            </legend>
            <label>
              {t("核验状态", "Check status")}
              <select
                value={item.status}
                onChange={(event) =>
                  onChange(item.id, {
                    status: event.target.value as DecisionValidationItem["status"],
                  })
                }
              >
                <option value="pending">{t("待验证", "Pending")}</option>
                <option value="passed">{t("实测通过", "Passed")}</option>
                <option value="failed">{t("实测未通过", "Failed")}</option>
                <option value="blocked">{t("缺少验证条件", "Blocked")}</option>
              </select>
            </label>
            <label>
              {t("实际结果与依据", "Actual result and evidence")}
              <textarea
                rows={3}
                maxLength={3000}
                value={item.result}
                onChange={(event) => onChange(item.id, { result: event.target.value })}
              />
            </label>
            {item.id === quality?.id && ["quality", "balanced"].includes(priority) && (
              <div className="decision-trial-entry__fields">
                {(["successfulSamples", "minimumSuccessfulSamples"] as const).map((key) => (
                  <label key={key}>
                    {key === "successfulSamples"
                      ? t("实际合格样本数", "Successful samples")
                      : t(
                          "试测前约定最低合格数",
                          "Minimum successful samples agreed before testing",
                        )}
                    <input
                      type="number"
                      min={key === "successfulSamples" ? 0 : 1}
                      step={1}
                      value={item.measurements?.[key] ?? ""}
                      onChange={(event) =>
                        onChange(item.id, {
                          measurements: {
                            [key]: event.target.value === "" ? null : Number(event.target.value),
                          },
                        })
                      }
                    />
                  </label>
                ))}
              </div>
            )}
            {item.id === terms.id && ["privacy", "control"].includes(priority) && (
              <DecisionMeasurements item={item} onChange={(patch) => onChange(item.id, patch)} />
            )}
          </fieldset>
        ))}
        {["cost", "speed"].includes(priority) && numeric && (
          <>
            <p>
              {t(
                "你的首要优先项还需要下面的数值和实际结果。请在完整记录中明确标记该项状态，未测项不会参与主选。",
                "Your main priority also needs the measurements and results below. Explicitly set its status in the full records; untested checks do not drive a choice.",
              )}
            </p>
            <DecisionMeasurements
              item={numeric}
              onChange={(patch) => onChange(numeric.id, patch)}
            />
          </>
        )}
        <p className="decision-choice__hint">
          {t(
            "填写后点击下方“保存结果，更新判断”。更多耗时、费用和不同口径可在完整记录中填写。",
            "Use Save results and update advice below. Full records support timing, cost and different conditions.",
          )}
        </p>
      </details>
    </details>
  );
}
