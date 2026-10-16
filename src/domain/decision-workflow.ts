import type {
  DecisionContext,
  ResearchResult,
  DecisionValidationItem,
  DecisionValidationReview,
} from "@/services/user-api";
import { validationReviewReading } from "./decision-validation-review";
import scenarios from "../../backend/data/decision_scenarios.v1.json";
import {
  decisionPresentation,
  decisionStatusLabel,
  reportCitationNumbers,
} from "./decision-presentation";
import { compactFindings, decisionReading } from "./decision-reading";
import { groupValidationItems, validationItemHeading } from "./decision-validation-view";
import { decisionPlanSections, trialQualificationLabel } from "./decision-plan-reading";
import { measurementRows, protocolRows } from "./decision-measurements";

export function decisionScenario(context: DecisionContext, lang: "zh" | "en") {
  const requested = (pattern: string) =>
    (context.task + " " + (context.notes ?? ""))
      .split(/[。；;.!]/)
      .some(
        (clause) =>
          !/不需要|无需|不要|不支持|does not|not required|no need/i.test(clause) &&
          (/[\u3400-\u9fff]/.test(pattern)
            ? clause.toLowerCase().includes(pattern.toLowerCase())
            : new RegExp(
                `(?<![\\w])${pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w])`,
                "i",
              ).test(clause)),
      );
  const matches = scenarios.scenarios.filter((row) =>
    row.patterns.some((pattern) => {
      if (/[\u3400-\u9fff]/.test(pattern))
        return context.task.toLowerCase().includes(pattern.toLowerCase());
      return new RegExp(
        `(?<![\\w])${pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w])`,
        "i",
      ).test(context.task);
    }),
  );
  const row =
    matches.find(
      (item) =>
        !context.taskType ||
        context.taskType === "unspecified" ||
        item.taskType === context.taskType,
    ) ??
    scenarios.scenarios.find(
      (item) =>
        item.id ===
        (
          {
            "coding-product": "coding-workspace",
            "knowledge-product": "knowledge-workspace",
            "agent-development": "agent-orchestration",
          } as Record<string, string>
        )[context.taskType ?? ""],
    );
  const required = row
    ? [
        ...new Set([
          ...row.features,
          ...("optionalFeatures" in row ? (row.optionalFeatures ?? []) : []).filter((key) =>
            scenarios.features[key as keyof typeof scenarios.features].patterns.some(requested),
          ),
        ]),
      ]
    : [];
  const superseded = new Set<string>(
    required.flatMap((key) => {
      const feature = scenarios.features[key as keyof typeof scenarios.features];
      return "supersedes" in feature ? feature.supersedes : [];
    }),
  );
  return row
    ? {
        id: row.id,
        name: row.name[lang],
        requiredFeatures: required.filter((key) => !superseded.has(key)),
        clarificationChecks: row.checks[lang],
        suggestedTaskType: row.taskType as NonNullable<DecisionContext["taskType"]>,
      }
    : {
        id: "unspecified",
        name: lang === "zh" ? "待明确业务用途" : "Business use needs clarification",
        requiredFeatures: [],
        clarificationChecks: [
          lang === "zh"
            ? "补充要处理的输入、期望输出及合格标准，或指定候选。"
            : "Specify inputs, expected outputs and acceptance criteria, or select candidates.",
        ],
      };
}

export function decisionFingerprint(context: DecisionContext): string {
  const sort = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(sort);
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value)
          .filter(([, item]) => item !== undefined && item !== null && item !== "")
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, item]) => [key, sort(item)]),
      );
    return value;
  };
  return JSON.stringify(
    sort({
      workflowVersion: 1,
      taskType: "unspecified",
      inputModalities: [],
      commercialUseRequired: false,
      ...context,
      budget: { period: "month", costScope: "all-costs", ...context.budget },
    }),
  );
}

/** Compare saved signatures semantically so new defaults do not discard a result. */
export function matchesDecisionFingerprint(saved: string | undefined, currentFingerprint: string) {
  if (!saved) return false;
  try {
    const previous = JSON.parse(saved);
    if (!previous || typeof previous !== "object" || !previous.budget) return false;
    return decisionFingerprint(previous) === currentFingerprint;
  } catch {
    return false;
  }
}

