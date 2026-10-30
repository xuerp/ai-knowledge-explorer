import type { CatalogRecordKind } from "./types";

export const catalogExamples: Record<CatalogRecordKind, string> = {
  entity: JSON.stringify(
    {
      id: "e-model-version",
      type: "model",
      slug: "model-version",
      name: { zh: "模型具体版本", en: "Concrete model version" },
      summary: { zh: "填写经过核验的版本摘要。", en: "Verified release summary." },
      vendor: "Vendor",
      origin: { zh: "海外", en: "Overseas" },
      status: "active",
      tags: ["大模型", "具体版本"],
      firstReleasedAt: "2026-07-29",
      lastUpdatedAt: "2026-07-29",
      familyId: "e-model-family",
      specs: {
        contextWindow: "128K tokens",
        inputPrice: "待核验",
        outputPrice: "待核验",
        modalities: "文本",
        toolUse: "待核验",
        availability: "API",
      },
      knowledge: {
        introduction: [
          {
            zh: "用两到三段说明它是什么、解决什么问题，以及它在生态中的位置。",
            en: "Explain what it is, what problem it solves, and where it sits in the ecosystem.",
          },
        ],
        significance: {
          zh: "说明为什么值得收录与关注。",
          en: "Explain why this entity matters.",
        },
        keyPoints: [
          {
            title: { zh: "关键事实", en: "Key fact" },
            description: { zh: "填写可核验事实。", en: "Add a verifiable fact." },
            sourceIds: ["replace-with-existing-evidence-id"],
          },
        ],
        useCases: [
          {
            title: { zh: "典型用途", en: "Use case" },
            description: { zh: "说明如何实际使用或理解。", en: "Explain practical use." },
          },
        ],
        limitations: [
          {
            zh: "说明使用边界、局限或易误解之处。",
            en: "Describe limitations or common misinterpretations.",
          },
        ],
        officialUrl: "https://example.com/",
      },
    },
    null,
    2,
  ),
  relation: JSON.stringify(
    {
      id: "edge-version-family",
      fromId: "e-model-version",
      toId: "e-model-family",
      kind: "part-of",
      label: { zh: "属于系列", en: "Part of family" },
      confidence: "verified",
      sourceIds: ["replace-with-existing-evidence-id"],
      validFrom: "2026-07-29",
    },
    null,
    2,
  ),
  timeline: JSON.stringify(
    {
      id: "timeline-model-version-release",
      date: "2026-07-29",
      title: { zh: "具体版本发布", en: "Concrete version released" },
      summary: {
        zh: "填写功能、价格与可用性变化。",
        en: "Describe capability and pricing changes.",
      },
      kind: "release",
      sourceIds: ["replace-with-existing-evidence-id"],
      confidence: "verified",
    },
    null,
    2,
  ),
};
