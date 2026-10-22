# 决策助手执行说明分段

范围：共享 DecisionGuidanceView 中“从这里开始”的说明排版，适用于内联建议和已保存研究记录。后端、数据库、任务语义、候选选择、复制原文与导出合同不变。

- [x] 复用服务端 trial.procedure 的自然段；只有其内容与 nextAction.instruction 完全相符时采用，避免覆盖不同的下一步。
- [x] 第 1 步／第 2 步独立成段，已有步骤标题加粗；段间距 16px，不缩窄正文。
- [x] 无匹配分步数组的旧记录保留原文及已有换行，不虚构步骤。
- [x] H08 已保存记录实际桌面 1280px、窄屏 iframe 390px 检查：6 段，宽度分别 976px、343px，全部段落使用父容器内容宽度，没有横向溢出。窄屏为真实 CSS 视口检查，非触屏设备仿真。
- [x] 页面显示与原始说明内容一致，实际复制 1141 字符与服务端 executionPrompt 完全一致。
- [x] TypeScript、ESLint、decision-layout 检查及现有 decision-guidance 4 项回归通过；布局扫描无发现。

证据：artifacts/decision-rebuild-20261020/paragraph-layout-review.json、paragraph-desktop.png、paragraph-mobile.png。本次没有新增模型调用，不能将排版验收计入语义新题通过率。发布状态以该提交的 Quality 与 Staging acceptance 为准。
