import { useReviewState } from "./useReviewState";
import { createSessionActions } from "./createSessionActions";
import { createReviewActions } from "./createReviewActions";
import { createAuditActions } from "./createAuditActions";
import { createSourcesActions } from "./createSourcesActions";
import { createOperationsActions } from "./createOperationsActions";
import { createCatalogActions } from "./createCatalogActions";
export function useReviewController() {
  const state = useReviewState();
  return {
    ...state,
    ...createSessionActions(state),
    ...createReviewActions(state),
    ...createAuditActions(state),
    ...createSourcesActions(state),
    ...createOperationsActions(state),
    ...createCatalogActions(state),
  };
}
export type ReviewController = ReturnType<typeof useReviewController>;
