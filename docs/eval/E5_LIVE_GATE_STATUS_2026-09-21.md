# E5 Live Gate 状态快照

日期：2026-09-21

范围：只读核验当前 staging 构建、公开快照、GitHub 安全扫描与 Render 配置项名称。未读取或输出 Secret，未调用外部模型，未修改运行配置，未切换 `live`。

## 当前判断

E5 尚未通过，继续保持 `demo/staging`。

`demo` 是门禁通过前的安全状态。生产预检应将它报告为切换警告。本次上线采用 Outbox 模式，邮件外部投递延期并显示警告；真实自动阻塞项仍由数据质量、运行环境等检查决定。

## 已核验证据

- 产品功能验收基线为 `f0976baa9baccf203387f17598fcb03c84b57825`；GitHub Quality #326 与 Staging acceptance #42 通过。
- 后续只读审计工具提交 `1384439dd2170b9983eaf99b0b3d6723b70f44fe` 通过 Quality #328 与 Staging acceptance #44，双端完整 SHA 一致且 smoke 通过。
- Render `/ready` 返回 `ok=true`，schema 为 `20260905_0023`，数据模式为 `demo`。
- Cloudflare 不可变 release marker 与 Render 返回同一完整提交。
- staging smoke 通过；前端返回 200，公开 API 返回 49 个实体。
- 当前公开快照包含 49 Entity、150 Claim、171 Evidence、71 Relation、55 Timeline 和 15 Change。
- 15 条公开 Change 均由已审核、带 `validFrom` 的事件型 Claim 投影；实体和 Evidence 引用可解析。
- 核心模型 manifest 的 8 个实体均可在公开快照解析。
- GitHub Secret Scanning 显示 0 个未解决 Secret。
- `admin_token.txt` 不在仓库 tip，且由 `.gitignore` 忽略；历史提交仍保留文件记录。
- Render 配置项中存在邮件 provider 与 API URL，但未发现 `AI_RADAR_EMAIL_API_KEY` 或 `AI_RADAR_SMTP_FROM`。
- Cloudflare Cron 配置为 `*/30 * * * *`；GitHub Automation 只保留 `workflow_dispatch`。

## 仍未满足的门禁

1. **凭据事件闭环**：旧凭据已失效与相关 Secret 已轮换仍需外部确认；不得用历史改写代替轮换。
2. **最新管理员机器门禁**：需要短期管理员 JWT 重新读取 `/api/v2/admin/data-quality`、`/api/v2/admin/production-readiness`、`/api/v2/admin/operations` 和 `/api/v2/admin/release-baseline`。当前本机进程没有只读审计凭据。
3. **邮件投递（延期）**：本次仅验收 Outbox 的安全保留，不配置外部投递；后续启用时再验证邮件 API key、发件域名与一次受控投递。
4. **数据质量**：最近一次管理员审计仍为 `liveReady=false`，核心关系覆盖是数据阻塞；不得为满足数量阈值编造关系。
5. **外部人工门禁**：正式域名与 TLS、安全头、备份恢复、站外监控、供应商额度与告警仍无当前验收记录。
6. **正式环境决策**：正式发布分支、Render 服务、Cloudflare Worker、数据库、域名、发布窗口、回滚提交和责任人尚未定义。

## 下一次可执行顺序

1. 由负责人确认旧凭据轮换结果，并提供短期管理员 JWT 到进程环境；只运行仓库内的只读审计命令。
2. 根据只读审计输出记录真实自动阻塞项，不调整阈值或数据模式。
3. 重新读取 production readiness，确认未配置邮件显示 Outbox 警告而非阻塞。
4. 完成域名、备份恢复、外部监控和供应商额度的人工记录。
5. 只有 `liveReady=true`、自动阻塞为 0、人工门禁完成且正式环境责任表明确后，才提出精确提交的生产发布授权请求。
