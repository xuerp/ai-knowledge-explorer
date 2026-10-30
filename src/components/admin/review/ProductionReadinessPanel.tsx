import { type ProductionReadiness } from "@/services/admin-api";

import { ReadinessCard } from "./shared";
import { formatTime } from "@/lib/format";

export function ProductionReadinessPanel({ readiness }: { readiness: ProductionReadiness }) {
  return (
    <section className="paper-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-serif text-2xl font-semibold">生产上线预检</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            自动检查运行环境、数据质量和外部集成；人工项目必须在正式环境逐项留痕确认。
          </p>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-xs ${
            readiness.automatedReady
              ? "bg-verified/10 text-verified"
              : "bg-conflict/10 text-conflict"
          }`}
        >
          {readiness.automatedReady
            ? `自动检查通过 · ${readiness.warningCount} 项警告`
            : `${readiness.blockingCount} 项阻塞 · ${readiness.warningCount} 项警告`}
        </span>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {readiness.checks.map((check) => (
          <ReadinessCard key={check.code} check={check} />
        ))}
      </div>

      <div className="mt-6 border-t border-border pt-5">
        <h3 className="text-sm font-medium">正式发布前人工确认</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          这些项目依赖域名、云平台或供应商外部状态，系统不会自动宣称已经完成。
        </p>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {readiness.manualChecks.map((check) => (
            <ReadinessCard key={check.code} check={check} />
          ))}
        </div>
      </div>

      <p className="mt-4 text-xs text-muted-foreground">
        生成时间：{formatTime(readiness.generatedAt)}
      </p>
    </section>
  );
}
