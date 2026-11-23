# 交接：知识库持续更新（2026-11-22）

## 用户已确认的决定

1. 抽取预算每月 5 元，独立 `BUDGET_ID`（`AI_RADAR_EXTRACTION_BUDGET_*`），不占决策助手的 `AI_RADAR_ANSWER_*` 预算。先修 `schema_error`，再花钱。
2. 首批只开 1 到 2 个更新频繁的官方信源（如 OpenAI、Anthropic 更新日志），先跑 3 个快照测出单次成本。
3. 自动批准（`AI_RADAR_AUTO_APPROVE_GROUNDED_RELATIONS`）先不打开：第一批候选全部人工审核，并离线对照“若开启会自动通过哪些、是否有错”；零错误后再打开。
4. 其他事实（价格、上下文长度等）继续人工审核，对外承诺 3 天内审核；超时在后台和 `/quality` 标红。
5. 六类可逐字核验的关系，目标从采集到 `/updates` 发布 24 小时内。
6. RAG 生成不对匿名访客开放。访客继续走抽取式回答，页面说明“登录并开通后可使用模型生成”；作品集用 3 到 5 个真实生成的公开分享链接展示（已有 `/share/pdf-09e35142`）。

## 2026-11-22 只读核对结果

- `/api/v2/review/stats`：待审 0，已审 234（批准 166、驳回 68），最后审核 2026-11-11。驳回原因 `schema_error` 63 条（93%）、`unsupported_evidence` 5 条。
- `/api/v2/updates`：最新动态 2026-11-18，最新证据采集 2026-11-21，来自手工补录（`p0-gemini-four`），不是自动流程。
- `/health`：`buildCommit=f270c7a`，`dataMode=demo`。
- 线上配置（据 README，未独立读取）：抽取接口 SoleAPI，`AI_RADAR_AUTO_EXTRACTION_MAX_SNAPSHOTS_PER_CYCLE=0`。

## 机制（代码 f270c7a）

- 调度：Cloudflare Cron（`ops/cloudflare-cron/wrangler.json`，`*/5` 与 `*/30`）调用 `POST /api/v2/automation/run-cycle`，依次执行采集、摘要、邮件、`run_extraction_cycle`。注意 `AI_RADAR_API_BASE_URL` 指向 `ai-radar-api-staging.onrender.com`，需核实是否就是当前线上后端，以及最近是否有 `scheduled` 周期记录。
- 自动抽取启用条件（`backend/app/services/extraction.py` 的 `automatic_extraction_enabled`）：抽取已配置、每轮上限 > 0、生产环境须有 `budgeted_generator`（`AI_RADAR_EXTRACTION_BUDGET_ENABLED=true`）；信源须在 `AI_RADAR_EXTRACTION_SOURCE_IDS` 中。
- 自动批准条件：`is_grounded_relation_auto_approvable`（同文件）。
- 站内没有更新时限检测或告警。

## 实施顺序

1. 核实调度：用户登录后在控制台读取 `GET /backend/api/v2/admin/operations`，确认 Cron 指向线上后端且有近期 `scheduled` 周期。
2. 复现并修复 `schema_error`：取历史驳回样本的原始输出，修抽取的结构约束；离线回放历史失败样本，再跑新样本。
3. 新增更新时限与审核积压检测（24 小时 / 3 天），在后台、`/quality` 与运行记录中展示，并补测试。
4. 用户在 Render 配置抽取预算与信源后，小批量运行；完整核对：采集 → 抽取 → 人工审核 → 发布 → `/updates` 页面变化，并核对 SoleAPI 账单。
5. 对照第一批审核结果评估自动批准，零错误后由用户打开开关。
6. 访客页面补充“登录并开通后可使用模型生成”的说明。

## 环境与边界

- 建议基于 `f270c7a` 另开工作目录或分支，不要混进 `codex/decision-model-summary`（决策助手重构见 `docs/HANDOFF_DECISION_MODEL_LED_20261122.md`）。
- 测试环境注意事项同决策助手交接文档：后端测试在沙箱外运行并加 `--basetemp`；借用 `app/node_modules/.bin`。
- 不提交、不推送、不部署，除非用户另行确认；Render 环境变量由用户修改；真实抽取调用前先报告次数和预计费用。
