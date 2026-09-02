# AI Radar 数据质量治理操作手册

## 前提条件

### 1. 获取管理员访问权限

```bash
# API endpoint
export API_BASE=https://ai-radar-staging.1966761779.workers.dev

# 登录获取 JWT token
curl -X POST $API_BASE/api/v2/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@example.com",
    "password": "your-password"
  }'

# 保存返回的 accessToken
export ADMIN_TOKEN="eyJ..."
```

### 2. 验证权限

```bash
# 检查管理员权限
curl $API_BASE/api/v2/admin/data-quality \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

## 操作流程

### Step 1: Claim 实体关联修复

#### 1.1 生成审计报告

```bash
# 获取完整审计报告
curl $API_BASE/api/v2/admin/claim-entity-audit \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  > claim_entity_audit.json

# 查看统计
cat claim_entity_audit.json | python -c "
import json, sys
data = json.load(sys.stdin)
print(f'Total claims: {data[\"public_claim_count\"]}')
print(f'Linked: {data[\"linked_claim_count\"]}')
print(f'Missing/Invalid: {data[\"missing_or_invalid_count\"]}')
print(f'Deterministic repairs: {data[\"deterministic_repair_count\"]}')
print(f'Manual review needed: {data[\"manual_review_count\"]}')
"
```

#### 1.2 Dry Run 确定性修复

```bash
# 预览修复影响（不写库）
curl -X POST $API_BASE/api/v2/admin/claim-entity-repair \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "mode": "dry_run",
    "resolution_filter": "deterministic",
    "claim_ids": []
  }' \
  > repair_dry_run.json

# 查看将要修复的记录
cat repair_dry_run.json | python -c "
import json, sys
data = json.load(sys.stdin)
print(f'Total repairable: {data[\"repairable_count\"]}')
for item in data[\"items\"][:10]:
    print(f'  - Claim {item[\"claim_id\"]}: {item[\"status\"]} → {item[\"proposed_entity_id\"]}')
"
```

#### 1.3 执行确定性修复（批量）

```bash
# 修复前备份当前状态
curl $API_BASE/api/v2/snapshot > snapshot_before_repair.json

# 执行修复（每批最多 50 条）
curl -X POST $API_BASE/api/v2/admin/claim-entity-repair \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "mode": "apply",
    "resolution_filter": "deterministic",
    "claim_ids": [],
    "operator_reason": "Batch repair: deterministic entity linkage from audit"
  }' \
  > repair_result.json

