import type { DecisionContext } from "@/services/user-api";

type Text = { zh: string; en: string };
type DecisionExample = {
  id: string;
  label: Text;
  task: Text;
  conditions: Omit<DecisionContext, "task" | "notes" | "candidateEntityIds">;
};

// Newcomer starters name a task, not arbitrary API specifications. Technical
// limits are supplied by the user and remain visible at confirmation.
export const decisionStarters: DecisionExample[] = [
  {
    id: "coding",
    label: { zh: "改代码、修缺陷", en: "Edit and fix code" },
    task: {
      zh: "我想给现有项目选一个编码工具，先用一个能稳定复现的缺陷试用。我可以提供代码仓库、复现步骤和失败的测试用例，希望工具能找到原因、修改相关文件并运行测试。我最看重的是原来失败的用例能通过，已有功能也不受影响。",
      en: "I need a coding tool for an existing project. I'll provide the repository, steps to reproduce a bug, and a failing test. I want the tool to find the cause, edit the relevant files, and run the tests. The fix should pass the failing test and keep the rest of the suite green.",
    },
    conditions: {
      taskType: "coding-product",
      priority: "quality",
      deployment: "undecided",
      budget: { mode: "unknown" },
      exclusions: [],
    },
  },
  {
    id: "knowledge",
    label: { zh: "知识库与文档问答", en: "Knowledge and document QA" },
    task: {
      zh: "我想给小团队选一个知识库平台，先用几份 PDF 手册和 Word 流程文档做试点。同事可以直接提问，答案要附上文档名称和对应章节，方便点回原文核对。资料没覆盖的问题要明确说找不到依据。我最看重的是引用能对得上原文。",
      en: "I need a knowledge base platform for a small team to try with a few PDF manuals and Word process guides. Answers should cite the document and section so we can check the original. If the guides don't cover a question, the answer should say so. Accurate citations matter most.",
    },
    conditions: {
      taskType: "knowledge-product",
      priority: "quality",
      deployment: "undecided",
      budget: { mode: "unknown" },
      exclusions: [],
    },
  },
  {
    id: "career",
    label: { zh: "简历整理、岗位匹配", en: "Resume and job matching" },
    task: {
      zh: "我在做一款给求职者用的助手，想选一个模型，把简历里的工作经历、项目和技能整理成固定字段。对照目标岗位时，要说明哪些要求有对应的经历，并指出依据来自简历的哪一段。简历里找不到依据的要求，标为「待确认」。我最看重的是信息整理准确、匹配理由能在原文里找到依据。",
      en: "I'm choosing a model for a career assistant that turns work history, projects, and skills from a resume into fixed fields. For each job requirement it matches, I want a reference to the relevant part of the resume. Mark gaps in the evidence as unconfirmed. Accuracy and traceability matter most.",
    },
    conditions: {
      taskType: "model-api",
      priority: "quality",
      deployment: "undecided",
      budget: { mode: "unknown" },
      exclusions: [],
    },
  },
  {
    id: "extraction",
    label: { zh: "文档信息抽取", en: "Extract document data" },
    task: {
      zh: "我想选一个模型，处理几种版式不同的合同 PDF。每份合同都要提取合同编号、金额、币种和签署日期，按固定字段输出，方便汇总到同一张表里。原文没写的字段留空，金额旁边有税费或分期款时要能区分。我最看重的是字段和原文对得上。",
      en: "I need a model to extract fields from PDF contracts with different layouts. Return the contract number, amount, currency, and signing date in the same format for every file. Leave missing fields blank. I care most about getting the figures right when taxes or installments appear nearby.",
    },
    conditions: {
      taskType: "model-api",
      priority: "quality",
      deployment: "undecided",
      budget: { mode: "unknown" },
      exclusions: [],
    },
  },
  {
    id: "agent",
    label: { zh: "搭建 Agent 工作流", en: "Build an agent workflow" },
    task: {
      zh: "我想选一个 Agent 框架，搭个售后工单处理流程。我已经有订单查询接口和处理规则，希望流程能按工单查订单、核对规则，再给客服一条处理建议。接口失败时要能从失败的步骤重试。我最看重的是能查到每一步的结果，出错后也方便排查。",
      en: "I need an agent framework for after-sales tickets. I have an order lookup API and support rules. The workflow should look up the order, check the rules, and suggest a next step for the support team. I want to inspect each step and retry from the point where a call fails.",
    },
    conditions: {
      taskType: "agent-development",
      priority: "balanced",
      deployment: "undecided",
      budget: { mode: "unknown" },
      exclusions: [],
    },
  },
  {
    id: "writing",
    label: { zh: "写作、客服对话", en: "Writing and customer support" },
    task: {
      zh: "我想选一个模型，帮客服起草退换货回复。我会提供客户的问题和现行政策，回复要说明适用条件、需要补充的信息和下一步，客服确认后再发送。政策没写清楚的情况要标出来，不能擅自承诺退款。我最看重的是回复准确、客户看得懂。",
      en: "I need a model to draft replies about returns for my support team. I'll provide the customer message and current policy. The draft should state the conditions, what information is missing, and what to do next. It should flag unclear cases for review and avoid unsupported refund promises.",
    },
    conditions: {
      taskType: "model-api",
      priority: "quality",
      deployment: "undecided",
      budget: { mode: "unknown" },
      exclusions: [],
    },
  },
  {
    id: "coding-api",
    label: { zh: "接入编程模型 API", en: "Integrate a coding model API" },
    task: {
      zh: "我在做自己的代码助手，想选一个编程模型 API 接进现有应用。我会把报错和相关代码交给模型，希望它能调用应用提供的工具读取上下文，再生成补丁。补丁由应用里的测试工具验证，我最看重的是补丁能通过测试，工具调用也能稳定接入。",
      en: "I'm building a code assistant and need a coding model API. I'll send error messages and relevant code. The model should call the tools my app provides to get more context, then generate a patch. I'll check the patch with my own test runner and look for reliable tool calls.",
    },
    conditions: {
      taskType: "model-api",
      priority: "quality",
      deployment: "undecided",
      budget: { mode: "unknown" },
      exclusions: [],
    },
  },
];

