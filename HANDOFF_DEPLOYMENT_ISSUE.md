# AI Radar 部署问题交接文档

## 问题概述

**当前状态**: 用户在 `codex/productionize` 分支修复了组件 shadowing 问题（移除了旧的 timeline 代码），并推送了提交 `98d08b7`，但访问 staging 站点时新组件仍未显示。

**根本原因**: 项目的前端部署流程是**手动**的，GitHub Actions 只做质量检查，不会自动部署到 Cloudflare Workers。

---

## 部署架构

### Backend API
- **平台**: Render
- **配置文件**: `render.yaml`
- **监听分支**: `codex/productionize`
- **自动部署**: ✅ 已配置 `autoDeployTrigger: commit`
- **URL**: https://ai-radar-api-staging.onrender.com

### Frontend
- **平台**: Cloudflare Workers
- **当前 URL**: https://ai-radar-staging.1966761779.workers.dev/
- **Worker 名称**: `ai-radar-staging` (在 `scripts/prepare-cloudflare-deploy.mjs` 中定义)
- **自动部署**: ❌ **需要手动执行 `wrangler deploy`**

---

## 部署流程详解

### 1. GitHub Actions (`quality.yml`)
```yaml
# 仅做质量检查，不部署
jobs:
  frontend:
    steps:
      - name: Verify Cloudflare staging build and config
        run: |
          bun run build:staging
          bun run verify:cloudflare:staging
          bun run prepare:cloudflare:staging
```

**作用**:
- 验证代码能成功构建
- 生成 `.output/server/wrangler.staging.json` 配置
- **不执行部署**

### 2. 构建命令
```json
// package.json
{
  "build:staging": "vite build --mode staging",
  "verify:cloudflare:staging": "node scripts/verify-staging-build.mjs",
  "prepare:cloudflare:staging": "node scripts/prepare-cloudflare-deploy.mjs"
}
```

**`scripts/prepare-cloudflare-deploy.mjs` 作用**:
- 读取 `.output/server/wrangler.json`
- 生成 `.output/server/wrangler.staging.json`，包含:
  - Worker 名称: `ai-radar-staging`
  - API 上游地址: `https://ai-radar-api-staging.onrender.com`
  - 兼容日期: `2026-08-13`

### 3. 手动部署步骤

**当前缺失的步骤** - 需要在本地或 CI 中执行:

```bash
# 1. 构建 staging 版本
bun run build:staging

# 2. 验证构建
bun run verify:cloudflare:staging

# 3. 准备 wrangler 配置
bun run prepare:cloudflare:staging

# 4. 使用 wrangler 部署到 Cloudflare Workers
npx wrangler deploy --config .output/server/wrangler.staging.json
```

---

## 为什么 Cloudflare Pages 显示 "No projects found"

Cloudflare Pages 和 Cloudflare Workers 是**两个不同的产品**:

- **Cloudflare Pages**: 用于静态站点和 SSR 框架的托管平台
- **Cloudflare Workers**: 用于运行 JavaScript/TypeScript 的 serverless 函数

**AI Radar 使用的是 Cloudflare Workers，不是 Pages**，所以:
- Workers & Pages 控制台中的 "Pages" 标签页显示 "No projects found" 是正常的
- 应该查看 "Workers" 标签页来找到 `ai-radar-staging` Worker
- Worker URL 格式: `https://<worker-name>.<account-id>.workers.dev/`
  - 当前: `https://ai-radar-staging.1966761779.workers.dev/`

---

## 已完成的修复

### Commit `98d08b7`: 移除旧的 timeline 组件
**文件**: `src/routes/knowledge_.$type.$slug.tsx`
**删除行数**: 349-380

