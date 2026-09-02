# AI Radar 项目完成实施 Spec

## 文档信息

- **文档状态**: 待执行
- **创建日期**: 2026-09-02
- **基线分支**: `codex/productionize` (commit `6edd868`)
- **目标**: 将当前"半成品"状态升级为可完整交付的生产就绪系统
- **实施语言**: 中文
- **实施原则**: 先修复必须项，再优化增强项；每个节点独立测试、提交和验证

## 1. 当前状态评估

### 1.1 已完成的基础能力 ✓

- 前后端分离架构（React + FastAPI + PostgreSQL）
- 完整的用户认证与 RBAC 权限系统
- 知识采集、抽取、审核、发布流水线
- 数据质量门槛与黄金问题评估框架
- RAG 检索与引用系统（词法 + 可选 Hybrid）
- 生产环境部署（Cloudflare Workers + Render + Neon）
- CI/CD 与自动化测试

### 1.2 阻塞生产发布的 P0 问题 ✗

根据 [REMAINING_ISSUES_RESOLUTION_SPEC.md](./REMAINING_ISSUES_RESOLUTION_SPEC.md)，以下问题阻止系统从 `demo/cached` 切换到 `live`:

1. **27 条 Claim 缺失实体关联** - 数据完整性问题
2. **16 个核心实体缺 44 条关系** - 知识图谱深度不足
3. **审核队列积压未分类** - 重复/更新/冲突候选混在一起
4. **信源采集状态不明确** - 部分失败/熔断/手动状态未治理
5. **RAG 检索通过率 20%** - 远低于 85% 目标（工具已完成，待部署验证）
6. **依赖问题**: `email_validator` 模块缺失导致测试失败

### 1.3 项目给人"半成品"印象的原因

- **数据质量未达标**: 明确标记为 `demo` 模式，不能作为正式产品
- **功能实现但未验证**: Node A-F 的代码已完成，但历史数据未清理
- **文档与实际状态脱节**: README 声称"超过门槛"但仍保持 `demo/cached`
- **测试基础设施问题**: 依赖缺失导致部分测试无法运行
- **缺少最终部署验证**: 代码在 `codex/productionize`，未合并到 `main`

## 2. 完成定义

项目达到"完成"状态的明确标准：

### 2.1 必须满足 (P0)

- [ ] 所有测试依赖完整，`pytest` 可完整运行
- [ ] `codex/productionize` 合并到 `main` 且 CI 通过
- [ ] 公开 Claim 100% 关联有效实体
- [ ] 16 个核心实体关系数达到 ≥5 条门槛
- [ ] RAG 检索通过率 ≥85%，引用覆盖率 100%
- [ ] 审核队列完成分类与积压清理
- [ ] 信源状态明确（健康/重试/暂停/手动）
- [ ] 数据质量报告通过所有机器门槛
- [ ] 生产环境观察 2 个 Cron 周期无异常
- [ ] 系统切换到 `live` 模式（如数据验收通过）

### 2.2 应该满足 (P1)

- [ ] 构建标识（commit SHA）在健康检查中可见
- [ ] 统一的数据质量基线报告（脱敏版）
- [ ] 外部资源状态诚实反映（SMTP/监控/备份）
- [ ] 完整的回滚操作手册

### 2.3 可选增强 (P2)

- [ ] 付费 embedding 模型集成决策
- [ ] 自定义域名与 DNS 配置
- [ ] SMTP 邮件投递集成
- [ ] 外部监控与告警集成

## 3. 实施路线图

### Phase 1: 基础设施修复（立即执行）

**目标**: 消除测试失败，建立可靠的验证基准

#### Task 1.1: 修复 Python 依赖

```bash
# 检查 requirements.txt 是否包含 email-validator
# 如缺失则添加
cd backend
python -m pip install email-validator
python -m pip freeze | grep email-validator >> requirements.txt
pytest --collect-only  # 验证测试可收集
```

**验收**: `pytest --collect-only` 无 ImportError

