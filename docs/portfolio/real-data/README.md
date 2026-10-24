> 2026-10-25 更正：已撤销两对象资料集作为应用数据源的改动，恢复完整目录与原页面入口。本文涉及小资料集的运行和验收内容仅为历史记录，不代表完整产品交付。当前运行方式以[项目 README](../../../README.md)为准。

# 真实来源资料集

核对日期：2026-10-24。范围：Dify 和 LangChain 固定版本的官方 README。

`snapshot.json` 是知识快照；`sources.json` 是来源清单。事实是对官方文档的人工整理，不是付费模型抽取结果，也不是亲自部署后的效果测量。

- 2 个实体、6 条事实、6 个引用片段，来自 2 份官方文件。
- URL 固定到 commit，SHA-256 对原始 HTTP 字节计算，不对 Windows 换行转换后的文件计算。
- `checkedAt` / `collectedAt` 为核对或采集时间，未知的 `publishedAt` 留空。
- 知识要点由对应 Claim 派生，不新增未经来源支持的能力。
- 用户活动、研究答案、通知、更新与图谱边不预填。
- `meta.mode=demo` 是现有运行模式，不宣称生产实时运行。

在仓库根目录执行：

```bash
python scripts/verify-portfolio-sources.py
python scripts/verify-portfolio-sources.py --fetch
```

第一条检查本地引用；第二条重新获取官方文件，比较哈希和摘录。核验成功不能推导出部署性能、价格或选型结论。
