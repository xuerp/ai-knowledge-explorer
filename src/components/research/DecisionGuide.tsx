import { useApp } from "@/lib/app-state";

const inputs = [
  [
    "要完成的任务",
    "Task",
    "写清输入、输出和合格标准。只写模型名称无法判断具体业务效果。",
    "Specify inputs, outputs and acceptance criteria. Model names alone do not define task quality.",
  ],
  [
    "首要优先级",
    "Top priority",
    "综合平衡查看已有事实，不做加权评分；效果看业务测试，成本看费用，速度看时延。隐私当前主要查看部署证据，可控性主要查看权重获取证据，不能替代完整审计。缺少对应证据时不生成排名。",
    "Balanced inspects known facts without weighted scoring. Quality uses task tests, cost uses prices and speed uses latency. Privacy currently uses deployment evidence; control uses weight access, not a complete audit. Missing evidence does not create a ranking.",
  ],
  [
    "预算",
    "Budget",
    "暂不确定：不设费用门槛；成本优先：记录费用偏好，不设硬上限，费用主选需同时把首要优先级设为成本；指定区间：核验月费用是否在上限内。下限记录预算范围，不表示必须花够。",
    "Unknown sets no ceiling. Cost first records a cost preference without a hard ceiling; a cost recommendation also requires Cost as the top priority. A range checks the monthly ceiling. The minimum records the range, not a spending requirement.",
  ],
  [
    "币种、渠道、月输入/输出",
    "Currency, channel and monthly tokens",
    "限定同一供应商计费渠道和币种，并按输入、输出量分别估算月费。缺工作量或已核验价格时费用保持未知；私有部署还需额外估算设备与运维。",
    "Compare the same currency and provider channel, estimating input/output costs separately. Missing workload or verified prices leaves costs unknown. Private hosting also needs infrastructure and operations costs.",
  ],
  [
    "部署方式",
    "Deployment",
    "云 API：调用服务；私有：自有环境部署；端侧：本地设备运行；混合：结合多种方式。暂不确定不设部署门槛。",
    "Cloud API calls a hosted service; private runs in your environment; on-device runs locally; hybrid combines methods. Undecided sets no deployment constraint.",
  ],
  [
    "选型任务",
    "Selection task",
    "按用途识别，或指定模型 API、编码产品、Agent 开发框架。对象类型不同，不能用同一套性能排名代替。",
    "Infer from use, or choose model API, coding product or agent framework. These object types require different comparisons.",
  ],
  [
    "部署地区",
    "Hosting region",
    "要求服务或部署适用于该地区，须有对应事实。它不是界面语言，也不是完整的法律合规认证。",
    "Require cited availability or hosting for that region. This is neither interface language nor a complete legal compliance assessment.",
  ],
  [
    "最低上下文 token",
    "Minimum context tokens",
    "单次可接收输入的最低容量。100k=100000，2000000=200万；不是字符数、月调用量或输出长度。表单中的数字是实际核验门槛。",
    "Minimum input capacity per request. 100k=100000; 2000000 is two million. This is not characters, monthly usage or output length. The form value is the enforced threshold.",
  ],
  [
    "必须支持的输入",
    "Required inputs",
    "勾选文本、图像、音频或视频后成为必要条件；支持输入不代表能生成同类型输出。未勾选表示不增加此门槛。",
    "Selected text, image, audio or video inputs are mandatory. Input support does not imply matching output generation. Unselected adds no requirement.",
  ],
  [
    "商用许可",
    "Commercial permission",
    "勾选后必须有可核验的许可资料；开放权重不等于可商用，缺资料不能视为已许可。",
    "Require verifiable commercial terms. Open weights do not imply commercial permission; absent evidence does not prove it.",
  ],
  [
    "具体版本或产品",
    "Exact candidates",
    "可固定比较对象；不填则从相关目录发现候选。写出完整版本名可避免家族规格被当成该版本事实。",
    "Fix the comparison scope, or discover candidates from the relevant catalog. Exact version names prevent family specifications from being treated as version facts.",
  ],
  [
    "排除条件与补充说明",
    "Exclusions and notes",
    "排除条件逐项记录，但只有可识别且有证据的规则能自动核验。决定性部署/地区要求应填对应字段；团队、时间等备注不自动变成已证实限制。",
    "Exclusions are recorded; automatic checks require recognized rules and evidence. Put decisive deployment/region needs in their fields. Team or timing notes do not become proven constraints.",
  ],
  [
    "确认条件",
    "Confirmation",
    "实际分析采用确认表单。文字与表单不同会提示；编辑后旧结果失效，须重新确认和分析。",
    "Analysis uses the confirmed form. Differences from the task are shown. Editing invalidates the previous result and requires reanalysis.",
  ],
];
const outputs = [
  [
    "实测合格数与效果比较",
    "Successful samples and quality comparison",
    "按试测前约定的统一标准记录合格样本数、最低合格数和总样本数。达到最低标准且入口核验通过后，效果优先在相同样本、配置、日期、标准内比较合格数，保留并列；不同标准分组。只写通过而没有数值，仍可限定试用，但不推断效果优劣。",
    "Record successful, minimum acceptable and total samples against criteria agreed before testing. Quality priority compares successful counts only within matching samples, configuration, dates and thresholds after task and entry checks pass. Ties remain; different thresholds are separate. A pass without counts supports a scoped trial without a quality ranking.",
  ],
  [
    "私人实测数值与优先项",
    "Private measurements and selection priority",
    "本批总费用须注明币种、实际扣费或估算及来源；估算不参与实际费用主选。P50/P95分别描述50%/95%样本的完成耗时，使用毫秒。同一候选各项的版本须一致，不同候选的共有配置/样本/日期须一致，任务和入口通过才可比较；不同币种不换算混排。只有一份记录可限定试用，不能声称更好。",
    "Batch cost requires currency, actual-charge/estimate basis and source; estimates do not establish an actual-cost choice. P50/P95 describe completion time for 50%/95% of samples, in milliseconds. A candidate's checks must name the same version; candidates must share configuration, samples and dates and pass task and entry checks. Currencies are not mixed. One record may support a scoped trial, not superiority.",
  ],
  [
    "新测试清单与保留记录",
    "New checklists and retained records",
    "新业务测试只为具备试用资格的候选生成。候选较多时先选1–3个；未具备资格时先生成资格核验项。建议测试方案不是实测成绩；复用口径只填同一候选的空字段，保存前须确认实际设置。旧记录仍可查看和导出。",
    "New business checks are generated for qualified trial candidates. Select 1–3 when many qualify; unresolved eligibility starts with qualification checks. Suggested protocols are not test results. Reusing conditions fills only empty fields for the same candidate; confirm actual settings before saving. Existing records remain available and exportable.",
  ],
  [
    "现在先做什么",
    "What to do first",
    "先显示最能推进当前选择的一步：补用户条件、核对冲突、补来源或开展业务验证。其余候选的资料缺口不会挡住已合格候选的验证；尚不合格的候选不能进入测试名单。",
    "Start with the action that advances this decision: clarify inputs, reconcile conflicts, verify sources or run a business trial. Other candidates' gaps do not block qualified candidates; unqualified candidates are excluded from the trial list.",
  ],
  [
    "可进入业务验证 / 必要功能待核验",
    "Ready for a business trial / Required features unverified",
    "可进入验证需要同时通过已指定硬条件，并有本场景全部必要功能的引用。只通过硬条件不代表业务功能齐全，也不代表效果最好或可直接上线。",
    "Trial eligibility requires both selected constraints and citations for every required workflow feature. Passing constraints alone does not establish feature completeness, best quality or deployment readiness.",
  ],
  [
    "业务测试方案与合格标准",
    "Business protocol and acceptance criteria",
    "列出同一批样本、操作、记录指标和合格标准，是尚未执行的建议方案。成本、速度、隐私等优先级会增加相应验证要求；实测结果需另存到私人验证后复核。",
    "The proposed protocol defines shared samples, procedure, metrics and acceptance criteria; it has not been executed. Cost, speed and privacy add corresponding checks. Save actual measurements in private validation before reviewing the decision.",
  ],
  [
    "结果与主选/备选",
    "Outcome and choices",
    "有条件建议须说明依据与成立条件；没有主选表示证据不能区分，不表示请求没执行。全部排除时没有可推荐对象。",
    "A conditional recommendation needs cited reasons and conditions. No primary means evidence cannot distinguish candidates, not that the request failed. All excluded means no eligible recommendation.",
  ],
  [
    "业务场景与候选范围",
    "Scenario and scope",
    "场景说明要解决的业务；候选范围记录考虑、展示和未展示对象。最多展示20个，展示顺序不是性能排名。",
    "The scenario defines the business use. Scope records considered, shown and omitted objects. Up to 20 are shown; order is not performance ranking.",
  ],
  [
    "同维度依据",
    "Evidence by dimension",
    "在同一维度并列比较当前引用的事实。已知上下文/部署不会自动证明效果更好；价格、测试条件不同不能直接比较。",
    "Compare cited facts on the same dimension. Context/deployment facts do not establish task quality. Different price or test conditions are not directly comparable.",
  ],
  [
    "候选状态",
    "Candidate status",
    "可继续验证：已指定硬条件通过；不符合：有事实证明不满足；待补资料：没有足够证据；冲突：当前资料互相矛盾。可继续验证不等于业务实测通过。",
    "Eligible: selected constraints pass; excluded: facts disprove a requirement; unknown: evidence is missing; conflict: facts disagree. Eligibility is not measured task success.",
  ],
  [
    "功能描述 n/m",
    "Described features n/m",
    "n是本次必要功能中有明确引用的项数，m是要求的功能数；不是实测成功率。明确要求编辑文件、运行测试时，不重复叠加代码编辑和工具调用标签。",
    "n counts requested features with cited descriptions; m counts required features. This is not measured task success. Explicit file editing and testing replace their generic coding labels.",
  ],
  [
    "硬条件依据 n/m",
    "Constraint evidence n/m",
    "仅计算实际指定的容量、部署、地区、许可和预算等条件；排除依据也属于已知事实。效果和速度需要实测，不混入这个比例。未指定时显示未设置硬条件。",
    "Counts evidence for specified capacity, deployment, region, licensing and budget constraints, including evidence of exclusion. Quality and speed require testing and are counted separately. No specified constraints is shown explicitly.",
  ],
  [
    "未知原因",
    "Unknown causes",
    "未收录、未结构化、当前不可用、条件缺失、事实冲突或待实测分别指出缺口，不意味着模型本身不支持。",
    "Not recorded, unstructured, not current, missing inputs, conflict or testing needed identifies the gap. Unknown does not mean unsupported.",
  ],
  [
    "分析采用的条件、风险、下一步",
    "Applied conditions, risks and next steps",
    "条件记录实际分析口径；风险说明证据边界；下一步告诉你补条件、找资料还是做同口径测试。",
    "Conditions record the applied inputs; risks describe evidence boundaries; next steps distinguish clarifying inputs, sourcing facts and testing.",
  ],
  [
    "引用、来源日期、核验时间",
    "Citations and dates",
    "已核验表示资料引用通过规则，不表示已运行模型。来源日期是资料发布/生效时间；核验时间是本次分析时间，不保证供应商页面此刻未变化。",
    "Verified means citation checks passed, not that the model ran. Source dates mark publication/effectiveness; evaluation time marks this analysis, not guaranteed live freshness.",
  ],
  [
    "研究过程已完成",
    "Completed research steps",
    "表示检索与引用核验完成，不表示候选符合条件，更不表示真实业务测试完成。",
    "Retrieval and citation checks completed; this does not mean candidates qualify or real business testing finished.",
  ],
  [
    "私人 PoC 与导出",
    "Private validation and exports",
    "待验证/通过/未通过/缺条件是你记录的状态。通过或未通过须填版本、配置、样本量、日期与范围。保存只存私人记录；排版报告可阅读打印，Markdown是纯文本格式。",
    "Pending/passed/failed/blocked are your recorded states. Measured outcomes require version, configuration, samples, date and scope. Notes remain private. The formatted report supports reading/printing; Markdown is plain text.",
  ],
];

export function DecisionGuide({ kind }: { kind: "inputs" | "results" }) {
  const { t } = useApp();
  return (
    <details className="decision-guide print-hidden" data-kind={kind}>
      <summary>
        {kind === "inputs"
          ? t("这些条件分别是什么意思？", "What do these conditions mean?")
          : t(
              "如何理解结果、证据和验证状态？",
              "How should I read the results and validation states?",
            )}
      </summary>
      <dl>
        {(kind === "inputs" ? inputs : outputs).map(([zh, en, detailZh, detailEn]) => (
          <div key={en}>
            <dt>{t(zh, en)}</dt>
            <dd>{t(detailZh, detailEn)}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