#### Task 1.2: 确认当前分支状态

```bash
git status
git log --oneline -5
# 确认工作区干净，当前在 codex/productionize
```

**验收**: 工作区无未提交变更

---

### Phase 2: 数据质量治理（核心价值）

**目标**: 完成 Node B (Claim 实体关联) 和 Node E (核心关系补全)

#### Task 2.1: 审计 Claim 实体关联

```bash
# 使用已实现的 audit_claim_entity_links 生成报告
# 检查 API endpoint: GET /api/v2/admin/claims/entity-audit
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:8000/api/v2/admin/claims/entity-audit
```

**预期输出**:
- 27 条记录分类为：deterministic / manual / ambiguous / unresolved / invalid
- 确定性修复建议列表

#### Task 2.2: 执行确定性实体关联回填

对于 `resolution=deterministic` 的 Claim:

```bash
# Dry run 模式查看影响范围
POST /api/v2/admin/claims/entity-repair
{
  "dry_run": true,
  "max_records": 50,
  "filter": "deterministic"
}

# 确认后执行实际写入
POST /api/v2/admin/claims/entity-repair
{
  "dry_run": false,
  "max_records": 50,
  "filter": "deterministic",
  "operator_reason": "批量修复确定性实体关联缺失"
}
```

**验收**: 
- `missing_or_invalid_count` 从 27 降至手动确认数量
- 发布历史记录所有变更
- 审计日志包含操作者与理由

#### Task 2.3: 手动处理歧义与无效 Claim

对于剩余的 `ambiguous` / `unresolved` / `invalid` 记录:

1. 逐条审核建议的 `recommended_entity_id`
2. 使用管理后台"解析实体关联"功能手动选择
3. 对于确认无业务价值的噪声，使用"撤回"功能

**验收**: 
- `GET /api/v2/admin/data-quality` 返回 `claimsWithMissingEntity: []`
- 公开快照中所有 Claim 都有有效 `entity_id`

#### Task 2.4: 补全核心实体关系

```bash
# 使用关系缺口诊断工具
python -m scripts.diagnose_relation_gaps

# 输出示例:
# Claude Code: 2/5 relations (need 3 more)
# Codex: 2/5 relations (need 3 more)
# ...
```

对于每个缺口实体:

1. 查阅官方文档/代码仓库/论文
2. 在管理后台"扩展模型目录"中添加关系
3. 必须包含 `source_id` (Evidence 引用)
4. 关系类型选择符合本体的 predicate

**目标关系类型**:
- `developed-by`: 开发者归属
- `based-on`: 技术基础
- `uses`: 依赖关系
- `part-of`: 组件归属
- `successor-of`: 版本演进
- `benchmarked-on`: 评测数据集

**验收**:
- 所有核心实体关系数 ≥5
- 每条关系都有有效的 `source_id`
- `GET /api/v2/admin/data-quality` 通过关系覆盖门槛

---

### Phase 3: 审核流程优化（防止数据污染）

**目标**: 完成 Node C (审核队列分类)

#### Task 3.1: 队列分类报告

```bash
# 使用审核统计 API 查看当前积压
GET /api/v2/admin/review-stats

# 预期分类:
# - fresh_safe: 新鲜安全候选
# - deterministic_duplicate: 确定性重复
# - possible_update: 可能更新
# - high_risk: 高风险/冲突
# - invalid_stale: 无效/陈旧
```

#### Task 3.2: 分批处理积压

按优先级处理:

1. **确定性重复**: 合并为已有 Claim 的新 Evidence
2. **无效/陈旧**: 拒绝并记录理由
3. **可能更新**: 逐条选择"替代"/"并存"/"拒绝"
4. **新鲜安全**: 批准发布
5. **高风险/冲突**: 保留人工深度审核

**每批操作后验证**:
- 公开 Claim 数量变化符合预期（重复不应增加）
- Evidence 数量正常增长
- 审计日志完整

