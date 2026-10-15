import { z } from "zod";
import type { DecisionValidationItem, ResearchResult } from "@/services/user-api";
import { candidateRecordMode } from "./decision-choice";

function currentApi(research: ResearchResult) {
  return (
    research.decisionContext?.taskType === "model-api" &&
    !Object.values(research.citationStates ?? {}).some((state) => state !== "current")
  );
}

const number = z.number().finite().nonnegative();
const sample = z
  .object({
    id: z.string().min(1).max(100),
    input: z.string().min(1).max(20000),
    expected: z.unknown(),
  })
  .refine((row) => Object.hasOwn(row, "expected"), "Each sample needs an expected result");
const planSchema = z.object({
  format: z.literal("ai-radar-api-trial-v1"),
  researchId: z.string(),
  candidateIds: z.array(z.string()).min(1).max(3),
  task: z.string().min(1).max(5000),
  instruction: z.string().min(1).max(5000),
  samples: z.array(sample).min(1).max(20),
  grader: z.enum(["json-exact", "text-exact"]),
  minimumSuccessfulSamples: z.number().int().positive(),
  maximumOutputTokens: z.number().int().min(64).max(32768),
  maximumSeconds: z.number().int().min(1).max(900),
  maximumEstimatedCost: z.number().finite().positive().max(10000),
  currency: z.enum(["USD", "CNY"]),
});
const rowSchema = z.object({
  sampleId: z.string(),
  status: z.enum(["passed", "failed", "execution-error", "request-in-flight"]),
  output: z.string().max(1_000_000).optional(),
  latencyMs: number.optional(),
  estimatedCost: number.optional(),
  reason: z.string().max(100).optional(),
});
const receiptSchema = z.object({
  format: z.literal("ai-radar-api-trial-receipt-v1"),
  researchId: z.string(),
  planDigest: z.string().regex(/^[a-f0-9]{64}$/),
  startedAt: z.string().datetime({ offset: true }),
  completedAt: z.string().datetime({ offset: true }),
  configuration: z.string().regex(/^[a-f0-9]{64}$/),
  scope: z.string().max(1000),
  sampleCount: z.number().int().positive(),
  minimumSuccessfulSamples: z.number().int().positive(),
  currency: z.enum(["USD", "CNY"]),
  kind: z.literal("private-api-trial-not-product-ranking"),
  rateBasis: z.literal("local-user-declared-rates-not-an-invoice"),
  status: z.enum(["complete", "blocked", "interrupted"]),
  plan: planSchema,
  results: z
    .array(
      z.object({
        candidateId: z.string(),
        requestedModel: z.string().min(1).max(200),
        endpointOrigin: z.string().url().startsWith("https://"),
        samples: z.array(rowSchema).max(20),
        status: z.enum(["not-run", "complete", "blocked"]),
        successfulSamples: z.number().int().nonnegative(),
        p50Ms: number.optional(),
        p95Ms: number.optional(),
      }),
    )
    .min(1)
    .max(3),
});

export function apiTrialCandidates(research: ResearchResult, items: DecisionValidationItem[]) {
  if (!currentApi(research)) return [];
  const recorded = new Set(items.map((item) => item.candidateId));
  return (research.decision?.plan?.trialCandidateIds ?? [])
    .filter((id) => recorded.has(id) && candidateRecordMode(research, [id]) === "business")
    .slice(0, 3);
}

