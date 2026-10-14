import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  ChevronRight,
  CircleDashed,
  FileCheck2,
  ListFilter,
  RotateCcw,
  Search,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import "../design-review.css";

export const Route = createFileRoute("/design-review")({
  head: () => ({
    meta: [
      { title: "决策助手高保真样例 · AI Radar" },
      { name: "description", content: "AI Radar 决策助手重构样例，仅用于界面和交互审核。" },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: DesignReviewPage,
});

type Scenario = "ready" | "conflict";
type ClaimState = "verified" | "inferred" | "conflict" | "missing";
type Claim = {
  id: string;
  state: ClaimState;
  title: string;
  detail: string;
  source: string;
  date: string;
  boundary: string;
};

const claims: Record<Scenario, Claim[]> = {
  ready: [
    {
      id: "C-DB-014",
      state: "verified",
      title: "豆包模型家族覆盖通用、多模态、语音与生成媒体能力",
      detail:
        "仓库演示快照将豆包描述为覆盖通用、多模态、代码、语音、图像和视频生成的模型产品组合。",
      source: "豆包模型档案 · AI Radar 演示快照",
      date: "2026-07-29",
      boundary: "能力覆盖不等于当前账户、地域或配额已经可用。",
    },
    {
      id: "C-DB-018",
      state: "inferred",
      title: "应先以真实客服集验证复杂问答和引用稳定性",
      detail: "该测试顺序由任务约束与已核验能力范围推导，不是仓库中的产品性能排名。",
      source: "任务约束 × 已核验档案",
      date: "本次研究",
      boundary: "缺少真实业务压测，因此只能形成验证顺序，不能形成采购结论。",
    },
    {
      id: "C-QW-009",
      state: "missing",
      title: "Qwen 路线保留为部署边界待确认的备选",
      detail: "公开演示快照中的未来版本信息不能作为正式发布事实。",
      source: "Qwen 模型版本说明 · 演示数据",
      date: "2026-07-01",
      boundary: "必须重新核验正式版本、部署方式与实时配额。",
    },
  ],
  conflict: [
    {
      id: "C-CF-031",
      state: "conflict",
      title: "两组样例压测对复杂问答成本给出相反方向",
      detail: "样例测试 A 认为路线甲调用成本更低；样例测试 B 在长上下文问题上得到相反结果。",
      source: "合成压测 A / B · 仅用于冲突界面",
      date: "样例数据",
      boundary: "测试集、缓存策略和输出长度不同，结果不能直接合并。",
    },
    {
      id: "C-CF-034",
      state: "verified",
      title: "两个来源使用了不同的成功判定标准",
      detail: "来源 A 统计完成率；来源 B 同时要求回答中带有可访问引用。",
      source: "样例测试说明 · 字段核对",
      date: "样例数据",
      boundary: "指标口径已经确认不同，但尚未完成统一重跑。",
    },
    {
      id: "C-CF-038",
      state: "missing",
      title: "缺少统一测试集上的价格、延迟和引用通过率",
      detail: "当前证据无法回答哪条路线整体成本更低。",
      source: "证据缺口检查",
      date: "本次研究",
      boundary: "补齐同任务、同长度、同并发条件后才能继续比较。",
    },
  ],
};

const stateLabels: Record<ClaimState, string> = {
  verified: "已核验",
  inferred: "基于证据的推断",
  conflict: "证据冲突",
  missing: "证据缺口",
};

function DesignReviewPage() {
  const defaultTask = "面向电商用户的多模态智能客服，需要回答可追溯并支持高峰期服务。";
  const defaultExclusions = "数据离境；回答无法追溯来源";
  const defaultNotes = "先完成小规模盲测，不直接形成采购结论。";
  const [scenario, setScenario] = useState<Scenario>("ready");
  const [selectedClaimId, setSelectedClaimId] = useState(claims.ready[0].id);
  const [running, setRunning] = useState(false);
  const [priority, setPriority] = useState("cost");
  const [budget, setBudget] = useState("cost-first");
  const [deployment, setDeployment] = useState("domestic-cloud");
  const [task, setTask] = useState(defaultTask);
  const [exclusions, setExclusions] = useState(defaultExclusions);
  const [notes, setNotes] = useState(defaultNotes);
  const [budgetMin, setBudgetMin] = useState("10000");
  const [budgetMax, setBudgetMax] = useState("50000");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );
  const selectedClaim = useMemo(
    () => claims[scenario].find((claim) => claim.id === selectedClaimId) ?? claims[scenario][0],
    [scenario, selectedClaimId],
  );
  const changeScenario = (next: Scenario) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setRunning(false);
    setScenario(next);
    setSelectedClaimId(claims[next][0].id);
  };
  const runResearch = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setRunning(true);
    timerRef.current = setTimeout(() => setRunning(false), 900);
  };
  const resetConstraints = () => {
    setPriority("cost");
    setBudget("cost-first");
    setDeployment("domestic-cloud");
    setTask(defaultTask);
    setExclusions(defaultExclusions);
    setNotes(defaultNotes);
    setBudgetMin("10000");
    setBudgetMax("50000");
  };

  return (
    <AppShell>
      <main className="ar-review-page">
        <header className="ar-review-intro">
          <div>
            <div className="ar-review-title">
              <h1>决策助手 · 高保真样例</h1>
              <span>样例数据，仅用于界面审核</span>
            </div>
            <p>保留正式页的重要能力，只重组信息层级与决策节奏。</p>
          </div>
          <div className="ar-scenario-switch" aria-label="结果状态">
            <button
              type="button"
              aria-pressed={scenario === "ready"}
              onClick={() => changeScenario("ready")}
            >
              <ShieldCheck aria-hidden="true" />
              可推进
            </button>
            <button
              type="button"
              aria-pressed={scenario === "conflict"}
              onClick={() => changeScenario("conflict")}
            >
              <AlertTriangle aria-hidden="true" />
              证据冲突
            </button>
          </div>
        </header>

        <section className="ar-review-layout">
          <div className="ar-prototype">
            <header className="ar-prototype-bar">
              <div>
                <Sparkles aria-hidden="true" />
                <strong>决策助手</strong>
                <code>/ask</code>
              </div>
              <span>
                <i />
                演示快照 · 2026-07-29
              </span>
            </header>
            <div className="ar-workbench">
              <ConstraintPanel
                priority={priority}
                budget={budget}
                deployment={deployment}
                task={task}
                exclusions={exclusions}
                notes={notes}
                budgetMin={budgetMin}
                budgetMax={budgetMax}
                onPriorityChange={setPriority}
                onBudgetChange={setBudget}
                onDeploymentChange={setDeployment}
                onTaskChange={setTask}
                onExclusionsChange={setExclusions}
                onNotesChange={setNotes}
                onBudgetMinChange={setBudgetMin}
                onBudgetMaxChange={setBudgetMax}
                onReset={resetConstraints}
                onRun={runResearch}
                running={running}
              />
              <section className="ar-result-panel" aria-label="研究结果">
                <ResearchHeader scenario={scenario} priority={priority} />
                <ResearchProgress running={running} scenario={scenario} />
                {running ? (
                  <RunningState />
                ) : (
                  <ScenarioResult
                    scenario={scenario}
                    priority={priority}
                    selectedClaimId={selectedClaim.id}
                    onSelectClaim={setSelectedClaimId}
                  />
                )}
              </section>
              <EvidenceInspector claim={selectedClaim} scenario={scenario} />
            </div>
          </div>
          <ReviewRationale />
        </section>
      </main>
    </AppShell>
  );
}

