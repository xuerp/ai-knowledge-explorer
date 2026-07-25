import type { FollowPreference, InterestProfileItem } from "@/domain/types";

export const PERSONALIZATION_STORAGE_KEY = "ai-radar.personalization.v1";
export const FOLLOWING_STORAGE_KEY = "ai-radar.following.v1";

export interface PersonalizationPreferences {
  version: 1;
  completed: boolean;
  selectedEntityIds: string[];
  topics: string[];
  description: string;
  behaviorLearning: boolean;
  interests: InterestProfileItem[];
  updatedAt: string;
}

export const createDefaultPersonalization = (
  interests: InterestProfileItem[] = [],
): PersonalizationPreferences => ({
  version: 1,
  completed: false,
  selectedEntityIds: [],
  topics: [],
  description: "",
  behaviorLearning: false,
  interests,
  updatedAt: new Date(0).toISOString(),
});

export function readPersonalization(
  fallbackInterests: InterestProfileItem[] = [],
): PersonalizationPreferences {
  if (typeof window === "undefined") return createDefaultPersonalization(fallbackInterests);
  const raw = window.localStorage.getItem(PERSONALIZATION_STORAGE_KEY);
  if (!raw) return createDefaultPersonalization(fallbackInterests);
  try {
    const parsed = JSON.parse(raw) as Partial<PersonalizationPreferences>;
    if (parsed.version !== 1) return createDefaultPersonalization(fallbackInterests);
    return {
      ...createDefaultPersonalization(fallbackInterests),
      ...parsed,
      selectedEntityIds: Array.isArray(parsed.selectedEntityIds)
        ? parsed.selectedEntityIds.filter((value): value is string => typeof value === "string")
        : [],
      topics: Array.isArray(parsed.topics)
        ? parsed.topics.filter((value): value is string => typeof value === "string")
        : [],
      interests: Array.isArray(parsed.interests)
        ? parsed.interests.filter((item): item is InterestProfileItem =>
            Boolean(
              item &&
              typeof item.id === "string" &&
              typeof item.score === "number" &&
              item.label &&
              typeof item.label.zh === "string" &&
              typeof item.label.en === "string",
            ),
          )
        : fallbackInterests,
    };
  } catch {
    return createDefaultPersonalization(fallbackInterests);
  }
}

export function writePersonalization(preferences: PersonalizationPreferences) {
  window.localStorage.setItem(
    PERSONALIZATION_STORAGE_KEY,
    JSON.stringify({
      ...preferences,
      version: 1,
      updatedAt: new Date().toISOString(),
    } satisfies PersonalizationPreferences),
  );
}

export function readFollowing(fallback: FollowPreference[]): FollowPreference[] {
  if (typeof window === "undefined") return fallback;
  const raw = window.localStorage.getItem(FOLLOWING_STORAGE_KEY);
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return fallback;
    return parsed.filter((item): item is FollowPreference =>
      Boolean(
        item &&
        typeof item.entityId === "string" &&
        (item.intensity === "silent" ||
          item.intensity === "digest" ||
          item.intensity === "instant") &&
        typeof item.addedAt === "string" &&
        item.reason &&
        typeof item.reason.zh === "string" &&
        typeof item.reason.en === "string",
      ),
    );
  } catch {
    return fallback;
  }
}

export function writeFollowing(items: FollowPreference[]) {
  window.localStorage.setItem(FOLLOWING_STORAGE_KEY, JSON.stringify(items));
}
