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
      zh: "为现有代码仓库选择编码工具，需要编辑文件、运行测试。",
      en: "Choose a coding tool to edit files and run tests in an existing repository.",
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
      zh: "为知识库与文档问答选择模型，需要回答准确并提供可核对的出处。",
      en: "Choose a model for knowledge base document questions, with accurate answers and checkable citations.",
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
    id: "career",
    label: { zh: "简历整理、岗位匹配", en: "Resume and job matching" },
    task: {
      zh: "为求职助手选择模型，需要整理简历信息、匹配岗位，输出固定字段。",
      en: "Choose a model for resume extraction and job search matching with a fixed output schema.",
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
      zh: "为文档信息抽取选择模型，需要提取固定字段，不编造缺失信息。",
      en: "Choose a model for document extraction with fixed fields and no invented missing values.",
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
      zh: "为 Agent 开发选择框架，需要编排任务并调用工具。",
      en: "Choose an agent development framework for task orchestration and tool use.",
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
      zh: "为文本生成与客服对话选择模型，需要遵守指令、回答准确。",
      en: "Choose a model for text generation and customer support that follows instructions and answers accurately.",
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
      zh: "为代码生成选择模型 API，需要生成可执行代码并调用工具。",
      en: "Choose a coding model API for code generation and tool use.",
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
