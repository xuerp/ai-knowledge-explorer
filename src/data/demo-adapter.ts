import type { KnowledgeSnapshot } from "@/domain/types";
import {
  CLAIMS,
  ENTITIES,
  FOLLOWING,
  RECENT_CHANGES,
  RELATIONS,
  SOURCES,
  TIMELINE,
} from "@/lib/demo-data";

export const DEMO_KNOWLEDGE_SNAPSHOT: KnowledgeSnapshot = {
  meta: {
    mode: "demo",
    freshness: "fresh",
    retrievedAt: "2026-07-25T00:00:00Z",
    message: {
      zh: "当前展示固定演示快照，不代表实时产品事实。",
      en: "Showing a fixed demo snapshot, not live product facts.",
    },
  },
  entities: ENTITIES,
  evidence: SOURCES,
  claims: CLAIMS,
  timeline: TIMELINE,
  graph: {
    nodes: ENTITIES.map((entity) => ({
      id: `node-${entity.id}`,
      entityId: entity.id,
      type: entity.type,
      importance: entity.type === "model" ? 1 : entity.type === "company" ? 0.8 : 0.6,
    })),
    edges: RELATIONS,
    capturedAt: "2026-07-25T00:00:00Z",
    validAt: "2026-07-25",
  },
  changes: RECENT_CHANGES,
  following: FOLLOWING,
  interestProfile: [
    { id: "open-source", label: { zh: "开源模型", en: "Open-source" }, score: 82 },
    { id: "agents", label: { zh: "Agent 与协议", en: "Agents & protocols" }, score: 68 },
    { id: "reasoning", label: { zh: "推理与代码", en: "Reasoning & code" }, score: 74 },
    { id: "multimodal", label: { zh: "多模态", en: "Multimodal" }, score: 45 },
    { id: "china", label: { zh: "中国生态", en: "Chinese ecosystem" }, score: 60 },
  ],
  researchQuestions: [
    {
      zh: "GPT-5 与 Claude 4.5 在代码任务上谁更强？",
      en: "GPT-5 vs Claude 4.5 on code — which is better?",
    },
    {
      zh: "DeepSeek R2 真的比 GPT-5 便宜 10 倍吗？",
      en: "Is DeepSeek R2 really 10× cheaper than GPT-5?",
    },
    {
      zh: "MCP 协议目前有哪些已知集成？",
      en: "Which integrations does MCP have today?",
    },
  ],
  researchAnswers: [
    {
      id: "research-demo-gpt-claude",
      question: {
        zh: "GPT-5 与 Claude 4.5 在代码任务上谁更强？",
        en: "GPT-5 vs Claude 4.5 on code — which is better?",
      },
      summary: {
        zh: "现有演示证据只支持按具体评测比较，不能得出无条件的绝对排名。",
        en: "The demo evidence supports benchmark-specific comparison, not an absolute ranking.",
      },
      claimIds: ["c-gpt5-swe", "c-claude-align"],
      steps: [
        {
          id: "understand",
          label: { zh: "理解问题", en: "Understand question" },
          status: "complete",
        },
        {
          id: "graph",
          label: { zh: "查询图谱", en: "Query graph" },
          status: "complete",
        },
        {
          id: "evidence",
          label: { zh: "检查证据与冲突", en: "Check evidence and conflicts" },
          status: "complete",
        },
        {
          id: "citations",
          label: { zh: "校验引用", en: "Validate citations" },
          status: "complete",
        },
      ],
      generatedAt: "2026-07-25T00:00:00Z",
      status: "ready",
    },
  ],
  notifications: [
    {
      id: "notification-gpt-swe",
      entityId: "e-gpt",
      changeId: "ch1",
      createdAt: "2026-07-15T08:00:00Z",
      priority: "important",
    },
  ],
  reviewCandidates: [
    {
      id: "review-gpt-context",
      entityId: "e-gpt",
      claim: CLAIMS.find((claim) => claim.id === "c-gpt5-1m")!,
      evidenceIds: ["s-community-rumor"],
      status: "needs-more-evidence",
      createdAt: "2026-07-10T09:00:00Z",
    },
  ],
  syncRuns: [
    {
      id: "sync-openai-demo",
      sourceId: "s-openai-gpt5",
      startedAt: "2026-07-25T00:00:00Z",
      finishedAt: "2026-07-25T00:00:02Z",
      status: "succeeded",
      documentsSeen: 1,
      candidatesCreated: 0,
    },
  ],
};
