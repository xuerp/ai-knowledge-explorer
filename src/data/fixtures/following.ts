import type { FollowItem } from "@/domain/types";

export const FOLLOWING: FollowItem[] = [
  {
    entityId: "e-gpt",
    intensity: "instant",
    addedAt: "2026-05-01",
    reason: { zh: "日常工作深度使用", en: "Daily driver for work" },
  },
  {
    entityId: "e-claude",
    intensity: "instant",
    addedAt: "2026-05-01",
    reason: { zh: "长文档写作与代码", en: "Long docs & coding" },
  },
  {
    entityId: "e-deepseek",
    intensity: "digest",
    addedAt: "2026-06-01",
    reason: { zh: "关注开源与成本", en: "Tracking open-source & cost" },
  },
  {
    entityId: "e-mcp",
    intensity: "digest",
    addedAt: "2026-06-08",
    reason: { zh: "Agent 协议标准", en: "Agent protocol standard" },
  },
  {
    entityId: "e-cursor",
    intensity: "silent",
    addedAt: "2026-06-10",
    reason: { zh: "偶尔关注新版本", en: "Occasional updates" },
  },
];