# 验证结果
cat repair_result.json | python -c "
import json, sys
data = json.load(sys.stdin)
print(f'Repaired: {data[\"repaired_count\"]}')
print(f'Skipped: {sum(1 for i in data[\"items\"] if i[\"status\"] == \"skipped\")}')
print(f'Failed: {sum(1 for i in data[\"items\"] if i[\"status\"] == \"failed\")}')
"
```

#### 1.4 处理歧义记录（逐条）

```bash
# 获取需要人工确认的记录
cat claim_entity_audit.json | python -c "
import json, sys
data = json.load(sys.stdin)
manual_items = [i for i in data['items'] if i['resolution'] == 'ambiguous']
print(f'{len(manual_items)} items need manual review:')
for item in manual_items[:5]:
    print(f\"  - Claim {item['claim_id']}: {item['subject']}\")
    print(f\"    Matches: {item['exact_matches']}\")
    if item.get('recommended_entity_id'):
        print(f\"    Recommended: {item['recommended_entity_id']} ({item['recommendation_reason']})\")
    print()
"

# 对每条歧义记录，手动选择正确实体
# 方法1: 使用修复接口（如果推荐的实体正确）
curl -X POST $API_BASE/api/v2/admin/claim-entity-repair \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "mode": "apply",
    "claim_ids": ["claim-xxx"],
    "operator_reason": "Manual verification: confirmed recommended entity"
  }'

# 方法2: 使用实体解析接口（需要指定不同实体）
curl -X POST $API_BASE/api/v2/admin/claims/claim-xxx/resolve-entity \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "entity_id": "e-correct-entity",
    "reason": "Manual review: subject refers to this specific entity"
  }'
```

#### 1.5 处理无效记录

```bash
# 获取关联了不存在实体的 Claim
cat claim_entity_audit.json | python -c "
import json, sys
data = json.load(sys.stdin)
invalid = [i for i in data['items'] if i['resolution'] == 'invalid']
print(f'{len(invalid)} claims have invalid entity references')
for item in invalid:
    print(f\"  - Claim {item['claim_id']}: entity_id={item.get('entity_id')} (does not exist)\")
"

# 这些记录必须修复才能发布，选择:
# - 修正为正确实体
# - 或撤回 Claim（如果是噪声数据）

# 撤回 Claim
curl -X POST $API_BASE/api/v2/admin/claims/claim-xxx/withdraw \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "reason": "Invalid entity reference, confirmed as extraction noise"
  }'
```

#### 1.6 验收

```bash
# 重新运行审计
curl $API_BASE/api/v2/admin/claim-entity-audit \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  | python -c "
import json, sys
data = json.load(sys.stdin)
if data['missing_or_invalid_count'] == 0:
    print('[OK] All claims have valid entity linkage')
else:
    print(f'[FAIL] Still have {data[\"missing_or_invalid_count\"]} unlinked claims')
"

# 检查数据质量报告
curl $API_BASE/api/v2/admin/data-quality \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  | python -c "
import json, sys
data = json.load(sys.stdin)
print(f\"Claims with missing entity: {data['issues']['claimsWithMissingEntity']}\")
if data['issues']['claimsWithMissingEntity'] == 0:
    print('[PASS] Claim entity linkage check')
"
```

---

### Step 2: 核心实体关系补全

#### 2.1 生成关系缺口报告

```bash
# 运行诊断脚本
cd backend
.venv/Scripts/python.exe -m scripts.diagnose_relation_gaps \
  > relation_gaps_report.txt

# 或通过 API（如果已实现端点）
curl $API_BASE/api/v2/admin/relation-gaps \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

#### 2.2 补充关系（对每个缺口实体）

对于每个低于门槛的实体，查找官方文档并添加关系：

```bash
# 示例: 为 Claude Code 添加关系

# 1. developed-by
curl -X POST $API_BASE/api/v2/admin/relations \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "fromId": "e-claude-code",
    "toId": "e-anthropic",
    "predicate": "developed-by",
    "confidence": "verified",
    "sourceIds": ["src-anthropic-blog-xxx"],
    "description": {
      "zh": "由 Anthropic 开发",
      "en": "Developed by Anthropic"
    }
  }'

# 2. based-on
curl -X POST $API_BASE/api/v2/admin/relations \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "fromId": "e-claude-code",
    "toId": "e-claude-3-7-sonnet",
    "predicate": "based-on",
    "confidence": "verified",
    "sourceIds": ["src-anthropic-docs-xxx"],
    "description": {
      "zh": "基于 Claude 3.7 Sonnet",
      "en": "Based on Claude 3.7 Sonnet"
    }
  }'

# 3. uses（工具/框架）
# 4. part-of（组件归属）
# 5. successor-of（版本演进）
```

**关键要求**:
- 每条关系必须包含 `sourceIds`（Evidence 引用）
- `confidence` 为 `verified` 时必须有官方来源
- 优先添加能清晰展示实体定位的关系

#### 2.3 批量导入关系（可选）

如果有多个关系需要添加，可以准备 JSON 文件：

```json
// relations_batch.json
{
  "relations": [
    {
      "fromId": "e-claude-code",
      "toId": "e-anthropic",
      "predicate": "developed-by",
      "confidence": "verified",
      "sourceIds": ["src-xxx"],
      "description": {"zh": "由 Anthropic 开发", "en": "Developed by Anthropic"}
    },
    // ... 更多关系
  ]
}
```

```bash
# 批量导入
curl -X POST $API_BASE/api/v2/admin/relations/batch \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d @relations_batch.json
```

#### 2.4 验收

```bash
# 重新检查缺口
.venv/Scripts/python.exe -m scripts.diagnose_relation_gaps

# 查看数据质量
curl $API_BASE/api/v2/admin/data-quality \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  | python -c "
import json, sys
data = json.load(sys.stdin)
gaps = data['issues']['coreEntitiesWithInsufficientRelations']
if len(gaps) == 0:
    print('[PASS] All core entities have sufficient relations')
else:
    print(f'[FAIL] {len(gaps)} entities still below threshold')
    for gap in gaps:
        print(f\"  - {gap['entity']}: {gap['current']}/5 relations\")
"
```

---

### Step 3: 审核队列治理

#### 3.1 查看积压状态

```bash
curl $API_BASE/api/v2/admin/review-stats \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  | python -c "
import json, sys
data = json.load(sys.stdin)
print(f\"Pending: {data.get('pending_count', 0)}\")
print(f\"Fresh (<30d): {data.get('fresh_count', 0)}\")
print(f\"Stale (>90d): {data.get('stale_count', 0)}\")
"
```

#### 3.2 处理确定性重复

```bash
# 获取重复候选
curl $API_BASE/api/v2/admin/review/duplicates \
  -H "Authorization: Bearer $ADMIN_TOKEN"

# 合并为已有 Claim 的新 Evidence
curl -X POST $API_BASE/api/v2/admin/review/merge-evidence \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "candidate_id": "cand-xxx",
    "target_claim_id": "claim-yyy",
    "reason": "Duplicate claim, merging as additional evidence"
  }'
```

#### 3.3 处理可能更新

```bash
# 对于同实体同谓词但值不同的候选，选择:

# 选项1: 替代旧事实
curl -X POST $API_BASE/api/v2/admin/review/replace \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "candidate_id": "cand-xxx",
    "supersedes_claim_id": "claim-old",
    "reason": "Updated information from official source"
  }'

# 选项2: 历史并存（时间段不重叠）
curl -X POST $API_BASE/api/v2/admin/review/approve \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "candidate_id": "cand-xxx",
    "lifecycle_action": "coexist",
    "reason": "Valid for different time period"
  }'

# 选项3: 拒绝（如果不是真正的更新）
curl -X POST $API_BASE/api/v2/admin/review/reject \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "candidate_id": "cand-xxx",
    "reason": "Not a genuine update, slight variation only"
  }'
```

---

### Step 4: 信源状态治理

#### 4.1 查看信源健康状态

```bash
curl $API_BASE/api/v2/admin/sources \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  | python -c "
import json, sys
sources = json.load(sys.stdin)
by_status = {}
for s in sources:
    status = s.get('status', 'unknown')
    by_status[status] = by_status.get(status, 0) + 1

print('Source Status Summary:')
for status, count in sorted(by_status.items()):
    print(f'  {status}: {count}')
"
```

#### 4.2 处理 paused 信源

```bash
# 查看失败原因
curl $API_BASE/api/v2/admin/sources/src-xxx \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  | python -c "
import json, sys
s = json.load(sys.stdin)
print(f\"Failure kind: {s.get('failureKind')}\")
print(f\"Failure count: {s.get('failureCount')}\")
print(f\"Last error: {s.get('lastError')}\")
"

# 更新为备用入口
curl -X PATCH $API_BASE/api/v2/admin/sources/src-xxx \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "fetchUrl": "https://example.com/api/docs.md",
    "fetchEnabled": true,
    "reason": "Switched to official machine-readable endpoint"
  }'

# 重新排队
curl -X POST $API_BASE/api/v2/admin/sources/src-xxx/retry \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "reason": "Retry with updated fetch URL"
  }'
```

#### 4.3 启用 OpenAI 官方入口

```bash
# 添加 OpenAI Changelog
curl -X POST $API_BASE/api/v2/admin/sources \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "OpenAI Developer Changelog",
    "publisher": "OpenAI",
    "url": "https://platform.openai.com/docs/changelog",
    "fetchUrl": "https://developers.openai.com/api/docs/changelog.md",
    "fetchEnabled": true,
    "fetchIntervalMinutes": 360,
    "category": "official"
  }'

# 添加 OpenAI Models
curl -X POST $API_BASE/api/v2/admin/sources \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "OpenAI Models Documentation",
    "publisher": "OpenAI",
    "url": "https://platform.openai.com/docs/models",
    "fetchUrl": "https://developers.openai.com/api/docs/models.md",
    "fetchEnabled": true,
    "fetchIntervalMinutes": 720,
    "category": "official"
  }'
```

---

### Step 5: RAG 性能验证

```bash
# 运行黄金问题评估
curl $API_BASE/api/v2/admin/golden-questions \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  > golden_questions_result.json

# 查看通过率
cat golden_questions_result.json | python -c "
import json, sys
data = json.load(sys.stdin)
total = data['total']
passed = data['passed']
print(f'Pass rate: {passed}/{total} ({passed/total*100:.1f}%)')
print(f'Recall@8: {data[\"metrics\"][\"recall_at_8\"]:.1f}%')
print(f'Entity Recall@8: {data[\"metrics\"][\"entity_recall_at_8\"]:.1f}%')
print(f'Citation coverage: {data[\"metrics\"][\"citation_coverage\"]:.1f}%')
"
```

---

### Step 6: 最终验收

```bash
# 完整数据质量检查
curl $API_BASE/api/v2/admin/data-quality \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  > data_quality_final.json

# 生产就绪检查
curl $API_BASE/api/v2/admin/production-readiness \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  > production_readiness.json

# 查看阻塞项
cat production_readiness.json | python -c "
import json, sys
data = json.load(sys.stdin)
blockers = [c for c in data['checks'] if c['status'] == 'failed' and c['level'] == 'blocker']
warnings = [c for c in data['checks'] if c['status'] == 'warning']

if len(blockers) == 0:
    print('[SUCCESS] All production readiness checks passed!')
    print('System is ready to switch to live mode.')
else:
    print(f'[FAIL] {len(blockers)} blockers remaining:')
    for b in blockers:
        print(f\"  - {b['name']}: {b['message']}\")

if len(warnings) > 0:
    print(f'\\n[WARNING] {len(warnings)} warnings:')
    for w in warnings:
        print(f\"  - {w['name']}\")
"
```

## 回滚步骤

如果任何步骤出现问题：

```bash
# 1. 停止自动任务
curl -X POST $API_BASE/api/v2/admin/worker/pause \
  -H "Authorization: Bearer $ADMIN_TOKEN"

# 2. 恢复快照（如果有备份）
# （需要数据库管理员权限）

# 3. 从发布历史中找到最后正常状态
curl $API_BASE/api/v2/admin/publication-history?limit=50 \
  -H "Authorization: Bearer $ADMIN_TOKEN"

# 4. 针对性回滚特定记录
# （使用 audit log 中的操作 ID）
```

## 预估时间

- Step 1: Claim 实体关联 - 2-4 小时
- Step 2: 核心关系补全 - 4-8 小时
- Step 3: 审核队列治理 - 2-4 小时
- Step 4: 信源治理 - 1-2 小时
- Step 5: RAG 验证 - 30分钟
- Step 6: 最终验收 - 30分钟

**总计**: 10-19 小时工作量

## 成功标准

完成所有步骤后，以下应全部为真：
- [ ] `claimsWithMissingEntity: 0`
- [ ] `coreEntitiesWithInsufficientRelations: []`
- [ ] `pendingReviewCount < 20`
- [ ] `healthySourcePercentage > 80%`
- [ ] `goldenQuestionPassRate >= 85%`
- [ ] `productionReadiness.ready: true`
