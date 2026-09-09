# Epic 4 审核可观测性现状核查

核查日期：2026-09-01

## 结论

现有 `review_jobs` 已持久化审核结果、候选创建时间、审核完成时间、审核人、自由文本理由、版本号和决定幂等键；`audit_log` 另有操作人、动作、目标和详情。因此，通过率、驳回率和审核耗时可以直接由现有字段计算，不需要重复建表或复制字段。

现有自由文本 `review_reason` 无法稳定统计驳回原因分布。Epic 4 只新增 nullable `reason_category`，合法值为：

- `unsupported_evidence`
- `duplicate`
- `conflict`
- `schema_error`
- `low_confidence`

`review_reason` 继续作为自由文本备注的持久化字段；API 新名称为 `reasonNote`，并暂时保留 `reviewReason` 兼容旧客户端。没有把数据库列改名为 `reason_note`，避免无业务收益的破坏性迁移。

## 字段与指标映射

| 指标 | 既有字段 | 是否需迁移 | 计算边界 |
|---|---|---:|---|
| 通过率 | `status` | 否 | `approved / (approved + rejected)` |
| 驳回率 | `status` | 否 | `rejected / (approved + rejected)` |
| 审核耗时 | `created_at`, `reviewed_at` | 否 | 已完成记录的非负时间差均值 |
| 最后审核时间 | `reviewed_at` | 否 | 已完成记录最大值 |
| 驳回原因分布 | `review_reason` 只有自由文本 | 是 | 新增 `reason_category` 后按分类聚合 |
| 具体审核说明 | `review_reason` | 否 | 作为 `reasonNote` 返回到受保护审核界面 |
| 审核人 | `reviewed_by` / `audit_log.actor` | 否 | 只用于受保护审计，不进入公开统计 API |
| 并发与幂等 | `version`, `decision_idempotency_key` | 否 | 继续复用现有乐观锁和幂等边界 |

## 历史数据边界

历史驳回记录没有结构化分类，不能从自由文本可靠推断。迁移不回填、不猜测；公开统计将这些记录明确计入 `uncategorized`。这样保留真实历史语义，也避免为了图表完整而制造分类数据。

## 公开面与隐私边界

`GET /api/review/stats` 及 `/api/v2/review/stats` 只公开计数、比例、平均耗时、最后审核时间和原因分类聚合。响应不包含审核人、个别候选、自由文本备注或认证信息。`/admin/review-demo` 在统计接口失败时显示不可用状态，不以演示数字替代真实指标。

## 验证记录

- Alembic `20260901_0022` 已通过全新数据库 upgrade、downgrade 至 `20260831_0021`、再次 upgrade 和单一 head 检查。
- API 回归覆盖缺失分类返回 422、分类与备注持久化、统计增量、版本化别名、历史 `uncategorized` 和敏感文本不出现在公开响应。
- 前端契约覆盖拒绝分类校验、统计 API 路径、真实统计面板和失败不伪造数据。
- GitHub Quality 运行 `33475763045` 在提交 `3c30224` 上前后端全绿；Render staging 已运行同一提交、release `v68` 与 schema `0022`。
- Cloudflare staging Worker 版本 `5124c94a-7a4b-4ad0-8211-dee9a74ab129` 的同域 health、统计 API 和页面均为 HTTP 200；浏览器显示 591 条已审核、32.8% 批准率、67.2% 拒绝率及 397 条历史未分类拒绝，控制台无错误。
