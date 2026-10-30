import fs from "node:fs";
import ts from "typescript";

const sourcePath = new URL("../src/components/research/DecisionGuide.tsx", import.meta.url);
const source = ts.createSourceFile(
  sourcePath.pathname,
  fs.readFileSync(sourcePath, "utf8"),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const groups = {};
function visit(node) {
  if (ts.isVariableDeclaration(node) && ["inputs", "outputs"].includes(node.name.getText(source))) {
    groups[node.name.getText(source)] = node.initializer.elements.map((row) =>
      row.elements.map((value) => value.text),
    );
  }
  ts.forEachChild(node, visit);
}
visit(source);
const lines = [
  "# 决策助手条件与结果说明",
  "",
  "本说明由页面内 DecisionGuide.tsx 自动提取；修改页面说明后运行 node scripts/export-decision-guide.mjs 更新。说明适用于当前本地模块，不代表模型已完成业务测试。",
  "",
  "你的截图中，任务文字要求至少 100k（100000）token，而实际表单为 2000000（200万）token；分析采用表单。当前记录引用的两个版本容量均为 1048576，因此两个候选被排除。这是明确的负面筛选结果，不是请求没有执行。文字里的效果优先与表单的综合平衡也不同。页面现在提示这些差异，可明确选择采用文字描述的值。",
  "",
  "将表单改成 100000 并选择效果质量后，仍需要写明具体业务输入、输出与成功标准。通过已知容量/部署要求只表示可进入验证；当前缺同口径业务效果证据，不能得出哪个模型效果更好的结论。",
  "",
];
for (const [key, heading] of [
  ["inputs", "输入条件"],
  ["outputs", "结果与验证"],
]) {
  lines.push(`## ${heading}`, "", "| 项目 | 含义与实际作用 |", "| --- | --- |");
  for (const row of groups[key]) lines.push(`| ${row[0]} | ${row[2].replaceAll("|", "\\|")} |`);
  lines.push("");
}
lines.push(
  "## 本次排版修正",
  "",
  "六张截图均覆盖：研究标题和摘要字号；分析结果状态；表单对齐及条件单位；候选范围说明；单语言排版报告预览；候选资格展开区的行距与宽度。保留共享导航和键盘焦点，不用缩小到无法阅读的字号掩盖换行。",
  "",
  "Markdown 本身是纯文本，外部编辑器决定它的显示字号。现在另提供同页只读排版报告，以及 HTML 文件下载；可使用排版报告阅读和打印，Markdown 保留给文本处理。导出草稿不会自动保存私人验证记录。",
  "",
);
const outputPath = new URL("../artifacts/decision/fields.md", import.meta.url);
fs.mkdirSync(new URL(".", outputPath), { recursive: true });
fs.writeFileSync(outputPath, lines.join("\n"));
console.log(
  `Exported ${groups.inputs.length} input and ${groups.outputs.length} result explanations.`,
);