**删除的代码**:
```tsx
{timeline.length > 0 && sectionVisible("timeline") && (
  <section data-reading-section="timeline" style={{ order: sectionPresentation.timeline.order }}>
    <SectionHeading
      eyebrow={sectionPresentation.timeline.eyebrow}
      title={t("时间线", "Timeline")}
      description={t("按时间记录发布、更新、评测与重要事件。", "Releases, updates, benchmarks and important events in chronological context.")}
    />
    <div className="space-y-3">
      {timeline.map((event) => (
        <article key={event.id} className="paper-card flex gap-4 p-4">
          <CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-signal" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <time className="font-mono text-xs text-signal">{event.date}</time>
              <h3 className="font-semibold">{pick(event.title, lang)}</h3>
              <ConfidenceChip level={event.confidence} />
            </div>
            <p className="mt-2 text-sm leading-relaxed text-ink-soft">
              {pick(event.summary, lang)}
            </p>
          </div>
        </article>
      ))}
    </div>
  </section>
)}
```

**为什么删除**:
- 这段代码在 `TimelineHero` 组件之后渲染
- 用户看到的是这个旧的垂直 timeline（蓝色圆点 + 卡片列表）
- 新的 `TimelineHero` 在 lines 184-192 但被旧代码的视觉效果掩盖
- 删除后，只保留新的横向交互式 timeline

---

## 待部署的新组件

### 1. TimelineHero (lines 184-192)
```tsx
{timeline.length > 0 && (
  <div className="mt-8">
    <TimelineHero
      events={timeline}
      sources={sources}
      entityName={pick(entity.name, lang)}
    />
  </div>
)}
```
**文件**: `src/components/knowledge/TimelineHero.tsx`
**特性**: 横向交互式时间线，节点可点击查看详情

### 2. ReadingModeSelector (lines 171-181)
```tsx
<div className="mt-8">
  <ReadingModeSelector
    value={mode}
    onChange={(newMode) => {
      // TODO: Implement mode change via router navigation
      console.log("Mode change requested:", newMode);
    }}
  />
</div>
```
**文件**: `src/components/knowledge/ReadingModeSelector.tsx`
**特性**: 三个按钮（General/Product/Technical），带图标和视觉反馈

### 3. DensityAwareSection (lines 196-206, 209-274)
**文件**: `src/components/knowledge/DensityAwareSection.tsx`
**特性**: 根据 reading mode 显示不同密度的内容（Focus/Supporting/Hidden）

---

## 待完成的工作

### 1. 立即任务：部署到 Cloudflare Workers
```bash
# 在本地执行（需要 Cloudflare API token）
bun run build:staging
bun run prepare:cloudflare:staging
npx wrangler deploy --config .output/server/wrangler.staging.json
```

**或者**配置 GitHub Actions 自动部署:
```yaml
# 在 .github/workflows/quality.yml 添加
- name: Deploy to Cloudflare Workers (staging only)
  if: github.ref == 'refs/heads/codex/productionize'
  run: npx wrangler deploy --config .output/server/wrangler.staging.json
  env:
    CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
```

### 2. 后续优化任务（按优先级排序）

#### 高优先级
1. **替换剩余的 ReadingModeSection** (lines 298-376)
   - 当前仍在使用旧的 `ReadingModeSection` 组件
   - 应替换为 `DensityAwareSection`
   
2. **实现 ReadingModeSelector onChange**
   - 当前只有 `console.log`
   - 需要通过 router navigation 切换 mode

3. **删除未使用的 ReadingModeSection 组件**
   - 文件位置: lines 383-400
   - 所有使用点替换后删除

#### 中优先级
4. **扩展 timeline 数据**
   - GPT: 从 6 个事件扩展到 15-20 个
   - Claude, Gemini, DeepSeek: 扩展到 15-20 个
   - 添加 8-10 个核心模型的完整 timeline

5. **设计首页统一 timeline 视图**
   - 将多个模型的 timeline 合并展示
   - 展示最新的重要模型动态

#### 低优先级
6. **移动端优化**
   - TimelineHero 在小屏幕上的交互优化
   - ReadingModeSelector 在移动端的布局调整

---

## 技术栈参考

- **Frontend Framework**: React + TanStack Router
- **Build Tool**: Vite + Nitro (生成 Cloudflare Workers 兼容的输出)
- **Styling**: Tailwind CSS + shadcn/ui
- **Icons**: Lucide React
- **Deployment**:
  - Backend: Render (Docker + FastAPI + PostgreSQL)
  - Frontend: Cloudflare Workers (Nitro SSR)

