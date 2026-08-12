export type LocalizedText = {
  zh: string;
  en: string;
};

export type EntityType =
  | "model"
  | "agent"
  | "framework"
  | "paper"
  | "benchmark"
  | "company"
  | "dataset"
  | "api"
  | "tool"
  | "application";

export type Confidence = "verified" | "inferred" | "unverified" | "conflict";
export type ReadingMode = "general" | "product" | "technical";
export type Lang = "zh" | "en";
export type Theme = "light" | "dark";
export type DataMode = "demo" | "live";
export type Freshness = "fresh" | "cached" | "stale" | "offline";

export interface Evidence {
  id: string;
  title: LocalizedText;
  url: string;
  publisher: string;
  publishedAt: string;
  collectedAt: string;
  verifiedAt?: string;
  originalLanguage?: Lang;
  type: "official" | "paper" | "news" | "community" | "benchmark";
  supportsClaimIds?: string[];
  contradictsClaimIds?: string[];
}

export type Source = Evidence;

export interface Claim {
  id: string;
  entityId?: string;
  text: LocalizedText & { technical?: LocalizedText };
  confidence: Confidence;
  sourceIds: string[];
  updatedAt: string;
  validFrom?: string;
  validTo?: string;
  observedAt?: string;
}

export interface TimelineEntry {
  id: string;
  date: string;
  title: LocalizedText;
  summary: LocalizedText;
  kind: "release" | "update" | "paper" | "benchmark" | "incident" | "deprecation";
  sourceIds: string[];
  confidence: Confidence;
}

export type TimelineEvent = TimelineEntry;

export type RelationKind =
  | "developed-by"
  | "based-on"
  | "competes-with"
  | "benchmarked-on"
  | "uses"
  | "cited-by"
  | "part-of"
  | "successor-of";

export interface GraphEdge {
  id: string;
  fromId: string;
  toId: string;
  kind: RelationKind;
  label?: LocalizedText;
  confidence: Confidence;
  sourceIds: string[];
  validFrom?: string;
  validTo?: string;
}

export type Relation = GraphEdge;

export interface EntitySummary {
  id: string;
  type: EntityType;
  slug: string;
  name: LocalizedText;
  summary: LocalizedText;
  vendor?: string;
  origin?: LocalizedText;
  status: "active" | "deprecated" | "preview" | "rumor";
  tags: string[];
  latestVersion?: string;
  firstReleasedAt?: string;
  lastUpdatedAt: string;
}

export interface EntityDetail extends EntitySummary {
  aliases?: string[];
  /** Present only on a concrete model release; points to its model-family entity. */
  familyId?: string;
  specs?: {
    contextWindow?: string;
    inputPrice?: string;
    outputPrice?: string;
    modalities?: string;
    toolUse?: string;
    availability?: string;
  };
  capabilities?: Array<LocalizedText & { confidence: Confidence }>;
  metrics?: Array<{
    name: string;
    value: string;
    benchmark: string;
    date: string;
    confidence: Confidence;
    sourceIds?: string[];
  }>;
  knowledge?: {
    introduction: LocalizedText[];
    significance: LocalizedText;
    keyPoints: Array<{
      title: LocalizedText;
      description: LocalizedText;
      sourceIds?: string[];
    }>;
    useCases: Array<{
      title: LocalizedText;
      description: LocalizedText;
    }>;
    limitations: LocalizedText[];
    officialUrl?: string;
  };
}

export type Entity = EntityDetail;

export interface GraphNode {
  id: string;
  entityId: string;
  type: EntityType;
  importance: number;
}

export interface GraphSnapshot {
  nodes: GraphNode[];
  edges: GraphEdge[];
  capturedAt: string;
  validAt: string;
}

export interface ChangeEvent {
  id: string;
  entityId: string;
  date: string;
  summary: LocalizedText;
  kind: "new" | "updated" | "deprecated" | "benchmark" | "rumor";
  confidence: Confidence;
  sourceIds?: string[];
}

export type ChangeItem = ChangeEvent;

export interface ComparisonResult {
  entityIds: string[];
  generatedAt: string;
  dimensions: Array<{
    id: string;
    label: LocalizedText;
    values: Record<string, string | null>;
    sourceIds: string[];
  }>;
}

export type ResearchStepStatus = "pending" | "running" | "complete" | "failed" | "cancelled";

export interface ResearchStep {
  id: string;
  label: LocalizedText;
  status: ResearchStepStatus;
  detail?: LocalizedText;
}

export interface ResearchAnswer {
  id: string;
  question: LocalizedText;
  summary: LocalizedText;
  claimIds: string[];
  steps: ResearchStep[];
  generatedAt: string;
  status: "ready" | "insufficient-evidence" | "failed" | "cancelled";
}

export interface FollowPreference {
  entityId: string;
  intensity: "silent" | "digest" | "instant";
  addedAt: string;
  reason: LocalizedText;
}

export type FollowItem = FollowPreference;

export interface InterestProfileItem {
  id: string;
  label: LocalizedText;
  score: number;
}

export interface Notification {
  id: string;
  entityId: string;
  changeId: string;
  createdAt: string;
  readAt?: string;
  priority: "normal" | "important";
}

export interface ReviewCandidate {
  id: string;
  entityId?: string;
  claim: Claim;
  evidenceIds: string[];
  status: "pending" | "approved" | "rejected" | "needs-more-evidence";
  createdAt: string;
  reviewedAt?: string;
}

export interface SyncRun {
  id: string;
  sourceId: string;
  startedAt: string;
  finishedAt?: string;
  status: "running" | "succeeded" | "failed" | "partial";
  documentsSeen: number;
  candidatesCreated: number;
  error?: string;
}

export interface DataMeta {
  mode: DataMode;
  freshness: Freshness;
  retrievedAt: string;
  cachedAt?: string;
  message?: LocalizedText;
}

export interface KnowledgeSnapshot {
  meta: DataMeta;
  entities: EntityDetail[];
  evidence: Evidence[];
  claims: Claim[];
  timeline: Record<string, TimelineEntry[]>;
  graph: GraphSnapshot;
  changes: ChangeEvent[];
  following: FollowPreference[];
  interestProfile: InterestProfileItem[];
  researchQuestions: LocalizedText[];
  researchAnswers: ResearchAnswer[];
  notifications: Notification[];
  reviewCandidates: ReviewCandidate[];
  syncRuns: SyncRun[];
}
