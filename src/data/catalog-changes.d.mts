import type { ChangeEvent, KnowledgeSnapshot } from "@/domain/types";
export function catalogReleaseChanges(snapshot: KnowledgeSnapshot): ChangeEvent[];
export function catalogChanges(snapshot: KnowledgeSnapshot): ChangeEvent[];
