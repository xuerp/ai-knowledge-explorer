# 项目介绍与进度一致性复验 · 2026-10-27

本轮将 `/case-study` 改为使用主站 AppShell、WorkspaceHeader、卡片和内容宽度的项目介绍。移除独立大字号宣传页、数据数量成绩卡和过期的 Portfolio v1 可展示声明。

进度唯一来源为 `product/delivery-status.json`，覆盖浏览、研究、数据、采集通知、展示部署五个模块。页面直接读取，README 与四份作品集文档由 `npm run sync:delivery-status` 同步；`npm run check` 包含漂移检查。历史验收记录保留日期，不视为当前验收。

验证：TypeScript、相关 ESLint、进度同步检查、布局约束检查及生产构建通过。桌面 viewport 1440/client 1425/scroll 1425；手机 viewport 390/client 375/scroll 375，无横向溢出。实际点击知识库入口成功。截图保存在本地 artifacts/full-catalog-verification-20261025/project-about-{desktop,mobile}.png。

跨页检查显示“示例快照”。进一步读取 /api/v2/snapshot 确认本地 API 仍包含 262 个实体、462 条事实；本地验收快照自身 meta.mode 为 demo，不能仅凭标签判断连接异常或数据丢失。已显式重启 8083 指向已有 8002 API，不改写数据模式来宣称持续采集。此次页面进度记录不代表运行时健康状态。

未进行线上部署，不宣称完整作品集验收完成。
