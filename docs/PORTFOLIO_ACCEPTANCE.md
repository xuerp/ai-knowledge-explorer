# AI Radar 作品集验收与截图

验收日期：2026-08-21。验收对象为公开预发布地址 <https://ai-radar-staging.1966761779.workers.dev>。

## 验收结果

| 范围 | 结果 | 证据 |
| --- | --- | --- |
| 桌面首页 | 通过 | Demo 标记、同步时间、证据入口和变化卡正常显示 |
| 桌面图谱 | 通过 | 三种关系任务、分析对象、覆盖指标和关系证据正常显示 |
| 移动图谱 | 通过 | 390×844 视口无页面级横向滚动，底部导航未遮挡主任务卡 |
| 登录边界 | 通过 | 未登录访问 `/account` 时显示邮箱、密码和登录操作，不伪造账户状态 |
| 只读审核后台 | 通过 | 权限边界、数据生产闭环、来源统计和空审核队列正常显示 |
| 异常状态 | 通过 | 不存在的公开研究记录显示明确失败状态，没有回退为演示答案 |
| 工程门禁 | 通过 | 前端 63 项测试和生产构建、后端 107 项测试、Ruff、编译与 SQLite 迁移通过；GitHub CI 继续验证 PostgreSQL |

## 桌面首页

![AI Radar 桌面首页](assets/portfolio/home-desktop.png)

## 桌面关系图谱

![AI Radar 桌面关系图谱](assets/portfolio/graph-desktop.png)

## 移动关系图谱

![AI Radar 移动关系图谱](assets/portfolio/graph-mobile.png)

## 登录账户

![AI Radar 登录账户](assets/portfolio/account-desktop.png)

## 只读审核后台

![AI Radar 只读审核后台](assets/portfolio/review-demo-desktop.png)

## 异常状态

![AI Radar 异常状态](assets/portfolio/error-state-desktop.png)

## 仍需人工完成的外部验收

- 使用现有管理员账号完成一次线上 JWT 登录和真实审核后台浏览；本次自动验收不读取账号密码或浏览器会话。
- 接通 SMTP 后验证实际投递、退信和发件域。
- 配置自定义域后验证 DNS、证书和跨域策略。
- 配置外部监控与告警接收人，并完成 Neon 备份恢复演练。