---

## 相关文件清单

### 核心路由
- `src/routes/knowledge_.$type.$slug.tsx` - 模型详情页（已修改）

### 新增组件
- `src/components/knowledge/TimelineHero.tsx`
- `src/components/knowledge/ReadingModeSelector.tsx`
- `src/components/knowledge/DensityAwareSection.tsx`

### 部署脚本
- `scripts/prepare-cloudflare-deploy.mjs` - 生成 wrangler staging 配置
- `scripts/verify-staging-build.mjs` - 验证构建输出

### 配置文件
- `render.yaml` - Render 部署配置（Backend）
- `.output/server/wrangler.json` - 自动生成的 wrangler 基础配置
- `.output/server/wrangler.staging.json` - staging 专用配置（构建时生成）

### CI/CD
- `.github/workflows/quality.yml` - 质量检查（不部署）

---

## Git 状态

```
Current branch: codex/productionize
Latest commit: 98d08b7 fix: remove old timeline section that was shadowing new TimelineHero component
Status: clean (所有更改已提交)
```

**最近 5 个提交**:
```
98d08b7 fix: remove old timeline section that was shadowing new TimelineHero component
a6f90bb Add version marker for deployment verification
e049361 Add timeline hero, reading mode selector, and density-aware sections
faabb66 Simplify homepage and navigation: remove redundant sections, focus on core value
c3c1b08 Add project completion spec and data quality operations manual
```

---

## 下一步行动建议

1. **确认 Cloudflare 账户权限**
   - 登录 https://dash.cloudflare.com/
   - 检查是否有 `ai-radar-staging` Worker
   - 确认有部署权限（需要 API Token）

2. **本地部署测试**
   ```bash
   # 需要先配置 CLOUDFLARE_API_TOKEN 环境变量
   bun run build:staging
   npx wrangler deploy --config .output/server/wrangler.staging.json
   ```

3. **验证部署结果**
   - 访问 https://ai-radar-staging.1966761779.workers.dev/knowledge/model/gpt-4
   - 确认看到新的横向 timeline（不是蓝色圆点的垂直列表）
   - 确认看到 ReadingModeSelector（三个按钮）

4. **配置自动部署** (可选)
   - 在 GitHub repo settings 中添加 `CLOUDFLARE_API_TOKEN` secret
   - 修改 `.github/workflows/quality.yml` 添加部署步骤
   - 推送后自动触发部署

---

## 常见问题

### Q: 为什么 Backend 自动部署但 Frontend 不自动部署？
A: Render 的 Blueprint 服务监听 Git 分支，可以配置自动部署。Cloudflare Workers 部署需要通过 `wrangler` CLI 推送，通常在 CI/CD 中配置为独立步骤。

### Q: 能否将 Frontend 迁移到 Cloudflare Pages？
A: 可以，但需要修改构建配置。当前使用 Nitro 的 Cloudflare preset 构建为 Workers 格式。Cloudflare Pages 支持 Full-stack 模式，可以运行 SSR 应用。

### Q: Worker URL 中的 `1966761779` 是什么？
A: 这是 Cloudflare 账户 ID。Worker 的默认 URL 格式为 `<worker-name>.<account-id>.workers.dev`。

### Q: 为什么 quality.yml 不部署？
A: 分离关注点 - quality.yml 专注于代码质量验证（lint, test, build verification），部署应该是独立的 workflow（可以在 quality 通过后触发）。

---

## 联系信息

- **项目仓库**: (请填写 Git remote URL)
- **Staging Frontend**: https://ai-radar-staging.1966761779.workers.dev/
- **Staging Backend**: https://ai-radar-api-staging.onrender.com
- **Cloudflare Dashboard**: https://dash.cloudflare.com/

---

**文档创建时间**: 2026-09-02
**当前分支**: codex/productionize
**最新提交**: 98d08b7
**问题状态**: ⚠️ 代码已修复，等待部署