/** Bounded recognizer, never an LLM or a claim of full natural-language understanding. */
export function interpretDecisionTask(context: DecisionContext): DecisionContext {
  const text = context.task;
  const result = {
    ...context,
    budget: { ...context.budget },
    inputModalities: [...(context.inputModalities ?? [])],
  };
  if (!context.taskType || context.taskType === "unspecified") {
    const scene = decisionScenario(context, "zh");
    if ("suggestedTaskType" in scene) result.taskType = scene.suggestedTaskType;
  }
  if (context.deployment === "undecided") {
    const offline = text
      .split(/[，,。；;.!]/)
      .some(
        (clause) =>
          /(?:必须|要求).{0,8}离线|完全离线运行|fully offline|air.gapped/i.test(clause) &&
          !/不要求|不需要|无需|不用|not required|no need/i.test(clause),
      );
    if (offline) result.deployment = "on-device";
    else if (
      /(?<!无需|不要|不需要)私有部署|(?<!无需|不要|不需要)本地部署|(?<!no )private deployment|on[- ]premises/i.test(
        text,
      )
    )
      result.deployment = "private";
    else if (/端侧|on[- ]device/i.test(text)) result.deployment = "on-device";
    else if (/云\s*API|cloud API/i.test(text)) result.deployment = "cloud-api";
  }
  const capacity =
    text.match(
      /(?:上下文|context)(?:长度|窗口| window)?\s*(?:不低于|至少|大于等于|≥|>=|at least)?\s*(\d+(?:\.\d+)?)\s*(k|万|m)?\s*(?:以上|\+|tokens?)?/i,
    ) ??
    text.match(
      /(?:支持|至少|不低于|at least)\s*(\d+(?:\.\d+)?)\s*(k|万|m)?\s*(?:以上|\+)?\s*(?:token[s]?\s*)?(?:的)?上下文/i,
    );
  if (capacity && context.minimumContextTokens === undefined) {
    const scale = { k: 1000, 万: 10000, m: 1000000 }[capacity[2]?.toLowerCase() ?? ""] ?? 1;
    const tokens = Number(capacity[1]) * scale;
    if (Number.isSafeInteger(tokens) && tokens > 0 && tokens <= 100000000)
      result.minimumContextTokens = tokens;
  }
  if (
    /支持(?:图片|图像)(?:输入)?|图像输入|image input|accept images/i.test(text) &&
    !/不(?:需要|支持)(?:图片|图像)|no image input/i.test(text) &&
    !result.inputModalities.includes("image")
  )
    result.inputModalities.push("image");
  if (
    /商用许可|可商用|允许商用|commercial use required/i.test(text) &&
    !/不需要商用|无需商用|不要求商用|非商用|不允许商用|non-commercial|no commercial use/i.test(text)
  )
    result.commercialUseRequired = true;
  const monthly = text.match(
    /(?:每月|月预算|monthly budget)\s*(?:预算|不超过|最多|上限|≤|<=|of|under)?\s*([¥￥$]?)\s*(\d+(?:\.\d+)?)\s*(万)?\s*(元|CNY|USD|美元)?/i,
  );
  if (monthly && context.budget.mode === "unknown") {
    const currency =
      monthly[1] === "$" || /USD|美元/i.test(monthly[4] ?? "")
        ? "USD"
        : /¥|￥/.test(monthly[1]) || /元|CNY/i.test(monthly[4] ?? "")
          ? "CNY"
          : undefined;
    if (currency)
      result.budget = {
        ...result.budget,
        mode: "range",
        max: Number(monthly[2]) * (monthly[3] ? 10000 : 1),
        currency,
        period: "month",
        channel: result.budget.channel ?? "",
      };
  }
  if (
    (!result.taskType || result.taskType === "unspecified") &&
    result.minimumContextTokens !== undefined
  )
    result.taskType = "model-api";
  return result;
}

export function decisionResumePath(context: DecisionContext): string {
  const search = new URLSearchParams({
    task: context.task,
    taskType: context.taskType ?? "unspecified",
    priority: context.priority,
    deployment: context.deployment,
    budget: context.budget.mode,
  });
  const fields = {
    budgetMin: context.budget.min,
    budgetMax: context.budget.max,
    currency: context.budget.currency,
    channel: context.budget.channel,
    costScope: context.budget.costScope,
    maximumInputPerRequest: context.budget.maximumInputTokensPerRequest,
    inputTokens: context.budget.monthlyInputTokens,
    outputTokens: context.budget.monthlyOutputTokens,
    region: context.region,
    minimumContext: context.minimumContextTokens,
    modalities: context.inputModalities?.join(","),
    commercialUse: context.commercialUseRequired ? "true" : undefined,
    serviceChannel: context.serviceAccess?.channel,
    serviceTier: context.serviceAccess?.tier,
    serviceRegion: context.serviceAccess?.region,
    exclusions: context.exclusions.join(","),
    notes: context.notes,
    candidates: context.candidateEntityIds.join(","),
  };
  for (const [key, value] of Object.entries(fields))
    if (value !== undefined && value !== null && value !== "") search.set(key, String(value));
  return `/ask?${search.toString()}`;
}