**验收**:
- 待审队列 < 20 条
- 无 90 天以上的开放项
- 新鲜候选 48h SLA 达成

---

### Phase 4: 信源稳定性治理（持续更新能力）

**目标**: 完成 Node D (信源状态治理)

#### Task 4.1: 信源状态审计

```bash
GET /api/v2/admin/sources

# 分类输出:
# - healthy: 可自动采集
# - retrying: 瞬时失败，退避中
# - paused: 永久失败，需配置修复
# - manual: 无机器入口，仅人工维护
# - unverified: 未完成预检
```

#### Task 4.2: OpenAI/GPT 官方机器入口启用

OpenAI 已提供机器可读入口:

```text
https://developers.openai.com/api/docs/changelog.md
https://developers.openai.com/api/docs/models.md
https://developers.openai.com/api/docs/deprecations.md
```

操作:

1. 在管理后台"信源与采集策略"中添加上述入口
2. 设置 `fetchUrl` 为 Markdown/JSON 端点
3. `evidenceUrl` 保持官网文章地址
4. 白名单已包含 `openai.com`
5. 触发首次采集观察 Diff 结果

**验收**:
- 首次快照成功生成
- Diff 能检测到新模型/能力变化
- 候选进入审核队列

#### Task 4.3: 处理 `paused` 状态信源

对于永久失败的信源:

1. 检查 `failureKind` (403/404/重定向/体积)
2. 查找同机构备用入口（API/Markdown/RSS）
3. 更新 `fetchUrl` 并重新排队
4. 若无稳定入口，标记为 `manual` 并保留人工快照

**不允许**: 清零失败计数让原错误地址无限重试

**验收**:
- `paused` 信源有明确恢复计划或标记为 `manual`
- 健康信源占比 >80%

---

### Phase 5: RAG 性能验证（用户价值）

**目标**: 完成 Node F (RAG 检索达标)

#### Task 5.1: 本地词法检索评估

```bash
cd backend
python -m scripts.eval_retrieval

# 预期输出 (基于 REMAINING_ISSUES_RESOLUTION_SPEC 节点 F 完成状态):
# Recall@8: 85%+
# Entity Recall@8: 100%
# Precision@8: 14.22%
# 引用覆盖率: 100%
# 生命周期准确率: 100%
# 拒答准确率: 100%
```

**如低于目标**:

1. 检查 PostgreSQL GIN 索引是否生效
2. 确认 `tsvector` 正确包含中英文 Claim 文本
3. 调整 `ts_rank` 权重配置
4. 重新运行评估直到达标

#### Task 5.2: 部署验证

```bash
# 在 staging/production 环境运行:
GET /api/v2/admin/golden-questions

# 确认:
# - 20 个黄金问题通过率 ≥85%
# - 每个回答都包含 claimIds 引用
# - Evidence 校验通过
```

**验收**:
- 生产环境黄金问题评估通过
- 用户可见的研究回答包含明确引用
- 证据不足时正确拒答

---

### Phase 6: 生产就绪验证（交付门槛）

**目标**: 完成 Node A (可观察性) 和 Node H (Live Gate)

#### Task 6.1: 构建标识可见性

```bash
GET /health
# 应返回:
{
  "status": "ok",
  "environment": "production",
  "dataMode": "demo",
  "buildCommit": "6edd868",
  "schemaRevision": "0123456789ab",
  "builtAt": "2026-09-02T12:00:00Z"
}
```

**如缺失**: 更新健康检查端点包含构建元数据

#### Task 6.2: 数据质量报告脱敏

```bash
GET /api/v2/admin/production-baseline
# 返回脱敏的质量指标，不包含任何 Secret
```

**应包含**:
- 实体/Claim/Evidence/Relation 计数
- 核心实体关系覆盖率
- RAG 检索通过率
- 官方证据占比
- 新鲜度（180 天内采集占比）

**不应包含**:
- 数据库连接串
- JWT Secret
- SMTP 密码
- API Keys

#### Task 6.3: 生产就绪检查