function ConstraintPanel({
  priority,
  budget,
  deployment,
  task,
  exclusions,
  notes,
  budgetMin,
  budgetMax,
  onPriorityChange,
  onBudgetChange,
  onDeploymentChange,
  onTaskChange,
  onExclusionsChange,
  onNotesChange,
  onBudgetMinChange,
  onBudgetMaxChange,
  onReset,
  onRun,
  running,
}: {
  priority: string;
  budget: string;
  deployment: string;
  task: string;
  exclusions: string;
  notes: string;
  budgetMin: string;
  budgetMax: string;
  onPriorityChange: (value: string) => void;
  onBudgetChange: (value: string) => void;
  onDeploymentChange: (value: string) => void;
  onTaskChange: (value: string) => void;
  onExclusionsChange: (value: string) => void;
  onNotesChange: (value: string) => void;
  onBudgetMinChange: (value: string) => void;
  onBudgetMaxChange: (value: string) => void;
  onReset: () => void;
  onRun: () => void;
  running: boolean;
}) {
  return (
    <aside className="ar-constraints">
      <div className="ar-panel-title">
        <div>
          <ListFilter aria-hidden="true" />
          <h2>选择约束</h2>
        </div>
        <button type="button" onClick={onReset}>
          <RotateCcw aria-hidden="true" />
          重置
        </button>
      </div>
      <label className="ar-field ar-task-field">
        <span>任务</span>
        <textarea rows={4} value={task} onChange={(event) => onTaskChange(event.target.value)} />
      </label>
      <fieldset className="ar-field">
        <legend>首要优先级</legend>
        <div className="ar-segmented">
          {[
            { value: "cost", label: "成本" },
            { value: "quality", label: "质量" },
            { value: "speed", label: "速度" },
          ].map((item) => (
            <button
              key={item.value}
              type="button"
              aria-pressed={priority === item.value}
              onClick={() => onPriorityChange(item.value)}
            >
              {priority === item.value && <Check aria-hidden="true" />}
              {item.label}
            </button>
          ))}
        </div>
      </fieldset>
      <div className="ar-field-pair">
        <label className="ar-field">
          <span>预算</span>
          <select value={budget} onChange={(event) => onBudgetChange(event.target.value)}>
            <option value="cost-first">成本优先</option>
            <option value="range">指定月预算</option>
            <option value="unknown">暂不确定</option>
          </select>
        </label>
        <label className="ar-field">
          <span>部署方式</span>
          <select value={deployment} onChange={(event) => onDeploymentChange(event.target.value)}>
            <option value="domestic-cloud">境内云 API</option>
            <option value="private">私有部署</option>
            <option value="undecided">待确定</option>
          </select>
        </label>
      </div>
      {budget === "range" && (
        <div className="ar-field-pair ar-range-fields">
          <label className="ar-field">
            <span>月预算下限</span>
            <input
              type="number"
              value={budgetMin}
              onChange={(event) => onBudgetMinChange(event.target.value)}
            />
          </label>
          <label className="ar-field">
            <span>月预算上限</span>
            <input
              type="number"
              value={budgetMax}
              onChange={(event) => onBudgetMaxChange(event.target.value)}
            />
          </label>
        </div>
      )}
      <label className="ar-field">
        <span>排除条件</span>
        <input value={exclusions} onChange={(event) => onExclusionsChange(event.target.value)} />
      </label>
      <label className="ar-field">
        <span>补充说明</span>
        <textarea rows={2} value={notes} onChange={(event) => onNotesChange(event.target.value)} />
      </label>
      <div className="ar-constraint-summary">
        <span>已形成研究问题</span>
        <strong>6 项约束 · 2 项不可接受条件</strong>
      </div>
      <button className="ar-run-button" type="button" onClick={onRun} disabled={running}>
        {running ? "正在核验证据…" : "运行研究"}
        <ArrowRight aria-hidden="true" />
      </button>
    </aside>
  );
}