export function decisionInputConflicts(context: DecisionContext): string[] {
  const recognized = interpretDecisionTask({
    ...context,
    deployment: "undecided",
    budget: { mode: "unknown" },
    minimumContextTokens: undefined,
    inputModalities: [],
    commercialUseRequired: false,
  });
  const conflicts: string[] = [];
  if (
    context.serviceAccess?.channel &&
    context.budget.mode === "range" &&
    context.budget.channel &&
    context.serviceAccess.channel.trim().toLowerCase() !==
      context.budget.channel.trim().toLowerCase()
  )
    conflicts.push("service-channel");
  if (
    recognized.deployment !== "undecided" &&
    context.deployment !== "undecided" &&
    recognized.deployment !== context.deployment
  )
    conflicts.push("deployment");
  if (
    recognized.minimumContextTokens &&
    context.minimumContextTokens &&
    context.minimumContextTokens < recognized.minimumContextTokens
  )
    conflicts.push("context");
  if (
    recognized.budget.mode === "range" &&
    context.budget.mode === "range" &&
    (recognized.budget.currency !== context.budget.currency ||
      (context.budget.max !== undefined &&
        recognized.budget.max !== undefined &&
        context.budget.max > recognized.budget.max))
  )
    conflicts.push("budget");
  return conflicts;
}

export function createValidationPlan(
  research: ResearchResult,
  selectedIds?: string[],
): DecisionValidationItem[] {
  const coding = research.decision?.scenario?.id === "coding-workspace";
  const plan = research.decision?.plan;
  if (plan && ["needs-input", "all-excluded", "no-candidates", "failed"].includes(plan.state))
    return [];
  const qualified = new Set(plan?.trialCandidateIds ?? []);
  const candidates =
    research.decision?.candidates
      ?.filter((candidate) => candidate.eligibility !== "excluded")
      .filter((candidate) => !selectedIds || selectedIds.includes(candidate.entityId))
      .filter(
        (candidate) =>
          !plan || plan.state !== "ready-to-validate" || qualified.has(candidate.entityId),
      )
      .slice(0, 20) ?? [];
  if (selectedIds && !candidates.length) return [];
  const ids = candidates.length ? candidates.map((candidate) => candidate.entityId) : [undefined];
  const businessChecks = research.decision?.scenario?.clarificationChecks ?? [];
  const qualityTitle = coding
    ? "同一仓库比较失败测试修复、加功能并补测试、跨文件重构；保留补丁、实际测试命令和退出码 / Compare a failing-test fix, feature with tests and cross-file refactor on the same repository; retain patches, test commands and exit codes"
    : businessChecks.length
      ? `用相同业务样本核对 / Test identical business samples: ${businessChecks.join("; ")}`.slice(
          0,
          500,
        )
      : "用相同业务样本测量任务成功率 / Measure task success on the same representative samples";
  return ids.flatMap((candidateId) =>
    [
      {
        key: "quality",
        title: qualityTitle,
      },
      {
        key: "latency",
        title: coding
          ? "记录每项任务完成时间、人工修改量、重试及审批次数 / Record task completion time, human edits, retries and approval counts"
          : "记录目标并发下的 P50/P95 时延、样本量及环境 / Record P50/P95 latency, concurrency, sample size and environment",
      },
      {
        key: "cost",
        title: coding
          ? "按实际产品、账户和计费渠道记录用量与任务成本；未知费用保留未知 / Record usage and task cost for the actual product, account and billing channel; unknown costs stay unknown"
          : "记录调用量、输入输出、渠道及单位成本 / Record workload, inputs/outputs, channel and unit cost",
      },
      {
        key: "terms",
        title: coding
          ? "核对产品入口、底层模型版本、仓库权限、命令审批和数据条款 / Check product interface, model version, repository permissions, command approvals and data terms"
          : "核对具体版本、部署、商用许可及数据条款 / Check exact version, deployment, commercial license and data terms",
      },
    ]
      .filter(
        ({ key }) =>
          !plan ||
          (candidateId && qualified.has(candidateId) && plan.state === "ready-to-validate") ||
          key === "terms",
      )
      .map(({ key, title }) => ({
        id: `${candidateId ?? "decision"}-${key}`,
        title,
        ...(candidateId ? { candidateId } : {}),
        status: "pending" as const,
        result: "",
        ...(key === "quality" && plan?.trial ? { suggestedProtocol: plan.trial } : {}),
        testConditions: {
          modelVersion: "",
          configuration: "",
          sampleCount: null,
          testedAt: "",
          scope: "",
        },
      })),
  );
}

