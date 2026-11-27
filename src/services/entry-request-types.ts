export type EntryRequestStatus = "pending" | "in-review" | "resolved" | "rejected";
export interface EntryRequestPayload {
  requestId: string;
  name: string;
  entityType: "model" | "product" | "organization" | "tool" | "paper" | "benchmark" | "other";
  sourceUrl: string;
  reason: string;
}
export interface EntryRequestReceipt {
  id: string;
  status: EntryRequestStatus;
  createdAt: string;
}
export interface EntryRequestView
  extends EntryRequestReceipt, Omit<EntryRequestPayload, "requestId"> {
  reviewedAt: string | null;
  reviewedBy: string | null;
  reviewerNote: string | null;
  entityId: string | null;
  version: number;
  kind: EntryRequestKind;
  autoState: EntryRequestAutoState | null;
  autoDetail: string | null;
  autoAttemptedAt: string | null;
  candidateIds: string[];
  candidatesOpen: number;
  candidatesApproved: number;
  candidatesRejected: number;
}
export type EntryRequestKind = "release" | "verification" | "evidence" | "visitor";
export type EntryRequestAutoState = "candidates" | "no-evidence" | "failed" | "skipped";
export interface EntryRequestDecision {
  status: Exclude<EntryRequestStatus, "pending">;
  version: number;
  reviewerNote: string;
  entityId?: string;
}