export function apiTrialPlan(
  research: ResearchResult,
  ids: string[],
  inputs: {
    samples: string;
    instruction: string;
    minimum: number;
    ceiling: number;
    currency: "USD" | "CNY";
  },
) {
  if (!currentApi(research) || !ids.length || candidateRecordMode(research, ids) !== "business")
    throw new Error("Select qualified API candidates first");
  const plan = planSchema.parse({
    format: "ai-radar-api-trial-v1",
    researchId: research.id,
    candidateIds: ids,
    task: research.decisionContext?.task ?? research.question,
    instruction: inputs.instruction.trim(),
    samples: JSON.parse(inputs.samples),
    grader: "json-exact",
    minimumSuccessfulSamples: inputs.minimum,
    maximumOutputTokens: 4096,
    maximumSeconds: 120,
    maximumEstimatedCost: inputs.ceiling,
    currency: inputs.currency,
  });
  if (
    plan.minimumSuccessfulSamples > plan.samples.length ||
    new Set(plan.samples.map((row) => row.id)).size !== plan.samples.length
  )
    throw new Error("Check unique sample ids and the success threshold");
  return plan;
}

/** Read a private local execution receipt; never promotes it to public evidence. */
export function apiTrialReceipt(research: ResearchResult, text: string, lang: "zh" | "en") {
  if (text.length > 2_000_000) throw new Error("Receipt exceeds 2 MB");
  const receipt = receiptSchema.parse(JSON.parse(text));
  const allowed = new Set(research.decision?.plan?.trialCandidateIds ?? []);
  const plan = receipt.plan;
  if (
    !currentApi(research) ||
    receipt.researchId !== research.id ||
    plan.researchId !== research.id ||
    plan.task !== (research.decisionContext?.task ?? research.question) ||
    receipt.sampleCount !== plan.samples.length ||
    receipt.minimumSuccessfulSamples !== plan.minimumSuccessfulSamples ||
    plan.minimumSuccessfulSamples > plan.samples.length ||
    receipt.currency !== plan.currency ||
    new Date(receipt.completedAt) < new Date(receipt.startedAt) ||
    new Date(receipt.completedAt).getTime() > Date.now() + 300000 ||
    new Set(plan.candidateIds).size !== plan.candidateIds.length ||
    new Set(receipt.results.map((r) => r.candidateId)).size !== receipt.results.length ||
    receipt.results.length !== plan.candidateIds.length ||
    new Set(plan.samples.map((s) => s.id)).size !== plan.samples.length ||
    receipt.results.some(
      (r) => !plan.candidateIds.includes(r.candidateId) || !allowed.has(r.candidateId),
    ) ||
    candidateRecordMode(research, plan.candidateIds) !== "business"
  )
    throw new Error("Receipt does not match this decision, qualified candidates or test batch");
  const t = (zh: string, en: string) => (lang === "zh" ? zh : en);
  const patches: Array<{
    candidateId: string;
    dimension: string;
    patch: Partial<DecisionValidationItem>;
  }> = [];
  const summaries: string[] = [];
  for (const result of receipt.results) {
    if (
      new Set(result.samples.map((s) => s.sampleId)).size !== result.samples.length ||
      result.samples.some((s) => !plan.samples.some((p) => p.id === s.sampleId)) ||
      result.successfulSamples !== result.samples.filter((s) => s.status === "passed").length
    )
      throw new Error("Inconsistent sample counts");
    const complete =
      receipt.status === "complete" &&
      result.status === "complete" &&
      result.samples.length === plan.samples.length &&
      result.samples.every(
        (s) => ["passed", "failed"].includes(s.status) && s.output !== undefined,
      );
    const modelVersion = `${result.requestedModel} @ ${new URL(result.endpointOrigin).host}`;
    if (modelVersion.length > 200) throw new Error("Model and endpoint description is too long");
    const conditions = {
      modelVersion,
      configuration: `${t("串行 API；输出上限", "Sequential API; output limit")} ${plan.maximumOutputTokens}; ${plan.grader}; ${receipt.configuration}`,
      sampleCount: plan.samples.length,
      testedAt: receipt.completedAt.slice(0, 10),
      scope: `${plan.grader}; batch ${receipt.planDigest}; minimum ${plan.minimumSuccessfulSamples}`,
    };
    const status =
      result.status === "complete"
        ? t("完成", "Complete")
        : result.status === "not-run"
          ? t("未运行", "Not run")
          : t("已中止", "Stopped");
    const reason = result.samples.find((row) => row.status === "execution-error")?.reason;
    const reasons: Record<string, string> = {
      "response-model-mismatch": t("返回型号不符", "Response model mismatch"),
      "incomplete-or-unsupported-stop": t(
        "输出未完整结束或要求工具执行",
        "Incomplete output or a tool request",
      ),
      "missing-or-invalid-usage": t("用量缺失或无效", "Missing or invalid usage"),
      "cache-cost-not-covered-by-declared-rates": t(
        "缓存费用未包含在配置中",
        "Cache costs are not configured",
      ),
      "usage-exceeds-declared-bound": t("用量超出配置上限", "Usage exceeds configured bounds"),
      "request-timeout": t("请求超时", "Request timed out"),
    };
    const detail = reason
      ? (reasons[reason] ??
        (/^http-status-\d{3}$/.test(reason)
          ? `HTTP ${reason.slice(-3)}`
          : t("连接或返回格式异常", "Connection or response format error")))
      : "";
    summaries.push(
      `${result.requestedModel}: ${result.successfulSamples}/${plan.samples.length} · ${status}${detail ? ` · ${detail}` : ""}`,
    );
    patches.push({
      candidateId: result.candidateId,
      dimension: "quality",
      patch: {
        status: !complete
          ? "blocked"
          : result.successfulSamples >= plan.minimumSuccessfulSamples
            ? "passed"
            : "failed",
        result:
          t(
            "导入本地 API 执行记录；不是公开评测或 IDE 产品测试。",
            "Imported local API execution; not a public benchmark or an IDE product test.",
          ) + ` ${result.successfulSamples}/${plan.samples.length}; ${receipt.planDigest}`,
        testConditions: conditions,
        measurements: {
          successfulSamples: result.successfulSamples,
          minimumSuccessfulSamples: plan.minimumSuccessfulSamples,
        },
      },
    });
    patches.push({
      candidateId: result.candidateId,
      dimension: "cost",
      patch: {
        status: complete ? "pending" : "blocked",
        testConditions: conditions,
        result: t(
          "按本地自填单价估算，尚未核对实际扣费。",
          "Estimate from locally declared rates; actual charges not verified.",
        ),
        measurements:
          complete && result.samples.every((row) => row.estimatedCost !== undefined)
            ? {
                totalCost: result.samples.reduce((sum, s) => sum + (s.estimatedCost ?? 0), 0),
                currency: receipt.currency,
                costBasis: "estimate",
                sourceNote: "Local runner; user-declared rates; not an invoice",
              }
            : undefined,
      },
    });
    if (
      complete &&
      result.p50Ms !== undefined &&
      result.p95Ms !== undefined &&
      result.p95Ms > 0 &&
      result.p95Ms >= result.p50Ms
    )
      patches.push({
        candidateId: result.candidateId,
        dimension: "latency",
        patch: {
          status: "pending",
          result: t(
            "已记录串行 API 时延；尚未确认满足业务时延标准。",
            "Sequential API latency recorded; business latency criterion not yet confirmed.",
          ),
          testConditions: conditions,
          measurements: { p50Ms: result.p50Ms, p95Ms: result.p95Ms },
        },
      });
  }
  return { patches, summaries, receipt };
}

export function mergeApiTrialReceipt(
  items: DecisionValidationItem[],
  imported: ReturnType<typeof apiTrialReceipt>,
  replace = false,
) {
  let changes = 0;
  const next = items.map((item) => {
    const match = imported.patches.find(
      (p) => p.candidateId === item.candidateId && item.id.endsWith(`-${p.dimension}`),
    );
    if (!match) return item;
    if (!replace && (item.status !== "pending" || item.result.trim() || item.measurements))
      throw new Error("Existing results require explicit replacement approval");
    changes++;
    return { ...item, ...match.patch };
  });
  if (changes !== imported.patches.length)
    throw new Error("Prepare the candidate's full records before importing");
  return next;
}