```bash
GET /api/v2/admin/production-readiness

# 必须全部通过:
# ✓ PostgreSQL 连接
# ✓ Alembic 迁移最新
# ✓ JWT 配置有效
# ✓ CORS 配置正确
# ✓ 数据质量达标 (Claim ≥150, 关系覆盖 100%)
# ✓ RAG 检索达标 (≥85%)
# ✓ Worker 心跳正常 (<180s)
# ⚠ SMTP 未配置 (可选)
# ⚠ 外部监控未配置 (可选)
```

#### Task 6.4: 观察 2 个 Cron 周期

Cron 当前配置: 每 30 分钟

观察内容:

1. Worker 心跳持续更新
2. 到期信源成功采集
3. 新快照触发抽取
4. 候选进入审核队列
5. 无异常错误累积

**验收**:
- 2 个周期 (1 小时) 内无严重错误
- 健康检查持续返回 200
- 数据库无死锁/连接泄漏

---

### Phase 7: 模式切换（最终里程碑）

**目标**: 从 `demo/cached` 切换到 `live`

#### Task 7.1: 最终数据验收

运行完整验收检查:

```bash
GET /api/v2/admin/data-quality

# 必须全部通过:
# ✓ claimsWithMissingEntity: []
# ✓ claimsWithMissingEvidence: []
# ✓ claimsWithMissingTimestamp: []
# ✓ coreEntitiesWithRelationGaps: []
# ✓ totalClaims ≥ 150
# ✓ officialEvidenceRatio ≥ 60%
# ✓ evidenceFreshness180d: 100%
```

#### Task 7.2: 切换数据模式

```bash
# 更新环境变量
AI_RADAR_DATA_MODE=live

# 重启 API 和 Worker
docker compose restart api worker

# 验证
curl http://localhost:8000/api/v2/snapshot | jq '.dataMode'
# 应返回: "live"
```

#### Task 7.3: 更新文档

更新 README.md:

```markdown
## 当前状态

- 环境：production
- 数据模式：**live** ✓
- 快照新鲜度：实时更新
- 数据质量：通过所有门槛 ✓
```

**验收**:
- 前端不再显示"演示数据"标记
- `/quality` 页面显示 `live` 模式
- 数据质量报告全绿

---

### Phase 8: 分支合并与发布（正式交付）

#### Task 8.1: 合并到 main

```bash
# 确认 CI 通过
git checkout codex/productionize
git pull origin codex/productionize

# 快进合并到 main
git checkout main
git merge --ff-only codex/productionize
git push origin main
```

**验收**:
- GitHub CI 通过
- 前后端测试全绿
- Alembic 迁移验证通过

#### Task 8.2: 生产环境部署

```bash
# Render 自动触发部署
# Cloudflare Workers 构建

# 验证部署
curl https://ai-radar-staging.1966761779.workers.dev/health
```

**验收**:
- `buildCommit` 匹配最新 main 分支 SHA
- 健康检查返回 200
- 前端可访问，无 JS 错误

#### Task 8.3: 最终烟雾测试

用户视角验证:

1. 访问首页，查看最近变化
2. 进入知识库，打开核心实体详情页
3. 使用对比功能比较 GPT/Claude/Gemini
4. 登录后使用研究功能提问
5. 检查引用链接可点击且有效
6. 确认关系图谱可交互

**验收**: 无明显 bug，用户体验流畅

---

## 4. 风险与缓解

### 4.1 数据质量风险

**风险**: 确定性回填算法误判，导致错误关联

**缓解**:
- 先 dry run，人工审核影响范围
- 每批最多 50 条
- 保留完整审计日志
- 发布历史支持追溯

### 4.2 性能风险

**风险**: RAG 检索在生产数据规模下性能下降

**缓解**:
- 确认 PostgreSQL GIN 索引已创建
- 设置查询超时 (5s)
- 准备降级到仅使用演示快照

### 4.3 外部依赖风险

**风险**: 信源网站变更导致采集失败

