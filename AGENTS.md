<!-- LOVABLE:BEGIN -->

> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.

<!-- LOVABLE:END -->

## End-to-End Delivery and Verifiable Completeness

- Unless the user explicitly requests exploration, a prototype, a local-only fix, or staged delivery, treat the authorized request as a complete module or end-to-end workflow. Use a written acceptance checklist and target at least 98% verified coverage; the percentage is not a subjective progress claim.
- Before editing, identify the affected source data, entities, schemas, seed/snapshot/demo data, backend services, APIs, frontend views, routes/navigation, user flows, and tests. Keep changes within the user's authorized scope.
- Finish and reconcile the current entity, family, or module and its dependent surfaces before expanding horizontally to another peer module.
- Maintain one authoritative source for each fact. When derived copies are necessary, document or automate the source-to-derived flow and validate that backend, seed, snapshot, demo, API, and page data cannot drift.
- If the current architecture would create duplicated facts, special-case patches, or predictable rework, fix the root cause before extending the feature.
- Before declaring completion, verify the full path where applicable: data layer -> backend -> API -> frontend -> navigation -> real user flow -> tests. An HTTP 200, an independently renderable page, or one passing test is never sufficient by itself.
- Never label unverified work as complete. Distinguish completed-and-verified work, implemented-but-unverified work, unfinished work, and external blockers.
- A formal delivery may leave at most roughly 2% non-core work, and no remainder may break the core workflow. If that bar cannot be met, continue working or report the exact blocker instead of claiming completion.
- Every delivery report must state the completed scope, verification performed, and any remaining gaps or blockers, including why they do not compromise the core end-to-end workflow.

## Page Review Before Delivery

- For decision-assistant continuation, use `docs/DECISION_PRODUCT_ACCEPTANCE.md` as the user's product completion standard. A layout pass, candidate list, working demo, or test count is not module completion. Continue while supported common scenarios are blocked by material evidence or interaction gaps, and preserve real measurement boundaries.

- For every page change, inspect the real rendered page at desktop and mobile sizes before reporting completion. Check long names, dense selections, expanded content, sparse/empty results, horizontal overflow, and unequal column heights. Passing tests alone is not visual acceptance.
- Preserve the site's shared navigation, content width, colors, and hierarchy. Do not fill space with redundant entities, obvious comparisons, or unsupported relationships.
- Save actual screenshots, resolve material findings in a bounded correction pass, and report the scope of the visual review separately from data completeness.

## First-use Decision Assistant Contract

- General-audience requirement reaffirmed 2026-10-16: a user's personal provider, gateway, subscription or available account is a condition of that user's analysis, never a global product completion gate. Do not wait on CCSub or any other optional channel to improve or deliver the common workflow. Apply channel-specific price, license and privacy checks only when the user selects that channel or makes the relevant condition necessary; preserve unknowns within that scope.
- Validate the common workflow with provider-neutral tasks as well as explicitly scoped cases. A second product account is needed for an actual cross-product comparison, not for using or finishing the single-product workflow. Preserve private historical measurements without treating one user's setup as the public product default.

- User requirement reaffirmed 2026-10-14: a new user must understand the recommendation and next action from the interface without a long external explanation. Do not substitute a help article or more disclaimers for a usable flow.
- Keep the ordinary flow focused on a useful qualified suggestion, its task-relevant reasons, and one clear next action. Separate choosing candidates, preparing an external trial, and recording actual results. Do not expose an empty results form before explaining where the trial happens.
- Public-source maintenance and evidence audits are secondary. Other candidates' missing sources must not look like required work for the selected qualified candidate. When no candidate qualifies, show the actual blocking requirement and its recovery path prominently.
- Candidate eligibility never proves the user's account can access a model. Clearly identify model APIs versus finished products. A displayed recommendation must not require testing every candidate before providing value.
- Preserve unsaved drafts, existing measurements and original records when simplifying the interface. Auto-testing must be an explicit separate capability with clear provider, input scope and spending limits; a question about the feature does not authorize new paid requests or document transmission.

## Result Hierarchy and Trial Instructions

- User screenshot requirements reaffirmed 2026-10-15: separate conclusion body from auxiliary notes, keep the parent section visibly stronger than its subsections, and never fold a single line of screening counts behind an arrow.
- Keep the main trial workspace visible after selection. Preparing a task and recording an actual outcome are distinct, explicitly labeled stages; switching stages must preserve inputs. Secondary disclosures must look clickable through descriptive labels, link treatment or a full-row expander. Choose controls by role: buttons for actions, text links for utilities, compact row headers for comparison groups. Never apply button borders/backgrounds to every summary or stack multiple disclosure buttons for one candidate. Inspect fully expanded evidence and candidate sections, not only the first-use path.
- Default to a visible, copyable task for the user's existing product. Explain that it is an instruction to execute elsewhere, not an executed test. Downloads are optional; styled offline/print instructions and plain Markdown must preserve the same real task and evidence boundaries. Start a novice coding trial with one small actual task; retain full comparison protocols as optional detail.
- During visual acceptance, check for empty callout backgrounds, duplicated findings, cramped controls and mobile action discoverability as well as overflow. Revalidate actual copy, download, save and reopen behavior; do not infer these from source strings alone.

## Prevent Premature Text Wrapping

- User requirement (2026-10-13): never leave a wide result panel empty on the right while its Chinese text wraps in a narrow left column. This applies to conclusions, next steps, candidate facts, evidence updates, trial instructions, and saved-result text in both `/ask` and complete research reports.
- Apply the reading-width limit once to the outer page/container. Text within a full-width operational panel must use its available content width. Do not reintroduce nested `65–75ch`, fixed `rem`/`px` paragraph caps, or narrower prose utilities as a typography default. This explicit user rule takes precedence over generic skill reading-measure advice. A real sidebar or intentional column must be visible and documented; an empty right-hand region is not a column.
- Trace actual computed widths from the text through its ancestor containers and inspect the CSS cascade, including shared styles and component styles. Fix the controlling declarations; do not stack overrides or rely on narrower screenshots to hide the defect.
- Do not compensate with smaller fonts, `white-space: nowrap`, clipping/ellipsis, horizontal scrolling, manual `<br>` elements, or rewriting factual text. Preserve natural wrapping, semantic paragraphs, accessible controls, and mobile reflow.
- Before handing off affected UI, run `npm run check:decision-layout` (also included in `npm run check`). Inspect the actual rendered inline result and full report at desktop/wide and mobile sizes, with Chinese and mixed model names and expanded secondary content. Verify the measured viewport matches the requested size; an unapplied viewport override is not mobile validation. For normal block text intended to fill its column, its rendered width must match the parent's content width within 2 CSS pixels. Page `scrollWidth` must not exceed `clientWidth` by more than 1 pixel. Save geometry evidence and actual screenshots; source checks alone do not prove visual acceptance.