const priorityLabels: Record<string, string> = {
  cost: "成本优先",
  quality: "质量优先",
  speed: "速度优先",
};

function ResearchHeader({ scenario, priority }: { scenario: Scenario; priority: string }) {
  return (
    <header className="ar-result-header">
      <span>研究问题</span>
      <h2>{priorityLabels[priority]}的多模态客服，应该先验证哪条模型路线？</h2>
      <div>
        <code>R-2026-0716-04</code>
        <span>{scenario === "ready" ? "条件性建议" : "无法形成建议"}</span>
      </div>
    </header>
  );
}

function ResearchProgress({ running, scenario }: { running: boolean; scenario: Scenario }) {
  const stopped = scenario === "conflict" && !running;
  return (
    <ol className="ar-progress" aria-label="研究进度">
      <li className="complete">
        <Check aria-hidden="true" />
        <span>解析约束</span>
      </li>
      <li className={running ? "active" : "complete"}>
        {running ? <CircleDashed aria-hidden="true" /> : <Check aria-hidden="true" />}
        <span>检索知识</span>
      </li>
      <li className={running ? "" : stopped ? "blocked" : "complete"}>
        {stopped ? (
          <AlertTriangle aria-hidden="true" />
        ) : running ? (
          <Search aria-hidden="true" />
        ) : (
          <Check aria-hidden="true" />
        )}
        <span>校验引用</span>
      </li>
      <li className={running ? "" : stopped ? "blocked" : "complete"}>
        {stopped ? <AlertTriangle aria-hidden="true" /> : <FileCheck2 aria-hidden="true" />}
        <span>{stopped ? "停止结论" : "形成建议"}</span>
      </li>
    </ol>
  );
}

