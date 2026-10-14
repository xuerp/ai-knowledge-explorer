import type { ResearchResult } from "@/services/user-api";
import { candidateRecordMode } from "./decision-choice";

/** Derived from the actual decision protocol, not a supplier call or benchmark. */
export function decisionTrialKit(
  research: ResearchResult,
  selected: string[],
  entityName: (id: string) => string,
  lang: "zh" | "en",
) {
  if (candidateRecordMode(research, selected) !== "business" || !research.decision?.plan?.trial)
    return null;
  const t = (zh: string, en: string) => (lang === "zh" ? zh : en);
  const protocol = research.decision.plan.trial;
  if (
    protocol.executed !== false ||
    Object.values(research.citationStates ?? {}).some((state) => state !== "current")
  )
    return null;
  const task = research.decisionContext?.task ?? research.question;
  const conditions = research.decision.conditions.filter(
    (condition) => condition !== `任务：${task}` && condition !== `Task: ${task}`,
  );
  const prompt = [
    t(
      "这是一次产品选型试测。请按下面的使用目标处理我附带的实际材料，返回实际交付；不要回答选哪个产品，也不要虚构测试成绩。仅使用我提供的材料，不补造缺失信息。",
      "This is a product selection trial. Process the actual materials I attach for the goal below and return the deliverable. Do not recommend a product or invent test scores. Use only provided materials without inventing missing information.",
    ),
    `${t("我的使用目标", "My usage goal")}: ${task}`,
    `${t("选型条件（保留使用边界，不据此声称测试通过）", "Selection conditions (retain scope; do not claim a test passed)")}:\n${conditions.join("\n")}`,
    `${t("这次试测的执行要求", "Trial execution requirements")}:\n${protocol.procedure.join("\n")}`,
    `${t("合格标准", "Acceptance criteria")}:\n${protocol.acceptance.join("\n")}`,
    t(
      "我会另行提供输入材料、必须输出的字段/格式及合格标准。材料不足时指出缺少什么；不要把计划或推测当成已执行结果。",
      "I will supply the input materials, required fields/format and acceptance criteria. Identify missing inputs; do not present plans or guesses as executed results.",
    ),
    t(
      "完成后返回实际交付，并指出材料无法支持或尚未完成的部分。",
      "Return the actual deliverable and identify unsupported or unfinished parts.",
    ),
  ].join("\n\n");
  const section = (title: string, rows: string[]) =>
    `## ${title}\n\n${rows.map((row) => `- ${row}`).join("\n")}`;
  const markdown = [
    `# ${t("我的选型试用任务包", "My selection trial kit")}`,
    t(
      "待执行方案，不包含实测成绩。它不会自动调用产品。",
      "Unexecuted protocol, without measured results. It does not invoke products automatically.",
    ),
    `${t("对应分析", "Research")}: ${research.id}`,
    `${t("本轮候选", "Selected candidates")}: ${selected.map(entityName).join("、")}`,
    section(t("任务与选型条件", "Task and selection conditions"), [task, ...conditions]),
    section(t("先准备材料", "Prepare inputs"), [
      protocol.sample,
      t(
        "提供你有权使用的实际样本，先人工标注合格答案/结果。此包没有虚构业务样本。",
        "Provide actual samples you are permitted to use, with manually labeled accepted answers/results. This kit contains no invented business samples.",
      ),
      t(
        "先写下具体入口、版本、配置、样本总数和最低合格标准；费用上限由你确定。",
        "Record the interface, version, configuration, sample count and minimum acceptance criteria first; decide your spending limit.",
      ),
    ]),
    `## ${t("带到现有入口的任务提示", "Task prompt for your existing interface")}\n\n${prompt}`,
    section(t("执行与核对", "Execute and check"), protocol.procedure),
    section(t("合格标准", "Acceptance criteria"), protocol.acceptance),
    section(t("保留真实结果", "Retain actual results"), [
      ...protocol.metrics,
      t(
        "记录实际测试日期、成功/失败样本与原始交付，不把未执行项目记作通过。",
        "Record the actual test date, successful/failed samples and original deliverables. Untested checks remain pending.",
      ),
      t(
        "回到原分析的试用记录，填写实际结果并保存；只有保存且口径匹配的记录用于更新判断。",
        "Return to the original trial records, enter actual results and save. Only saved records with matching conditions update the judgment.",
      ),
    ]),
  ].join("\n\n");
  return { prompt, markdown, protocol };
}

export function requestableEvidenceCandidates(research: ResearchResult) {
  return (research.decision?.candidates ?? []).filter(
    (row) =>
      row.eligibility !== "excluded" &&
      row.gaps?.some((gap) =>
        ["not-recorded", "not-structured", "not-current", "conflicting"].includes(gap.reason),
      ),
  );
}
