# Staging 审核库存与抽取验收（2026-09-08 至 2026-09-09）

## 最新结论（2026-09-09）

抽取链路的缺口已修复并在 staging 闭环验收：

- 新抽取只保留能在快照中定位的原文证据，不再向队列写入无锚点候选。
- 中英文候选可从声明中解析已知实体；重复抽取会修复已有候选的证据和实体绑定，不制造重复项。
- 线上重跑 `Gemini Audio 官方模型页` 后，生成 1 条“新鲜安全候选”：`review-f65709e262770c8994d7`。
- 该候选的实体、官方来源和逐字证据锚点通过校验，已单条批准并进入审核历史。
- 用户确认后，44 条确定性无效候选已以 `schema_error` 拒绝，并保留审计历史。
- 当前待处理 **0** 条：全部待审 0，新鲜安全 0，确定性无效 0。

## 本轮发布与验收证据

- 前端缓存修复：`3cb34c081658`，Service Worker 升级且 `/assets/` 不再走旧缓存。
- 抽取与实体修复：`c8c538ac09d663504407ae2c257f8c7c13620996`。
- staging 管理后台显示构建 `c8c538ac09d6`，迁移 `20260905_0023`。
- GitHub Quality #263 通过：<https://github.com/xuerp/ai-knowledge-explorer/actions/runs/34305432688>。
- Cloudflare 发布标记与完整 commit 一致：<https://ai-radar-staging.1966761779.workers.dev/releases/c8c538ac09d663504407ae2c257f8c7c13620996.txt>。
- 审核后台：<https://ai-radar-staging.1966761779.workers.dev/admin/review?probe=c8c538a>。
- 抽取源：`Gemini Audio 官方模型页`，<https://deepmind.google/models/gemini-audio/>。
- 已批准声明：“Gemini 3.5 Transcribe 可处理实时语言切换。”
- 原文锚点：`Gemini 3.5 Transcribe handles live language switches and seamless streaming transcription.`

## 代码验证

- 后端定向测试：88 通过。
- 后端全量测试：通过。
- Ruff lint / format：通过。
- 前端测试：118 通过，0 失败。
- 前端生产构建：通过。
- `npm run typecheck` 与 `npm run check` 仅被用户未追踪的 `src/routes/landing.tsx` 现有错误阻塞；本轮未修改该文件。

## 初始只读基线（2026-09-08）

E0 运行时安全核验和 E1 审核库存分级完成时，34 条开放候选全部未达到批准条件，批准就绪数为 0。下文保留当时的基线明细，用于与本轮写操作后的 44 条无效库存对照。

## 证据边界

- 核验环境：staging，2026-09-08（Asia/Shanghai）。
- 前后端构建：`b12c808d5739079ecaadfcbc8da056cd5249691f`。
- 认证：短期管理员 JWT 登录态；没有记录或输出凭据。
- 方法：管理后台及只读 GET 接口；未触发采集、抽取、批准、拒绝、合并或修复。
- GitHub Secret Scanning：已启用，页面显示 0 个未解决 Secret。
- 旧静态管理员令牌：运行时已禁用，仅允许 JWT。
- 自动候选抽取：配置存在但自动抽取关闭。
- 关系自动批准：关闭；历史关系批次已完成，自动批准数为 0。

## 初始 E1 聚合结果

| 指标                     |           结果 |
| ------------------------ | -------------: |
| 开放 / 已批准 / 已拒绝   | 34 / 195 / 397 |
| 与已发布事实重复         |              0 |
| 队列内确定性重复组       |              0 |
| 可能更新组（可重叠标记） |              2 |
| 冲突候选（可重叠标记）   |              1 |
| 高风险（后端可重叠标记） |              2 |
| 超过 90 天               |              0 |
| 无效原文锚点             |             33 |
| 缺少 Evidence            |              0 |
| 互斥主通道：确定性无效   |             34 |
| 批准就绪                 |              0 |

“主通道”和“风险标记”不是同一维度。主通道互斥，并把缺实体、缺 Evidence、无有效原文锚点作为最高优先级，因此 34 条都进入“确定性无效”；可能更新、冲突和高风险是可重叠的辅助标记。页面文案已调整为明确区分这两套口径，未改变分类优先级或审核规则。

## 初始逐项盘点

### 缺少实体绑定（1）

| ID                            | 候选                                            | 证据情况                                | 建议                                     |
| ----------------------------- | ----------------------------------------------- | --------------------------------------- | ---------------------------------------- |
| `review-17d8671d7bbfbbf4544b` | Gemini Audio 是基于 Gemini 构建的实时音频模型。 | 有弱锚点 `Gemini Audio`，但缺少实体绑定 | 补实体与完整原文锚点后重审；当前不可批准 |

### 带风险或冲突提示，且原文锚点无效（4）

| ID                            | 候选                                                                                                    | 辅助标记                       | 建议                 |
| ----------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------ | -------------------- |
| `review-16f00a31ba9c2dca7819` | Gemini Audio 可通过 Gemini API 使用。                                                                   | UI 高风险                      | 补原文锚点后逐条重审 |
| `review-6071afa1b37ef1388564` | Lyria 可在 Gemini app、Google Flow Music、Google AI Studio 和 Gemini Enterprise Agent Platform 中使用。 | 高风险、结构化冲突、需更多证据 | 先解决冲突并补锚点   |
| `review-26d84468ea50eeea697d` | CrewAI 集成了 Model Context Protocol。                                                                  | UI 高风险、需更多证据          | 补锚点后逐条重审     |
| `review-707eba063c05c8c4eba5` | Manus 的连接器可访问包括 MCP 服务器在内的第三方数据和 API。                                             | UI 高风险、需更多证据          | 补锚点后逐条重审     |