export function decisionMarkdown(
  research: ResearchResult,
  entityName: (id: string) => string,
): string {
  const decision = research.decision;
  if (!decision) return "";
  const reading = decisionReading(decision, entityName);
  const cite = (ids: string[]) =>
    ids.length ? ` [${reportCitationNumbers(research, ids).join(", ")}]` : "";
  const lines = [
    "## Decision / 决策",
    decisionPresentation(
      research,
      /[\u3400-\u9fff]/.test(decision.recommendation.summary) ? "zh" : "en",
    ).summary,
    `Evaluated / 核验时间: ${decision.asOf}`,
    "",
    "### Conditions / 条件",
    ...decision.conditions.map((item) => `- ${item}`),
    "",
    "### Candidates / 候选",
    ...reading.commonReasons.map(
      ([reason, ids]) => `- ${reason} — ${ids.map(entityName).join("、")}`,
    ),
  ];
  const planSections = decisionPlanSections(
    decision.plan,
    entityName,
    /[\u3400-\u9fff]/.test(decision.recommendation.summary) ? "zh" : "en",
  );
  lines.splice(
    3,
    0,
    ...planSections.flatMap((section) => [
      "",
      `### ${section.title}`,
      ...section.lines.map((line) => `- ${line}`),
    ]),
  );
  if (reading.commonGaps.length)
    lines.push(
      "",
      "共同资料缺口 / Shared evidence gaps",
      ...reading.commonGaps.map(
        ({ gap, ids }) =>
          `- ${gap.detail || gap.reason}${cite(gap.claimIds)} — ${ids.map(entityName).join("、")}`,
      ),
      "",
    );
  for (const candidate of decision.candidates ?? []) {
    const coverage = reading.coverage(candidate.entityId);
    lines.push(
      `- ${entityName(candidate.entityId)}: ${trialQualificationLabel(decision, candidate.entityId, "zh") ?? decisionStatusLabel(candidate.eligibility, "zh")} / ${trialQualificationLabel(decision, candidate.entityId, "en") ?? decisionStatusLabel(candidate.eligibility, "en")}`,
      `  - 功能描述 / Feature descriptions: ${coverage.described}/${coverage.features}; ${coverage.hard ? `硬条件已核验 / Verified constraints: ${coverage.verified}/${coverage.hard}` : "未设置硬条件 / No hard constraints set"}`,
      ...reading.individualReasons(candidate.entityId).map((reason) => `  - ${reason}`),
      ...compactFindings(candidate.strengths ?? []).map(
        (finding) => `  - ${finding.finding}${cite(finding.claimIds)}`,
      ),
      ...reading
        .individualGaps(candidate.entityId)
        .map((gap) => `  - ${gap.detail || gap.reason}${cite(gap.claimIds)}`),
    );
  }
  if (decision.scenario)
    lines.push(
      "",
      `Scenario / 场景: ${decision.scenario.name}`,
      ...decision.scenario.clarificationChecks.map((check) => `- ${check}`),
    );
  if (decision.scope)
    lines.push(
      "",
      `Scope / 范围: ${decision.scope.selectionBasis}`,
      `Considered / 核验范围: ${decision.scope.consideredEntityIds.map(entityName).join(", ")}`,
      `Outside this report / 本报告未展示: ${decision.scope.omittedEntityIds.map(entityName).join(", ") || "None / 无"}`,
    );
  if (decision.recommendation.reasons?.length)
    lines.push(
      "",
      "### Recommendation basis / 建议依据",
      ...compactFindings(decision.recommendation.reasons).map(
        (reason) => `- ${reason.finding}${cite(reason.claimIds)}`,
      ),
    );
  for (const row of reading.knownComparisons) {
    lines.push("", `### ${row.dimension}`);
    for (const cell of row.cells.filter((item) => item.facts.length))
      lines.push(
        `- ${entityName(cell.entityId)}: ${decisionStatusLabel(cell.state, "zh")} / ${decisionStatusLabel(cell.state, "en")}`,
        ...cell.facts.map((fact) => `  - ${fact.finding}${cite(fact.claimIds)}`),
      );
    const awaiting = row.cells.filter((cell) => !cell.facts.length);
    if (awaiting.length)
      lines.push(
        `- 待补资料 / Awaiting evidence: ${awaiting.map((cell) => entityName(cell.entityId)).join("、")}`,
      );
  }
  if (reading.missingDimensions.length)
    lines.push(
      "",
      "### 待补维度 / Dimensions awaiting evidence",
      reading.missingDimensions.join("、"),
    );
  lines.push(
    "",
    "### Risks / 风险",
    ...decision.risks.map((risk) => `- ${risk.detail}${cite(risk.claimIds)}`),
    "",
    "### Next checks / 下一步",
    ...(decision.plan ? [] : reading.nextChecks.map((check) => `- ${check}`)),
  );
  return lines.join("\n");
}

