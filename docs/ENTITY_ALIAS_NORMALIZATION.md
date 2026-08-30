# 实体别名归一化

## 决策

Epic 1B 采用独立 `entity_alias` 表，但它不是第二事实源。实体的 `payload_json.aliases`
仍是管理员 API 与公共快照使用的事实字段；`entity_alias` 保存规范化键和类型，是可在 seed 或
实体 upsert 时完整重建的检索索引。

独立表有实际必要：改造前 49 个实体中只有少量 payload 自带别名，且别名没有类型、规范化键
或可直接索引的结构。若只继续扩展 JSON，数据库无法稳定执行唯一性检查、按类型审计和规范化
查找。

## Schema 与数据边界

迁移 `20260831_0020` 新增：

| 字段 | 用途 |
|---|---|
| `entity_id` | 指向 `knowledge_entities.id` |
| `alias_key` | Unicode NFKC、casefold、下划线转空格、连续空白折叠后的键 |
| `alias` | 保留展示形式 |
| `alias_type` | abbreviation、product-name、qualified-name、spelling-variant、translation、version-name 或 other |

`(entity_id, alias_key)` 是主键；`alias_key` 和 `alias_type` 各有索引。迁移只把既有 payload
别名标成 `other`，随后仓库 seed 会按版本化目录同步准确类型。管理员新增的非目录别名保留并标成
`other`，不会被 seed 覆盖。

## 版本化目录与消歧

`backend/data/entity_aliases_v1.json` 版本为 `1.0.0`，包含 24 条已审计别名，覆盖 Spec
诊断使用的全部 19 个核心实体。`GPT-5` 指向具体版本 `e-gpt-5`，而不是系列 `e-gpt`；系列仍由
`ChatGPT`、`GPT-4` 覆盖。这样避免版本规范名与系列别名同时命中造成歧义。

目录加载会拒绝：

- 缺少版本、实体、别名或非法 `alias_type`；
- 同一实体中的规范化重复项；
- 跨实体的目录别名歧义；
- 指向不存在实体的别名；
- 与无关实体规范名冲突的别名。

同一模型系列与具体版本之间的名称重合是合法关系；公司和产品的同名规范名也允许存在。检索仍以
规范名优先，并通过系列展开保持原有语义。

## 查询与可复现评估

查询识别和目录使用同一个规范化函数，因此 `Crew_AI`、`Crew AI` 以及全角 `ＭＣＰ` 等输入会
得到确定性一致结果。别名同时进入 lexical 检索文档，不启用 Embedding 或外部模型调用。

前后对照由 `scripts/eval_alias_normalization.py` 执行，固定使用 Golden Set v1.0.0、
2026-08-30 公开快照及 TopK=8。主评估必须分别保留整体和实体类别指标；由于该 Golden Set 的
实体 Recall@8 在改造前已经达到 100%，脚本另以同一快照逐条执行 24 个确定性别名探针，诚实记录
新增覆盖，不修改 Golden Set 来制造提升。
