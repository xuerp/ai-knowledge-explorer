# 后端测试索引

运行方式见 [backend/README.md](../README.md)。测试使用隔离数据库和模拟传输；真实付费模型与邮件投递须单独授权，不能从软件回归推断已完成。

| 范围                        | 主要入口                                                                                      |
| --------------------------- | --------------------------------------------------------------------------------------------- |
| API、认证、权限、事务、审核 | `test_api.py`、`test_remembered_login.py`、`test_review_publication_state.py`                 |
| 决策约束、比较和状态合同    | `test_decision_contract.py`、`test_decision_workflow.py`、`test_decision_guidance.py`         |
| 需求语义和模型调用预算      | `test_decision_semantics.py`、`test_decision_runtime.py`、`test_decision_semantic_api.py`     |
| 来源获取与安全              | `test_fetching.py`、`test_safe_dns_36h.py`                                                    |
| 目录、资料和引用            | `test_model_family_catalog.py`、`test_reference_dossiers.py`、`test_model_spec_enrichment.py` |
| 报告和证据请求              | `test_research_report.py`、`test_decision_evidence_requests.py`                               |

带 `_12h`、`_18h`、`_36h`、`_20261023` 等后缀的文件是历史验证批次中固定下来的回归断言，目前仍参与正常测试。文件名不表示要求等待对应小时数，也不表示曾完成当前版本的真实业务验收。

新增测试按功能命名。先确认现有行为覆盖再增补；不要仅因批次后缀删除用例、改写失败输入或缩小验收范围。
