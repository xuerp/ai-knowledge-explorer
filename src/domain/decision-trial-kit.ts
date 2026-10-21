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
  const fullPrompt = [
    t(
      "这是一次产品选型试测。请按下面的使用目标处理我提供的材料，返回实际交付；不要回答选哪个产品，也不要虚构测试成绩。仅使用原题允许的材料，保留其样本类型、隐私和访问限制，不补造缺失信息。",
      "This is a product selection trial. Process the materials I provide for the goal below and return the deliverable. Do not recommend a product or invent test scores. Use only materials permitted by the task, preserving its sample type, privacy and access restrictions without inventing missing information.",
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
  const coding =
    research.decision.scenario?.id === "coding-workspace" ||
    research.decisionContext?.taskType === "coding-product";
  const knowledgeWorkspace = research.decision.scenario?.id === "knowledge-workspace";
  const starterInputs = coding
    ? t(
        "先选一个真实报错或一项小功能，提供相关文件、复现步骤和运行／验收命令。先试一项即可；完整对比方案可按需查看。",
        "Start with one real bug or a small feature. Supply related files, reproduction steps and run/test commands. The full comparison protocol is optional.",
      )
    : knowledgeWorkspace
      ? protocol.procedure[0] || protocol.sample
      : protocol.sample;
  const prompt = coding
    ? [
        `${t("执行范围与时间限制", "Execution scope and time limit")}:\n${protocol.procedure.join("\n")}`,
        t(
          "请在我提供的代码中完成一项小任务：修复一个报错，或实现我明确指定的一项简单功能。本轮只做这一项。",
          "Complete one small task in the code I provide: fix one bug or implement one explicitly requested small feature. Do only that task.",
        ),
        t(
          "我会附上相关文件、问题描述／复现步骤和验收要求。材料不够时先问我，不要猜测缺少的代码。",
          "I will supply related files, a problem description/reproduction steps and acceptance criteria. Ask for missing inputs instead of guessing code.",
        ),
        t(
          "先复现问题并说明修改计划，再做尽量小的改动，保留无关功能和已有测试。",
          "Reproduce the problem, explain the change, then make a minimal fix while preserving unrelated behavior and existing tests.",
        ),
        t(
          "完成后给出：改了什么、实际运行的测试命令和结果、尚未完成的部分。不能运行测试就明确说明，不要把未运行写成通过。",
          "Report what changed, the test commands actually run and their results, and unfinished work. If tests cannot run, say so; do not report unrun tests as passed.",
        ),
      ].join("\n\n")
    : knowledgeWorkspace
      ? [
          `${t("本次验证范围与步骤", "Scope and procedure for this trial")}:\n${protocol.sample}\n${protocol.procedure.join("\n")}`,
          t(
            "请仅根据当前已连接的知识库回答我接下来给出的问题。每个结论标明支持它的原文出处，不编造引用。",
            "Answer my next questions using only the connected knowledge base. Cite the supporting original passage for each conclusion; do not invent citations.",
          ),
          t(
            "没有足够依据时明确说不知道；资料互相矛盾或过期时指出对应原文，不自行补造结论。不返回当前用户无权访问的内容。",
            "Say you do not know when evidence is insufficient. Identify conflicting or outdated passages without inventing conclusions. Do not return content the current user cannot access.",
          ),
          t(
            "我会提供实际问题，并人工核对回答、引用、拒答和权限。不要把这些指令当成引用准确或权限隔离已通过的证明。",
            "I will provide actual questions and manually verify answers, citations, abstention and permissions. These instructions are not proof of citation accuracy or access isolation.",
          ),
        ].join("\n\n")
      : fullPrompt;
  const section = (title: string, rows: string[]) =>
    `## ${title}\n\n${rows.map((row) => `- ${row}`).join("\n")}`;
  const inputPreparation = [
    starterInputs,
    t(
      "仅准备原题允许的样本，保留其样本类型、隐私和访问限制。需要参考答案时，先核对已有人工参考；没有则先建立，歧义保留待确认，不以候选自己的输出作为参考答案。",
      "Prepare only samples permitted by the task, preserving its sample type, privacy and access restrictions. When reference answers are needed, verify existing human references or establish them first, leaving ambiguity unconfirmed. Candidate outputs cannot serve as their own reference answers.",
    ),
    t(
      "先写下具体入口、版本、配置、样本总数和最低合格标准；费用上限由你确定。",
      "Record the interface, version, configuration, sample count and minimum acceptance criteria first; decide your spending limit.",
    ),
  ];
  const markdown = [
    `# ${t("我的选型试用任务包", "My selection trial kit")}`,
    t(
      "待执行方案，不包含实测成绩。它不会自动调用产品。",
      "Unexecuted protocol, without measured results. It does not invoke products automatically.",
    ),
    `${t("对应分析", "Research")}: ${research.id}`,
    `${t("本轮候选", "Selected candidates")}: ${selected.map(entityName).join("、")}`,
    section(t("任务与选型条件", "Task and selection conditions"), [task, ...conditions]),
    section(t("先准备材料", "Prepare inputs"), inputPreparation),
    `## ${t("带到现有入口的任务提示", "Task prompt for your existing interface")}\n\n${prompt}`,
    section(t("完整对比方案（可选）", "Full comparison protocol (optional)"), [
      protocol.sample,
      ...protocol.procedure,
    ]),
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
  const escape = (value: string) =>
    value.replace(
      /[&<>"']/g,
      (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!,
    );
  const list = (rows: string[]) =>
    `<ul>${rows.map((row) => `<li>${escape(row)}</li>`).join("")}</ul>`;
  // One source protocol, with an explicitly styled offline reading/print format.
  // The plain Markdown export remains available for editors that support it.
  const html = `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>${escape(t("试用任务说明", "Trial task instructions"))}</title><style>
  *{box-sizing:border-box}body{font:15px/1.7 system-ui,"Microsoft YaHei",sans-serif;color:#182235;background:#f6f7f9;margin:0;padding:28px}main{max-width:960px;margin:auto;background:white;padding:32px;border:1px solid #dfe3e9}h1{font-size:25px;line-height:1.4;margin:0 0 12px}h2{font-size:18px;line-height:1.5;margin:26px 0 8px}p{margin:8px 0}ul{padding-left:22px}li+li{margin-top:6px}pre{font:inherit;white-space:pre-wrap;overflow-wrap:anywhere;padding:16px;background:#f1f4f8;border:1px solid #dfe3e9}.note{color:#526076;font-size:13px}.meta{overflow-wrap:anywhere}@media(max-width:600px){body{padding:12px}main{padding:20px}h1{font-size:22px}}@media print{@page{margin:18mm}body{padding:0;background:white}main{padding:0;border:0;max-width:none}h2{break-after:avoid}pre{background:white}li{break-inside:avoid}}
  </style></head><body><main><h1>${escape(t("试用任务说明", "Trial task instructions"))}</h1><p class="note">${escape(t("供你带到现有产品中执行；这份说明不包含已完成的测试或成绩。", "Instructions to execute in your existing product, without completed tests or scores."))}</p><p><strong>${escape(t("本轮产品", "Products"))}：</strong>${escape(selected.map(entityName).join("、"))}</p><h2>${escape(t("使用目标", "Usage goal"))}</h2><p>${escape(task)}</p>${list(conditions)}<h2>${escape(t("先准备材料", "Prepare inputs"))}</h2>${list(inputPreparation)}<h2>${escape(t("复制到产品中的任务提示", "Task prompt to copy into your product"))}</h2><pre>${escape(prompt)}</pre><h2>${escape(t("完整对比方案与验收标准（可选）", "Full comparison protocol and acceptance criteria (optional)"))}</h2><p>${escape(protocol.sample)}</p>${list([...protocol.procedure, ...protocol.acceptance])}<h2>${escape(t("用过以后", "After your trial"))}</h2><p>${escape(t("回到原分析，选择“记录实际结果”，填写并保存。没有执行的项目保留待验证。", "Return to the analysis, select Record actual results, fill in and save. Untested checks stay pending."))}</p><p class="note meta">${escape(t("对应分析", "Research"))}: ${escape(research.id)}</p></main></body></html>`;
  return { prompt, markdown, html, protocol, starterInputs };
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