UI 风险评估与后端库存风险聚合使用的规则不同，所以 UI 可见 4 条高风险提示，而后端聚合为 2。这是辅助信号口径差异，不影响“当前不可批准”的结论。

### 其余原文锚点无效（29）

| ID                            | 候选                                                                                            |
| ----------------------------- | ----------------------------------------------------------------------------------------------- |
| `review-a32e65582ecafdabbdae` | Gemini Audio 可进行对话、创作和控制音频。                                                       |
| `review-777e22a77b03c72fe954` | Gemma 可用于大规模构建负责任的 AI 应用。                                                        |
| `review-ac289800371f8eefbf29` | Doubao-Seed 1.8 属于豆包 Doubao 大模型。                                                        |
| `review-e2776c8832d0aa23ff40` | WeatherNext 提供快速且准确的 AI 天气预报。                                                      |
| `review-2190534c942419e0f882` | AlphaFold 能够高精度预测蛋白质结构。                                                            |
| `review-718f1223dadb02118e5a` | Gemma 用于大规模构建负责任的 AI 应用。                                                          |
| `review-073e6324e67926cdd2a9` | Genie 3 能够生成并探索互动世界。                                                                |
| `review-f88a4ac6fb7a5b02b6f7` | Imagen 能够根据文本生成高质量图像。                                                             |
| `review-d195b7a26b307794b21a` | Gemini Audio 是基于 Gemini 构建的高级实时音频模型。                                             |
| `review-44ce00c035c312b3aac8` | Gemini Omni 能够从视频开始创作任何内容。                                                        |
| `review-5668bfe9cffbd2645904` | Gemma 是开放模型。                                                                              |
| `review-ce5b7367866d3f5174e2` | Lyria 可生成高保真音乐和音频。                                                                  |
| `review-e93f9e00609cf669b892` | Veo 可生成带音频的电影级视频。                                                                  |
| `review-98cb7e26810f705ffd4c` | Nano Banana 可使用 Gemini Image 创建和编辑图像。                                                |
| `review-afeaae6a130c829d1b00` | SIMA 2 可以与你一起玩、推理和学习。                                                             |
| `review-c2cb55fda1583fda500d` | AlphaEvolve 可为数学和计算应用设计先进算法。                                                    |
| `review-514049312a0430c8dff7` | WeatherNext 用于 AI 天气预报。                                                                  |
| `review-1c2b4fec7474191690f0` | AlphaFold 能够预测蛋白质结构。                                                                  |
| `review-f1c60e8123b5e9753c2b` | Gemini Robotics 能够感知、推理、使用工具并进行交互。                                            |
| `review-2b64c9b3a3740abcffde` | Gemini Robotics ER 2 于 2026 年 7 月公布。                                                      |
| `review-fdc93700870a40b586b1` | Gemma 是开放模型。                                                                              |
| `review-edc172123b02d406f000` | Veo 可在 Gemini app、Google Flow、Google AI Studio 和 Gemini Enterprise Agent Platform 中使用。 |
| `review-032c64b4105081990abb` | Nano Banana 可在 Gemini app、Google AI Studio 和 Gemini Enterprise Agent Platform 中使用。      |
| `review-8132015e5b9b882e6ed1` | Gemini Audio 可通过 Google AI Studio、Gemini API 和 Gemini Live API 使用。                      |
| `review-5aa1a4fcb32b067f2163` | Gemini 3.5 Transcribe 是语音转文本模型。                                                        |
| `review-feef2461e1bc93334a06` | Gemini 3.7 Flash 于 2026 年 8 月发布。                                                          |
| `review-6e7f55d7596d67da0527` | Google DeepMind 页面列出 Gemini Omni 1.1 Flash。                                                |
| `review-7315f4d368b58c7f89a8` | AutoGen 可集成 Model Context Protocol 工具。                                                    |
| `review-d99cab07dd027dc19894` | OpenAI Codex 可通过 Secure MCP Tunnel 连接到私有或本地部署的 Model Context Protocol 服务器。    |

## 已完成的执行节点

### 方案 A：保守清理

用户已明确确认整组 44 条；系统以标准化 `schema_error` 原因拒绝确定性无效项，并保留审计记录。

- 优点：最快消除无效库存，不会把无证据事实发布出去。
- 代价：可能丢失可通过补证恢复的候选；拒绝后若要恢复，需要重新生成或重新入队。
- 执行结果：待审队列 44 → 0，确定性无效 44 → 0；最近审计可见批量 `review.rejected` 记录。

### 方案 B：保留库存继续补证（未执行）

保留这 44 条，逐条补齐实体绑定和可定位的 Evidence 原文锚点，再重新进行重复、更新、冲突与风险判断。

- 优点：最大限度保留有价值内容，形成可追溯事实链。
- 代价：需要更多人工核验和受控写入；若需要重新抓取或调用模型，必须另行授权预算。
- 建议顺序：新抽取已有可验证的替代事实，因此建议优先执行方案 A，清空历史无效库存；只对明确有独特价值的候选使用方案 B。

方案 A 已完成，方案 B 不再是当前待执行节点。
