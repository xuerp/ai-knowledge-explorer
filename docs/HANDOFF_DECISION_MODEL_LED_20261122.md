# 交接：决策助手改为“模型提出，后端校验”（2026-11-22）

## 用户已确认的决定

1. 决策助手从“规则决定能否回答、选谁，模型只措辞”改为“模型提出，后端校验”。
2. 8 个场景（`backend/data/decision_scenarios.v1.json`）不再拦截问题，降级为给模型的参考提示。
3. 允许模型使用自身常识，但这部分必须在数据和页面上标为“模型常识，未核验”，与有引用的内容分开。

## 保留的硬约束（后端校验，不合规则删除对应内容或整体打回）

1. 标为“已核验”的每个判断必须引用本次传入的已审核 Claim；其中的数字、价格、日期必须能在被引 Claim 原文中找到（沿用 `answer_generation.py` 的 `_quoted_values` 校验）。
2. 用户明确的硬条件（部署方式、数据边界、排除项、预算上限）必须过滤：违反的候选不能出现在推荐中。
3. 价格未知不能写成免费；证据数量不能说成能力排名。
4. 模型常识内容不得带引用、不得冒充已核验事实；常识中不得给出具体价格、跑分或发布日期。

## 当前状态（未提交、未部署）

- 工作目录：`D:\pycharm\PycharmProjects\AI Radar\p0-gemini-four`，分支 `codex/decision-model-summary`，基于线上 `f270c7a`。
- 已完成 A+D：模型可写结论句（仅 `advice` 结果生效，有条件建议保留规则原句）；新增 `summarySource` / `summaryClaimIds` 字段；结果页显示内容来源说明。
- 改动文件：`backend/app/{schemas,answer_generation,generation_runtime,engagement}.py`、`backend/tests/test_answer_generation.py`、新增 `backend/tests/test_decision_model_summary.py`、`src/components/research/{DecisionGuidanceView.tsx,decision-guidance.css}`、`src/services/user-api.ts`。
- 已验证：后端完整测试通过（若干预设跳过）；前端 412 项测试、tsc、ESLint、Prettier、布局检查通过。
- 未验证：真实模型输出效果、浏览器中的页面样式、结论句校验带来的回退比例。

## 现有问题的代码位置

- 场景外直接拒答：`backend/app/decision_guidance.py` 中 `unsupported_task(context)` 分支（约 750 行），返回“这类任务尚未纳入可核验选型范围”。
- 拒答时模型不参与：`backend/app/engagement.py` 中 `outcome in {"clarify","blocked","unsupported"}` 时 `generation_citations = []`。
- 候选由规则按场景筛选：`decision_candidates.py` 的 `discover_candidates`、`decision_workflow.py`、`decision_plan.py`。
- 模型指令与校验：`backend/app/generation_runtime.py` 的 `BudgetedAnswerGenerator.generate`（最多 4 句、不可改选择）。
- 线上知识库（2026-11-22 只读核对）：271 个对象，其中模型 238 个，含 DeepSeek 等开源系列；简介或标签提到图像/视觉/多模态的 66 个。场景外的问题并非没有资料。

## 实施计划

1. 新增开关 `AI_RADAR_DECISION_MODEL_LED`（默认 false），旧路径不动、可随时切回。
2. 新路径：模型理解任务 → 全库检索（现有 hybrid）→ 模型输出结构化分析：推荐与备选、理由、取舍、资料缺口、第一步；每条标 `basis: verified | model-knowledge`。
3. 后端校验执行上面 4 条硬约束；违反第 2 条的候选从推荐中剔除；违反第 1 条的“已核验”句删除或整体回退。
4. 前端区分显示“已核验（带来源）”与“模型常识，未核验”。
5. 离线测试：用合成模型输出证明 4 条约束守得住；用两道原失败题（开源模型微调 + 单卡 A100；截图视觉审查）作为新路径回归样例。
6. 真实对比：冻结验收题 + 上述两题，新旧路径各跑一次。调用前向用户报告次数和预计费用，获批后执行。单次真实调用约 2 元，与决策预算共用（`AI_RADAR_ANSWER_*`，11 月 19.4 元 / 100 次，12 月需换 `BUDGET_MONTH` 与 `BUDGET_ID`）。
7. 效果确认后设为默认，再删除不再需要的规则与对应测试。

## 测试环境注意

- 本工作区没有 `node_modules`，使用 `D:\pycharm\PycharmProjects\AI Radar\app\node_modules\.bin` 下的 tsc/eslint。
- 后端测试用 `D:\pycharm\PycharmProjects\AI Radar\app\backend\.venv\Scripts\python.exe -m pytest`，必须在沙箱外运行（TestClient 需要本地回环），并加 `--basetemp "D:/pycharm/PycharmProjects/AI Radar/.codex-pytest-tmp"`，否则会卡死或因临时目录权限失败。
- 输出不要接 `Select-Object -Last`，否则进程结束前看不到任何进度。

