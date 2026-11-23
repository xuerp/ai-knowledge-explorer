export interface FreshnessTrack {
  track: "relation" | "fact";
  budgetHours: number;
  openCount: number;
  overdueCount: number;
  oldestOpenAt?: string | null;
  oldestOpenAgeHours?: number | null;
  recentDecidedCount: number;
  recentDecidedLateCount: number;
}

export interface KnowledgeFreshness {
  generatedAt: string;
  status: "on-track" | "overdue";
  overdueCount: number;
  recentWindowDays: number;
  tracks: FreshnessTrack[];
}

export const freshnessTrackLabels: Record<FreshnessTrack["track"], string> = {
  relation: "可逐字核验的关系",
  fact: "其他事实",
};

export function freshnessBudgetLabel(hours: number): string {
  return hours % 24 === 0 && hours >= 48 ? `${hours / 24} 天` : `${hours} 小时`;
}

export function freshnessAgeLabel(hours: number | null | undefined): string {
  if (hours === null || hours === undefined) return "无待审";
  if (hours < 1) return "不到 1 小时";
  if (hours < 48) return `${Math.floor(hours)} 小时`;
  return `${Math.floor(hours / 24)} 天`;
}
