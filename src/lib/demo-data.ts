// Compatibility exports for historical seed inputs and regression fixtures.
export type {
  ChangeItem,
  Claim,
  Confidence,
  Entity,
  EntityType,
  FollowItem,
  Lang,
  ReadingMode,
  Relation,
  Source,
  Theme,
  TimelineEvent,
} from "@/domain/types";
import { ENTITIES } from "@/data/fixtures/entities";
import { SOURCES } from "@/data/fixtures/sources";
export { SOURCES } from "@/data/fixtures/sources";
export { ENTITIES } from "@/data/fixtures/entities";
export { CLAIMS } from "@/data/fixtures/claims";
export { TIMELINE } from "@/data/fixtures/timeline";
export { RELATIONS } from "@/data/fixtures/relations";
export { RECENT_CHANGES } from "@/data/fixtures/changes";
export { FOLLOWING } from "@/data/fixtures/following";
export const findEntity = (id: string) => ENTITIES.find((e) => e.id === id);
export const findEntityBySlug = (slug: string) => ENTITIES.find((e) => e.slug === slug);
export const findSource = (id: string) => SOURCES.find((s) => s.id === id);