## 边界

- 不提交、不推送、不部署，除非用户另行确认；Render 环境变量由用户在控制台修改。
- 真实付费调用必须先获批。

## 进度（2026-11-23）：计划第 1–5 步已在本地完成，未提交、未部署

- 开关：`AI_RADAR_DECISION_MODEL_LED`（默认 false；开启要求 `AI_RADAR_RAG_GENERATION_ENABLED=true`）。
- 新模块 `backend/app/decision_model_led.py`：`validate_model_led` 执行 4 条硬约束；`run_model_led` 做一次带预算的调用，失败返回 `model-led-invalid / model-led-provider-error / model-led-unavailable` 并保留规则路径。
- 违反硬条件只剔除“资料与要求矛盾或用户排除”的候选（`VIOLATIONS`：excluded、data-boundary-violated、commercial-use-prohibited、over-budget、context-too-small、unavailable-version、billing-channel-mismatch）；“未核实”类不剔除，由模型在“还需要确认”中说明。被剔除的候选若出现在标题或结论中，整体回退。
- `engagement.py`：新路径对所有 v2 结果运行（包括原来的 clarify/unsupported），全库检索 24 条与原检索合并后最多 40 条传给模型；成功时不再调用旧的回答生成，每次研究只花一次调用。传给模型的证据会存入记录，所有引用都能解析。
- 生成器：`BudgetedAnswerGenerator.analyze`（purpose=`analysis`），模型看到目录摘要（最多 60 个对象），不再受 8 个场景限制。
- 前端：`ModelLedAnalysisView.tsx` + `model-led.css`；有模型分析时显示在顶部，规则结果收进“规则筛选结果（参考）”折叠区；状态标签显示“模型分析已生成”。
- 测试：`backend/tests/test_decision_model_led.py`（10 项，覆盖 4 条约束、原两道失败题、开关关闭不花钱、无效输出回退）。后端完整测试通过；前端 412 项、tsc、ESLint、Prettier、布局检查通过。

## 尚未完成

- 第 6 步真实对比：未执行，需用户批准次数与费用（建议：两道原失败题 + 3 道冻结验收题，新路径各 1 次，约 5 次、约 10 元，占用 11 月 19.4 元预算）。
- 浏览器中的实际样式、移动端排版未看过。
- 导出（Markdown/PDF，`research_report.py`）与公开分享页尚未包含模型分析内容，仍只输出规则结果。
- 一次分析的实际 token 与费用未知；输入可能比旧回答生成大，需真实调用后确认是否低于 65,000 字节上限。

## 规则代码清理计划（2026-11-25，暂不执行）

结论：现在不删除。模型分析失败时，规则版结果就是页面上的兜底；补证请求（`decision_evidence_requests.py`）和使用记录（`decision_validation.py`）也直接调用 `EngagementService._build_decision`。模型分析的成功率还没有实测数据，删掉规则路径就没有兜底了。

### 删除前提（全部满足才开始）

1. 用 5 道固定题实测，模型分析成功率稳定（例如连续 20 次提问中失败不超过 1 次），失败原因都已记录且可解释。
2. 补证请求和使用记录改为不依赖规则候选判断，或者确认保留一个最小化的资格判断模块。
3. 用户确认，模型分析失败时只显示“暂时无法分析，请重试”，不再提供规则版结果。

### 模块与依赖（2026-11-25 统计）

| 模块 | 行数 | 被谁引用 | 相关测试文件 |
|---|---|---|---|
| decision_guidance | 872 | engagement | 15 |
| decision_plan | 737 | decision_explanation、engagement | 4 |
| decision_explanation | 679 | engagement | 3 |
| decision_dialogue | 465 | decision_guidance、engagement | 6 |
| decision_semantics | 405 | 12 个模块，含 schemas、runtime、generation_runtime | 10 |
| decision_candidates | 290 | decision_explanation、decision_intake、engagement、research_report | 8 |
| decision_stages | 262 | decision_guidance、decision_intent、decision_plan | 1 |
| decision_workflow | 250 | engagement | 2 |
| decision_intent | 157 | 8 个规则模块 | 5 |
| decision_resolution | 93 | engagement | 4 |

### 建议删除顺序

1. **先删页面层：** `decision_guidance`、`decision_resolution`、`decision_dialogue`（澄清问题）。模型分析不再需要这些。
2. **再删计划与解释：** `decision_plan`、`decision_explanation`、`decision_stages`、`decision_workflow`。
3. **最后评估：** `decision_candidates`、`decision_intent`、`decision_semantics` 被报告导出、任务理解预算和数据结构引用，需要逐个改写调用方后再删，不能整块移除。
4. 每一步删完都跑后端完整测试，相关测试一起删或改写，不能为了通过而跳过。