export function validationMarkdown(
  research: ResearchResult,
  items: DecisionValidationItem[],
  entityName: (id: string) => string,
  saved: boolean,
  review?: DecisionValidationReview | null,
): string {
  const reviewed = saved && review ? validationReviewReading(review, entityName, "zh") : undefined;
  return [
    "# Private decision validation / 私密决策验证",
    `Research / 研究记录: ${research.id}`,
    saved ? "Saved notes / 已保存记录" : "Unsaved draft / 尚未保存的草稿",
    "User notes are not verified public Claims / 用户笔记不是已核验的公开事实",
    "",
    ...(reviewed?.conclusion
      ? [
          "## 基于私人实测的选型判断 / Selection based on private test records",
          "",
          reviewed.conclusion.headline,
          "",
          reviewed.conclusion.action,
          "",
          ...reviewed.conclusion.numericGroups.flatMap((group) => [
            `### ${group.title}`,
            "",
            "| 候选 / Candidate | 记录数值 / Recorded value |",
            "| --- | --- |",
            ...group.rows.map((row) => `| ${row.name.replaceAll("|", "\\|")} | ${row.value} |`),
            "",
            group.basis,
            group.note,
            "",
          ]),
          ...reviewed.conclusion.findings.flatMap((row) => [
            `- ${row.title}: ${row.finding}`,
            row.scope,
            "",
          ]),
          reviewed.conclusion.untested,
          "",
        ]
      : []),
    "## Public evidence / 公开资料分析",
    "",
    decisionMarkdown(research, entityName),
    "",
    "## Actual results / 实际结果",
    ...(reviewed
      ? [
          reviewed.headline,
          ...reviewed.candidates.map((row) => `- ${row}`),
          "",
          reviewed.nextStep,
          ...reviewed.comparisons.flatMap((group) => [group.title, group.basis, ""]),
          reviewed.caution,
          "",
        ]
      : [
          "保存后复核记录完整度与比较口径；此报告未沿用旧复核。 / Save to review completeness and comparison bases; earlier review is not reused.",
          "",
        ]),
    ...groupValidationItems(items).flatMap((group) => [
      `### ${group.candidateId ? entityName(group.candidateId) : "Decision / 本次决策"}`,
      "",
      ...group.items.flatMap((item) => [
        `#### ${validationItemHeading(item, "zh")} / ${validationItemHeading(item, "en")}`,
        item.title,
        `Status / 状态: ${decisionStatusLabel(item.status, "zh")} / ${decisionStatusLabel(item.status, "en")}`,
        "",
        item.result || "Untested / 尚未实测",
        ...measurementRows(item, "zh").map(([label, value]) => `- ${label}: ${value}`),
        ...protocolRows(item, "zh").map(([label, value]) => `- ${label}: ${value}`),
        "",
        ...(item.testConditions
          ? [
              `- Version / 版本: ${item.testConditions.modelVersion || "Unspecified / 未填写"}`,
              `- Configuration / 配置: ${item.testConditions.configuration || "Unspecified / 未填写"}`,
              `- Samples / 样本: ${item.testConditions.sampleCount ?? "Unspecified / 未填写"}`,
              `- Tested / 测试时间: ${item.testConditions.testedAt || "Unspecified / 未填写"}`,
              `- Scope / 范围: ${item.testConditions.scope || "Unspecified / 未填写"}`,
            ]
          : []),
        "",
      ]),
    ]),
    "## Cited sources / 引用来源",
    ...(research.citations ?? []).flatMap((citation, index) => [
      `- [${index + 1}] ${citation.claim.text.zh} / ${citation.claim.text.en}`,
      ...citation.evidence.map(
        (source) =>
          `  - ${source.url} (${source.publishedAt || "source date unknown / 来源日期未知"})`,
      ),
    ]),
  ].join("\n");
}