**缓解**:
- 使用官方 API/Markdown 入口
- 设置合理的失败退避
- 明确区分瞬时失败与永久失败
- 保留人工快照兜底

### 4.4 回滚风险

**风险**: 切换到 `live` 后发现数据问题

**缓解**:
- 数据库迁移只向前兼容
- 环境变量可快速切回 `demo`
- 不删除历史审核记录
- 准备回滚操作手册

---

## 5. 成功标准

### 5.1 技术指标

- [ ] 所有测试通过 (pytest, 前端单元测试)
- [ ] 代码合并到 main 分支
- [ ] CI/CD 绿色
- [ ] 生产环境健康检查 200
- [ ] 2 个 Cron 周期无错误

### 5.2 数据指标

- [ ] 公开 Claim ≥150 条
- [ ] 实体关联完整性 100%
- [ ] 核心实体关系覆盖率 100%
- [ ] 官方证据占比 ≥60%
- [ ] 证据新鲜度 (180d) 100%

### 5.3 用户指标

- [ ] RAG 检索通过率 ≥85%
- [ ] 引用覆盖率 100%
- [ ] 生命周期准确率 100%
- [ ] 拒答准确率 100%
- [ ] 前端无 JS 错误
- [ ] 核心流程可完整走通

### 5.4 文档指标

- [ ] README 状态准确反映系统实际
- [ ] 数据质量报告公开可访问
- [ ] 操作手册完整
- [ ] 回滚流程清晰

---

## 6. 时间估算

| Phase | 任务 | 预计工时 | 依赖 |
|-------|------|----------|------|
| 1 | 基础设施修复 | 0.5h | 无 |
| 2 | 数据质量治理 | 4h | Phase 1 |
| 3 | 审核流程优化 | 3h | Phase 2 |
| 4 | 信源稳定性治理 | 2h | Phase 2 |
| 5 | RAG 性能验证 | 2h | Phase 2-4 |
| 6 | 生产就绪验证 | 2h | Phase 1-5 |
| 7 | 模式切换 | 1h | Phase 6 |
| 8 | 分支合并与发布 | 1h | Phase 7 |

**总计**: 15.5 小时（约 2 个工作日）

---

## 7. 下一步行动

### 立即执行 (今天)

1. 修复 `email_validator` 依赖问题
2. 运行 Claim 实体关联审计报告
3. 执行确定性回填（Dry Run 验证）

### 第二优先级 (明天)

4. 手动处理歧义 Claim
5. 补全核心实体关系至门槛
6. 审核队列分类与积压清理

### 第三优先级 (后天)

7. 信源状态治理与 OpenAI 机器入口
8. RAG 性能验证与部署
9. 生产就绪检查与模式切换

---

## 8. 参考文档

- [REMAINING_ISSUES_RESOLUTION_SPEC.md](./REMAINING_ISSUES_RESOLUTION_SPEC.md) - 详细技术方案
- [ARCHITECTURE.md](./ARCHITECTURE.md) - 系统架构设计
- [PRODUCTION_RUNBOOK.md](./PRODUCTION_RUNBOOK.md) - 生产运维手册
- [backend/README.md](../backend/README.md) - 后端 API 说明

---

## 附录：完成后的项目状态

完成本 Spec 后，AI Radar 将：

✅ **不再是半成品**，而是一个:
- 数据完整且有质量保障的知识系统
- 可持续自动更新的信息采集平台
- 基于证据的 AI 研究工具
- 生产就绪的开源项目

✅ **可以向外界宣称**:
- "正式数据模式运行"
- "通过所有数据质量门槛"
- "RAG 检索性能达标"
- "持续追踪 AI 生态变化"

✅ **可以作为作品集展示**:
- 完整的产品设计与实现
- 严谨的数据质量治理
- 工程化的 AI 应用实践
- 可信 AI 系统的参考实现

---

**批准者签名**: _______________ (项目负责人)
**执行开始日期**: 2026-09-02
**预计完成日期**: 2026-09-04
