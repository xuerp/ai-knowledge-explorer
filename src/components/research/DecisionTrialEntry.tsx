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
  const [step, setStep] = useState<"prepare" | "record">(() =>
    groupValidationItems(items).some((row) => row.recorded) ? "record" : "prepare",
  );
  const requestedId = requestedCandidate?.id;
  const requestedNonce = requestedCandidate?.nonce;
  useEffect(() => {
    if (!requestedId) return;
    setSelected(requestedId);
    setStep("prepare");
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
    <section className="decision-trial-entry">
      <div
        className="decision-trial-entry__steps"
        role="group"
        aria-label={t("试用步骤", "Trial steps")}
      >
        {quality && (
          <Button
            type="button"
            variant={step === "prepare" ? "default" : "outline"}
            aria-pressed={step === "prepare"}
            onClick={() => setStep("prepare")}
          >
            {t("准备试用任务", "Prepare trial task")}
          </Button>
        )}
        <Button
          type="button"
          variant={step === "record" || !quality ? "default" : "outline"}
          aria-pressed={step === "record" || !quality}
          onClick={() => setStep("record")}
        >
          {t("记录实际结果", "Record actual results")}
        </Button>
      </div>
      {groups.length > 1 ? (
        <label>
          {t("当前产品", "Current product")}
          <select value={group.candidateId!} onChange={(event) => setSelected(event.target.value)}>
            {groups.map((row) => (
              <option key={row.candidateId} value={row.candidateId!}>
                {entityName(row.candidateId!)}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <p className="decision-trial-entry__product">
          {t("当前产品：", "Current product: ")}
          <strong>{entityName(group.candidateId!)}</strong>
        </p>
      )}
      <div hidden={!!quality && step !== "prepare"}>
        {quality && group.candidateId && (
          <DecisionTrialKit
            research={research}
            candidateId={group.candidateId}
            entityName={entityName}
          />
        )}
      </div>
      <section className="decision-trial-entry__results" hidden={!!quality && step !== "record"}>
        <h4>
          {quality
            ? t("记录这次实际试用", "Record this trial")
            : t("核对入口与使用条件", "Verify access and conditions")}
        </h4>
        <aside className="decision-note">
          <span>{t("填写说明", "How to fill this in")}</span>
          <p>
            {t(
              "只填写你已经执行的结果。尚未运行的项目保留“待验证”，保存不会自动标记通过。",
              "Record only work you have executed. Leave untested checks pending; saving does not mark them passed.",
            )}
          </p>
        </aside>
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
                aria-label={t("实际结果与依据", "Actual result and evidence")}
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
      </section>
    </section>
  );
}
