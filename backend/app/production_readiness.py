from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime

from .schemas import ProductionReadiness, ProductionReadinessCheck


@dataclass(frozen=True, slots=True)
class ProductionReadinessInputs:
    environment: str
    data_mode: str
    database_dialect: str
    schema_revision: str | None
    expected_schema_revision: str
    jwt_enabled: bool
    legacy_admin_token_enabled: bool
    cors_origins: tuple[str, ...]
    extraction_configured: bool
    smtp_configured: bool
    fetch_allowed_hosts: int
    automatic_sources: int
    quality_ready: bool
    heartbeat_status: str


def _check(
    code: str,
    title: str,
    ready: bool,
    ready_detail: str,
    blocked_detail: str,
    action: str | None = None,
) -> ProductionReadinessCheck:
    return ProductionReadinessCheck(
        code=code,
        title=title,
        status="ready" if ready else "blocked",
        detail=ready_detail if ready else blocked_detail,
        action=None if ready else action,
    )


def build_production_readiness(
    inputs: ProductionReadinessInputs,
    *,
    now: datetime | None = None,
) -> ProductionReadiness:
    cors_secure = bool(inputs.cors_origins) and all(
        origin.startswith("https://") and "*" not in origin for origin in inputs.cors_origins
    )
    database_ready = (
        inputs.database_dialect == "postgresql"
        and inputs.schema_revision == inputs.expected_schema_revision
    )
    checks = [
        _check(
            "runtime_environment",
            "运行环境",
            inputs.environment == "production",
            "服务已按 production 环境启动。",
            f"当前环境为 {inputs.environment}，不能作为公网生产实例。",
            "设置 AI_RADAR_ENVIRONMENT=production。",
        ),
        _check(
            "live_data_mode",
            "正式数据模式",
            inputs.data_mode == "live",
            "公开目录已使用正式数据模式。",
            "当前仍为 demo 模式，页面内容不能作为正式数据验收结果。",
            "完成真实采集和质量验收后设置 AI_RADAR_DATA_MODE=live。",
        ),
        _check(
            "database_schema",
            "生产数据库与迁移",
            database_ready,
            f"PostgreSQL 已位于迁移版本 {inputs.expected_schema_revision}。",
            (
                "生产部署必须使用 PostgreSQL。"
                if inputs.database_dialect != "postgresql"
                else (
                    f"数据库迁移版本为 {inputs.schema_revision or '未知'}，"
                    f"预期 {inputs.expected_schema_revision}。"
                )
            ),
            "运行 alembic upgrade head，并再次检查 /ready。",
        ),
        _check(
            "jwt_authentication",
            "账户认证",
            inputs.jwt_enabled,
            "JWT 登录与角色权限已启用。",
            "JWT 登录尚未启用。",
            "配置独立的 AI_RADAR_JWT_SECRET。",
        ),
        _check(
            "https_cors",
            "HTTPS 前端来源",
            cors_secure,
            f"已限制 {len(inputs.cors_origins)} 个 HTTPS 前端来源。",
            "CORS 来源为空、包含通配符，或仍使用非 HTTPS 地址。",
            "确定公网域名后，仅保留明确的 https:// 前端来源。",
        ),
        _check(
            "extraction_provider",
            "AI 结构化抽取",
            inputs.extraction_configured,
            "抽取端点、模型和密钥均已配置。",
            "抽取端点、模型或密钥尚未完整配置。",
            "在本机或云平台 Secret 中配置 OpenAI-compatible 抽取服务。",
        ),
        _check(
            "smtp_delivery",
            "摘要邮件投递",
            inputs.smtp_configured,
            "SMTP 主机和发件地址已配置。",
            "SMTP 尚未配置，摘要只会保留在 Outbox。",
            "配置 SMTP，并完成 SPF、DKIM、DMARC 验证。",
        ),
        _check(
            "fetch_allowlist",
            "采集域名白名单",
            inputs.fetch_allowed_hosts > 0,
            f"已登记 {inputs.fetch_allowed_hosts} 个允许采集的域名。",
            "自动采集域名白名单为空。",
            "核验官方信源域名后配置 AI_RADAR_FETCH_ALLOWED_HOSTS。",
        ),
        _check(
            "automatic_sources",
            "自动信源",
            inputs.automatic_sources > 0,
            f"已有 {inputs.automatic_sources} 个有效信源启用自动采集。",
            "尚无有效信源启用自动采集。",
            "先配置域名白名单，再在审核后台逐个启用可信信源。",
        ),
        _check(
            "data_quality",
            "正式数据质量门槛",
            inputs.quality_ready,
            "实体、Claim、证据和关系均达到当前正式验收门槛。",
            "正式数据质量门槛尚未通过。",
            "处理数据质量报告中的缺口，并重新运行黄金问题验证。",
        ),
        _check(
            "worker_heartbeat",
            "自动任务 worker",
            inputs.heartbeat_status == "healthy",
            "worker 心跳正常。",
            f"worker 心跳状态为 {inputs.heartbeat_status}。",
            "检查 worker 容器、数据库连接和最近自动任务错误。",
        ),
    ]
    legacy_check = ProductionReadinessCheck(
        code="legacy_admin_token",
        title="旧管理员令牌",
        status="warning" if inputs.legacy_admin_token_enabled else "ready",
        detail=(
            "静态 X-Admin-Token 仍可获得管理员权限；完成账户初始化后应关闭。"
            if inputs.legacy_admin_token_enabled
            else "静态管理员令牌已关闭，仅使用账户登录。"
        ),
        action=(
            "确认管理员账户可登录后，移除 AI_RADAR_ADMIN_TOKEN 并重启服务。"
            if inputs.legacy_admin_token_enabled
            else None
        ),
    )
    checks.append(legacy_check)
    manual_checks = [
        ProductionReadinessCheck(
            code="public_https",
            title="公网域名与 HTTPS",
            status="manual",
            detail="确认域名解析、TLS 证书、HTTP 跳转和安全响应头。",
            action="在公网入口完成一次浏览器和外部 TLS 检查。",
        ),
        ProductionReadinessCheck(
            code="backup_restore",
            title="备份与恢复演练",
            status="manual",
            detail="确认 PostgreSQL 自动备份、保留周期、异地副本和恢复耗时。",
            action="在独立测试数据库完成一次真实恢复并记录结果。",
        ),
        ProductionReadinessCheck(
            code="external_monitoring",
            title="外部监控与告警",
            status="manual",
            detail="确认 API、worker、数据库、磁盘和证书到期均有外部告警。",
            action="从站外监控一次故障注入和告警送达。",
        ),
        ProductionReadinessCheck(
            code="provider_limits",
            title="供应商额度与限流",
            status="manual",
            detail="确认 AI 与邮件供应商的预算、速率限制和故障联系人。",
            action="设置额度告警，并验证超限时任务会安全重试。",
        ),
    ]
    blocking_count = sum(check.status == "blocked" for check in checks)
    warning_count = sum(check.status == "warning" for check in checks)
    return ProductionReadiness(
        generated_at=now or datetime.now(UTC),
        automated_ready=blocking_count == 0,
        blocking_count=blocking_count,
        warning_count=warning_count,
        checks=checks,
        manual_checks=manual_checks,
    )
