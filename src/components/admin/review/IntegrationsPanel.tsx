import { Button } from "@/components/ui/button";

import { IntegrationCard } from "./shared";

import type { ReviewViewModel } from "./review-view-model";
export function IntegrationsPanel({ context }: { context: ReviewViewModel }) {
  const { busy, probeExtraction, workspace } = context;
  return (
    <>
      {workspace.integrations && (
        <section className="paper-card p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-serif text-2xl font-semibold">外部集成状态</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                这里只显示是否已配置和非敏感标识，不会返回任何密钥或密码。
              </p>
            </div>
            <span className="rounded-full border border-border px-2.5 py-1 text-xs text-muted-foreground">
              生产环境检查
            </span>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <IntegrationCard
              title="AI 候选抽取"
              ready={workspace.integrations.extractionConfigured}
              detail={
                workspace.integrations.extractionConfigured
                  ? `${workspace.integrations.extractionModel} · ${workspace.integrations.extractionEndpointHost} · ${
                      workspace.integrations.automaticExtractionEnabled
                        ? `管线 ${workspace.integrations.extractionPipelineVersion}；自动抽取每轮最多 ${workspace.integrations.automaticExtractionMaxSnapshotsPerCycle} 个快照、每个最多 ${workspace.integrations.automaticExtractionMaxCandidatesPerSnapshot} 条候选；失败后 ${workspace.integrations.automaticExtractionRetryMinutes} 分钟再试；严格关系自动批准${workspace.integrations.automaticRelationApprovalEnabled ? "已开启" : "未开启"}`
                        : "自动抽取未启用"
                    }`
                  : "未配置 API 地址、密钥或模型"
              }
              action={
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={probeExtraction}
                >
                  验证连接与结构化输出
                </Button>
              }
            />
            <IntegrationCard
              title="混合检索"
              ready={workspace.integrations.embeddingConfigured}
              detail={
                workspace.integrations.embeddingConfigured
                  ? `${workspace.integrations.retrievalMode} · ${workspace.integrations.embeddingProvider}/${workspace.integrations.embeddingModel} · ${workspace.integrations.embeddingDimension} 维 · 每日上限 ${workspace.integrations.embeddingDailyNeuronBudget} Neurons / ${workspace.integrations.embeddingDailyApiCallBudget} 次请求`
                  : workspace.integrations.retrievalMode === "hybrid"
                    ? "已请求 hybrid，但凭证或 provider 配置不完整；当前安全降级 lexical"
                    : "生产默认 lexical；staging 完整配置后才启用 hybrid"
              }
            />
            <IntegrationCard
              title="每日摘要与邮件"
              ready={workspace.integrations.smtpConfigured}
              detail={
                workspace.integrations.smtpConfigured
                  ? `按 ${workspace.integrations.digestTimezone} 调度 · ${workspace.integrations.smtpFrom} · ${workspace.integrations.emailDeliveryProvider.toUpperCase()} / ${workspace.integrations.emailDeliveryEndpointHost}`
                  : `按 ${workspace.integrations.digestTimezone} 自动进入 Outbox · 配置 HTTPS 邮件 API 或 SMTP 后自动投递`
              }
            />
            <IntegrationCard
              title="自动采集"
              ready={workspace.integrations.fetchAllowedHosts.length > 0}
              detail={
                workspace.integrations.fetchAllowedHosts.length > 0
                  ? `${workspace.integrations.automaticSources} 个信源启用 · ${workspace.integrations.fetchAllowedHosts.length} 个白名单域名`
                  : `${workspace.integrations.registeredSources} 个信源已登记 · 域名白名单为空`
              }
            />
          </div>
        </section>
      )}
    </>
  );
}
