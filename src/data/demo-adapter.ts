import type { KnowledgeSnapshot } from "@/domain/types";
import snapshot from "./generated/snapshot.json";

// Legacy fixtures are used by seed generation and tests, never by the live repository.
export { BASE_DEMO_KNOWLEDGE_SNAPSHOT } from "./demo-baseline";
export const DEMO_KNOWLEDGE_SNAPSHOT = snapshot as unknown as KnowledgeSnapshot;
