import { AlertTriangle, Network, Timer } from "lucide-react";
import { useApp } from "@/lib/app-state";
import type { ResearchResult } from "@/services/user-api";

export function RetrievalStatus({ research }: { research: ResearchResult }) {
  const { t } = useApp();
  const diagnostics = research.retrievalDiagnostics;
  const fallbackReason = diagnostics.fallbackReason;
  const hybridActive = research.retrievalMode === "hybrid" && !fallbackReason;

  return (
    <section
      aria-label={t("检索诊断", "Retrieval diagnostics")}
      data-testid="research-retrieval-status"
      className={`rounded-lg border p-3 text-xs ${
        hybridActive
          ? "border-verified/35 bg-verified/5 text-foreground"
          : "border-inferred/35 bg-inferred/5 text-foreground"
      }`}
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="inline-flex items-center gap-1.5 font-medium">
          {fallbackReason ? (
            <AlertTriangle className="h-3.5 w-3.5 text-inferred" />
          ) : (
            <Network className="h-3.5 w-3.5 text-verified" />
          )}
          {t("检索路径", "Retrieval path")}：{research.retrievalMode}
          {hybridActive ? t(" · 无降级", " · no fallback") : ""}
        </span>
        <span>
          {t("候选 / 返回", "Candidates / returned")}：{diagnostics.candidateCount} /{" "}
          {diagnostics.returnedCount}
        </span>
        <span className="inline-flex items-center gap-1">
          <Timer className="h-3.5 w-3.5" />
          {diagnostics.elapsedMs} ms
        </span>
      </div>
      {fallbackReason && (
        <p className="mt-2 text-inferred">
          {t("安全降级原因", "Safe fallback reason")}：{fallbackReason}
        </p>
      )}
    </section>
  );
}
