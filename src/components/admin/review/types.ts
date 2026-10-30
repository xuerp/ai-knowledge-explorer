import type { Entity } from "@/domain/types";
import {
  type AuditEntry,
  type ClaimEntityAuditReport,
  type DataQualityReport,
  type ExtractionPlanItem,
  type IngestionRun,
  type IntegrationStatus,
  type HealthStatus,
  type OperationsDiagnostics,
  type OutboxEntry,
  type ProductionReadiness,
  type RelationClaimAuditReport,
  type ReviewQueueItem,
  type ReviewInventoryReport,
  type SourceView,
} from "@/services/admin-api";

export type Workspace = {
  queue: ReviewQueueItem[];
  entities: Entity[];
  extractionPlan: ExtractionPlanItem[];
  sources: SourceView[];
  runs: IngestionRun[];
  audit: AuditEntry[];
  outbox: OutboxEntry[];
  quality: DataQualityReport | null;
  integrations: IntegrationStatus | null;
  operations: OperationsDiagnostics | null;
  productionReadiness: ProductionReadiness | null;
  reviewInventory: ReviewInventoryReport | null;
  build: HealthStatus | null;
  claimEntityAudit: ClaimEntityAuditReport | null;
  relationClaimAudit: RelationClaimAuditReport | null;
  loadWarnings: string[];
};

export type CatalogRecordKind = "entity" | "relation" | "timeline";