// Scenario templates describe requirements, not product facts or stored answers.
export const decisionExamples: DecisionExample[] = [
  {
    id: "repository-coding",
    label: { zh: "选编码工具", en: "Choose a coding tool" },
    task: {
      zh: "为现有代码仓库选择编码工具，需要编辑文件、运行测试，效果优先；用缺陷修复、新增功能和跨文件重构比较补丁正确性与人工修改量。",
      en: "Choose a coding tool for an existing repository: edit files and run tests, quality first. Compare patch correctness and human edits on bug fixes, new features and cross-file refactoring.",
    },
    conditions: {
      taskType: "coding-product",
      priority: "quality",
      deployment: "undecided",
      budget: { mode: "unknown" },
      exclusions: [],
    },
  },
  {
    id: "document-qa",
    label: { zh: "选文档问答模型", en: "Choose a document QA model" },
    task: {
      zh: "为内部知识库选择文档问答模型，云 API、文本输入、上下文至少100k token，效果优先；用同一批业务文档核验答案准确性、来源引用和信息缺失时的回答。",
      en: "Choose a document QA model for an internal knowledge base: cloud API, text input, at least 100k context tokens, quality first. Test answer accuracy, citations and missing information on the same business documents.",
    },
    conditions: {
      taskType: "model-api",
      priority: "quality",
      deployment: "cloud-api",
      budget: { mode: "unknown" },
      minimumContextTokens: 100000,
      inputModalities: ["text"],
      exclusions: [],
    },
  },
  {
    id: "private-qa",
    label: { zh: "选私有部署模型", en: "Choose a private deployment model" },
    task: {
      zh: "为内部知识库与文档问答选择可私有部署的模型，文本输入，隐私优先；业务数据留在自有服务器，核对权重、许可与硬件要求，再用业务样本验证回答质量。",
      en: "Choose a privately deployable model for an internal knowledge base and document question answering: text input, privacy first. Keep business data on our servers, check weights, licensing and hardware needs, then test answer quality with business samples.",
    },
    conditions: {
      taskType: "model-api",
      priority: "privacy",
      deployment: "private",
      budget: { mode: "unknown" },
      inputModalities: ["text"],
      exclusions: [],
    },
  },
];

export function decisionExampleContext(
  example: DecisionExample,
  lang: "zh" | "en",
): DecisionContext {
  return {
    ...example.conditions,
    task: example.task[lang],
    budget: { ...example.conditions.budget },
    exclusions: [...example.conditions.exclusions],
    inputModalities: example.conditions.inputModalities
      ? [...example.conditions.inputModalities]
      : [],
    candidateEntityIds: [],
    notes: "",
  };
}