function RunningState() {
  return (
    <div className="ar-running" role="status" aria-live="polite">
      <div className="ar-radar-scan">
        <span />
        <i />
        <i />
        <i />
      </div>
      <h3>正在核对声明、来源和适用边界</h3>
      <p>已完成任务拆解，正在检查候选模型的已审核档案。</p>
      <div className="ar-running-log">
        <span>知识检索</span>
        <strong>12 个相关实体</strong>
        <span>引用校验</span>
        <strong>进行中</strong>
      </div>
    </div>
  );
}

function ScenarioResult({
  scenario,
  priority,
  selectedClaimId,
  onSelectClaim,
}: {
  scenario: Scenario;
  priority: string;
  selectedClaimId: string;
  onSelectClaim: (id: string) => void;
}) {
  return (
    <div className="ar-result-content">
      {scenario === "ready" ? (
        <ReadyConclusion priority={priority} />
      ) : (
        <ConflictConclusion priority={priority} />
      )}
      <section className="ar-claim-section">
        <div className="ar-section-line">
          <h3>{scenario === "ready" ? "结论依据" : "冲突与缺口"}</h3>
          <span>{claims[scenario].length} 条</span>
        </div>
        <div className="ar-claim-list">
          {claims[scenario].map((claim) => (
            <button
              key={claim.id}
              type="button"
              aria-pressed={selectedClaimId === claim.id}
              onClick={() => onSelectClaim(claim.id)}
            >
              <span className={`ar-state-dot ${claim.state}`} />
              <span>
                <code>{claim.id}</code>
                <strong>{claim.title}</strong>
                <small>
                  {stateLabels[claim.state]} · {claim.source}
                </small>
              </span>
              <ChevronRight aria-hidden="true" />
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function ReadyConclusion({ priority }: { priority: string }) {
  return (
    <section className="ar-conclusion ready">
      <div className="ar-conclusion-status">
        <ShieldCheck aria-hidden="true" />
        <span>证据足以确定验证顺序</span>
      </div>
      <h3>先验证 Doubao-Seed 2.0 Pro；Qwen 路线保留为部署边界待确认的备选。</h3>
      <p>
        这是按{priorityLabels[priority]}
        目标生成的测试顺序，不是性能排名或采购结论。真实客服集、引用通过率和峰值并发仍需业务验证。
      </p>
      <div className="ar-candidate-strip">
        <div>
          <span>首先验证</span>
          <strong>Doubao-Seed 2.0 Pro</strong>
        </div>
        <i />
        <div>
          <span>保留备选</span>
          <strong>Qwen 路线</strong>
        </div>
        <div>
          <span>可信边界</span>
          <strong>条件性建议</strong>
        </div>
      </div>
    </section>
  );
}

function ConflictConclusion({ priority }: { priority: string }) {
  return (
    <section className="ar-conclusion conflict" role="status">
      <div className="ar-conclusion-status">
        <AlertTriangle aria-hidden="true" />
        <span>证据冲突，系统停止生成推荐</span>
      </div>
      <h3>当前无法判断哪条路线更符合“{priorityLabels[priority]}”目标。</h3>
      <p>两组样例压测的任务集、缓存策略与成功标准不一致。合并结果会制造虚假确定性。</p>
      <div className="ar-conflict-pair">
        <div>
          <span>样例测试 A</span>
          <strong>路线甲调用成本更低</strong>
          <small>按完成率统计</small>
        </div>
        <b>≠</b>
        <div>
          <span>样例测试 B</span>
          <strong>路线乙长上下文成本更低</strong>
          <small>要求回答带引用</small>
        </div>
      </div>
      <div className="ar-next-check">
        <Search aria-hidden="true" />
        <span>
          <strong>下一步：</strong>统一测试集、输出长度、并发与引用通过标准后重新运行。
        </span>
      </div>
    </section>
  );
}

function EvidenceInspector({ claim, scenario }: { claim: Claim; scenario: Scenario }) {
  return (
    <aside className="ar-evidence-inspector" aria-label="证据检查器">
      <div className="ar-inspector-title">
        <span>证据检查器</span>
        <code>{claim.id}</code>
      </div>
      <div className={`ar-inspector-state ${claim.state}`}>
        <span className={`ar-state-dot ${claim.state}`} />
        {stateLabels[claim.state]}
      </div>
      <h2>{claim.title}</h2>
      <p>{claim.detail}</p>
      <dl>
        <div>
          <dt>来源</dt>
          <dd>{claim.source}</dd>
        </div>
        <div>
          <dt>日期</dt>
          <dd>{claim.date}</dd>
        </div>
        <div>
          <dt>状态</dt>
          <dd>{stateLabels[claim.state]}</dd>
        </div>
      </dl>
      <section>
        <h3>可信边界</h3>
        <p>{claim.boundary}</p>
      </section>
      <footer>
        <span>{scenario === "ready" ? "支持条件性建议" : "阻止形成推荐"}</span>
        <strong>
          {claim.state === "verified" ? "直接证据" : claim.state === "inferred" ? "推断" : "需处理"}
        </strong>
      </footer>
    </aside>
  );
}

function ReviewRationale() {
  return (
    <aside className="ar-review-notes">
      <div>
        <code>/ask</code>
        <h2>这一版不再追求“少”，而是追求“关系清楚”。</h2>
        <p>旧页能力被保留，但从纵向堆叠改造成约束、结论、证据三栏工作台。</p>
      </div>
      <section>
        <h3>保留</h3>
        <ul>
          <li>任务、优先级、预算与部署</li>
          <li>排除条件和补充说明</li>
          <li>检索、引用校验与可信边界</li>
          <li>已核验、推断、冲突和缺口</li>
        </ul>
      </section>
      <section>
        <h3>重组</h3>
        <ul>
          <li>约束始终留在左侧，不依赖对话记忆</li>
          <li>结论与证据检查器同屏联动</li>
          <li>冲突直接停止推荐并给出恢复动作</li>
        </ul>
      </section>
      <section>
        <h3>本轮未覆盖</h3>
        <ul>
          <li>账户收藏与历史研究</li>
          <li>真实后端请求和发布分享</li>
          <li>其他三个页面的正式改造</li>
        </ul>
      </section>
      <div className="ar-review-question">
        <strong>本轮审核重点</strong>
        <span>真实能力是否保住？信息密度是否足够？成功与冲突路径是否可信？</span>
      </div>
    </aside>
  );
}
