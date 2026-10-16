import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useApp } from "@/lib/app-state";
import {
  emptyTrialSample,
  type TrialSampleDraft,
  type TrialSampleField,
} from "@/domain/decision-trial-samples";

export function DecisionTrialSamples({
  samples,
  onChange,
}: {
  samples: TrialSampleDraft[];
  onChange: (samples: TrialSampleDraft[]) => void;
}) {
  const { t } = useApp();
  const update = (index: number, patch: Partial<TrialSampleDraft>) =>
    onChange(samples.map((sample, i) => (i === index ? { ...sample, ...patch } : sample)));
  const field = (sampleIndex: number, fieldIndex: number, patch: Partial<TrialSampleField>) =>
    update(sampleIndex, {
      fields: samples[sampleIndex].fields.map((value, i) =>
        i === fieldIndex ? { ...value, ...patch } : value,
      ),
    });
  return (
    <div className="decision-trial-samples">
      <p className="decision-choice__hint">
        {t(
          "填写你自己的材料和人工确认的正确结果。字段类型决定严格核对方式；这些内容只用于准备本批试测，不会自动发送或产生分数。",
          "Supply your own inputs and human-checked expected results. Types control exact matching. Preparing samples does not send requests or produce scores.",
        )}
      </p>
      {samples.map((sample, sampleIndex) => (
        <fieldset key={sample.id} className="decision-trial-samples__sample">
          <legend>{t(`样本 ${sampleIndex + 1}`, `Sample ${sampleIndex + 1}`)}</legend>
          <div className="decision-trial-samples__header">
            <label>
              {t("输入材料", "Input material")}
              <textarea
                rows={3}
                maxLength={20000}
                value={sample.input}
                onChange={(event) => update(sampleIndex, { input: event.target.value })}
              />
            </label>
            <Button
              type="button"
              variant="ghost"
              disabled={samples.length === 1}
              onClick={() => onChange(samples.filter((_, i) => i !== sampleIndex))}
            >
              <Trash2 aria-hidden="true" />
              {t("删除样本", "Remove sample")}
            </Button>
          </div>
          <p className="decision-trial-samples__label">{t("应该返回的字段", "Expected fields")}</p>
          {sample.fields.map((item, fieldIndex) => (
            <div className="decision-trial-samples__field" key={fieldIndex}>
              <label>
                {t("字段名", "Field name")}
                <input
                  maxLength={100}
                  value={item.name}
                  onChange={(event) => field(sampleIndex, fieldIndex, { name: event.target.value })}
                />
              </label>
              <label>
                {t("值类型", "Value type")}
                <select
                  aria-label={t("值类型", "Value type")}
                  value={item.type}
                  onChange={(event) =>
                    field(sampleIndex, fieldIndex, {
                      type: event.target.value as TrialSampleField["type"],
                    })
                  }
                >
                  <option value="text">{t("文字", "Text")}</option>
                  <option value="number">{t("数字", "Number")}</option>
                  <option value="boolean">{t("是 / 否", "True / false")}</option>
                  <option value="null">{t("空值 null", "Null")}</option>
                  <option value="json">{t("嵌套 JSON", "Nested JSON")}</option>
                </select>
              </label>
              <label>
                {t("正确值", "Expected value")}
                {item.type === "boolean" ? (
                  <select
                    aria-label={t("正确值", "Expected value")}
                    value={item.value === "true" || item.value === "false" ? item.value : ""}
                    onChange={(event) =>
                      field(sampleIndex, fieldIndex, { value: event.target.value })
                    }
                  >
                    <option value="">{t("请选择", "Choose")}</option>
                    <option value="true">{t("是（true）", "True")}</option>
                    <option value="false">{t("否（false）", "False")}</option>
                  </select>
                ) : item.type === "json" ? (
                  <textarea
                    rows={2}
                    maxLength={20000}
                    value={item.value}
                    onChange={(event) =>
                      field(sampleIndex, fieldIndex, { value: event.target.value })
                    }
                  />
                ) : (
                  <input
                    disabled={item.type === "null"}
                    value={item.type === "null" ? "null" : item.value}
                    maxLength={20000}
                    inputMode={item.type === "number" ? "decimal" : undefined}
                    onChange={(event) =>
                      field(sampleIndex, fieldIndex, { value: event.target.value })
                    }
                  />
                )}
              </label>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={sample.fields.length === 1}
                aria-label={t(
                  `删除样本 ${sampleIndex + 1} 的字段 ${fieldIndex + 1}`,
                  `Remove field ${fieldIndex + 1} from sample ${sampleIndex + 1}`,
                )}
                onClick={() =>
                  update(sampleIndex, { fields: sample.fields.filter((_, i) => i !== fieldIndex) })
                }
              >
                <Trash2 aria-hidden="true" />
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="link"
            disabled={sample.fields.length >= 50}
            onClick={() =>
              update(sampleIndex, {
                fields: [...sample.fields, { name: "", type: "text", value: "" }],
              })
            }
          >
            <Plus aria-hidden="true" />
            {t("添加字段", "Add field")}
          </Button>
        </fieldset>
      ))}
      <Button
        type="button"
        variant="outline"
        disabled={samples.length >= 20}
        onClick={() => onChange([...samples, emptyTrialSample(crypto.randomUUID())])}
      >
        <Plus aria-hidden="true" />
        {t("添加样本", "Add sample")}
      </Button>
    </div>
  );
}
