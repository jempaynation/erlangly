# CHANGELOG.md

Append-only log of completed work on Erlangly, one entry per phase (or notable fix)
from `ROADMAP.md`. Entries are added by `erlangly-qa` at the moment it signs off on a
phase and checks it off in `ROADMAP.md` — not by the developer, and not before tests
pass. This file is history; it is never edited retroactively except to fix a factual
error in a past entry.

Newest entries at the top. Format loosely follows [Keep a Changelog](https://keepachangelog.com).

## How to add an entry (for `erlangly-qa`)

When a phase passes audit:
1. Add a new entry at the top of the log below, under `## [Phase N] — <name>`, dated the day of sign-off.
2. Summarize what was built, in a few bullets — enough for a new agent to know what exists without re-reading every file.
3. Note anything meaningful found and fixed during QA (not routine — just what a future agent should know about).
4. Note any deviation from `FEATURES.md`/`AGENTS.md` as originally written, and why, if one was approved during the phase.
5. Link the phase status in `ROADMAP.md` is now fully checked before moving to the next phase.

```
## [Phase N] — <phase name> — YYYY-MM-DD
**QA sign-off:** erlangly-qa

### Built
- <what was implemented, in a few bullets>

### Found & fixed during QA
- <anything non-routine that came up>

### Deviations from spec (if any)
- <what changed from FEATURES.md/AGENTS.md and why, or "None">
```

---

## [Phase 14] — Quick Wins & Polish — 2026-08-25
**QA sign-off:** erlangly-qa

### Built
- **Dark/Light Theme Toggle System (`css/styles.css`, `js/main.js`, all 8 HTML files)**:
  - Extended CSS token design system in `css/styles.css` with `:root[data-theme="light"]` and `[data-theme="light"]` custom property overrides (near-white background, crisp borders, legible high-contrast text, surface cards, and adapted chart colors).
  - Implemented `ErlanglyUtils.getTheme()`, `setTheme(theme)`, `toggleTheme()`, and `initTheme()` in `js/main.js` with `localStorage` persistence (`erlangly_theme`) and `erlangly:themechange` event dispatch.
  - Added anti-FOUC inline head script and `.theme-toggle-btn` navigation button with dynamic emoji icon (`☀️` / `🌙`) and hover/focus states across `index.html`, `forecasting.html`, `capacity.html`, `scheduling.html`, `realtime.html`, `simulator.html`, `plans.html`, and `login.html`.
  - Added theme change event listeners across Chart.js visualizers in `forecasting.js`, `capacity.js`, `scheduling.js`, and `simulator.js` to update gridlines, text, and axes colors.
- **Contextual Inline Help & WFM Domain Examples (`css/styles.css`, `js/main.js`, all tools)**:
  - Created `.tooltip-container`, `.help-tip`, `.tooltip-bubble`, `.tooltip-title`, `.tooltip-example`, and positional classes (`.tip-left`, `.tip-right`) in `css/styles.css` with backdrop blur, subtle borders, and smooth micro-animations.
  - Added `ErlanglyUtils.initTooltips(container)` in `js/main.js` with viewport boundary collision detection, keyboard navigation (`focus`/`blur`/`escape`), hover support, and ARIA attributes (`role="tooltip"`, `aria-describedby`).
  - Added contextual `.help-tip` elements with realistic WFM domain definitions and numerical examples to inputs on Hero mini-calc, Capacity, Forecasting, Scheduling, Real-time, and Simulator.
- **Statistical Confidence Intervals on Forecast Charts (`forecasting.html`, `js/forecasting.js`)**:
  - Implemented `computeForecastConfidenceBounds(points, metrics, k, level)` in `js/forecasting.js` supporting Point Forecast, 80% CI ($z = 1.282$), and 95% CI ($z = 1.960$) with horizon standard error dispersion $\sigma_h = \text{RMSE} \cdot \sqrt{1 + \frac{h-1}{k}}$.
  - Added Confidence Interval selector dropdown control in the forecast chart toolbar.
  - Rendered upper bound line (`borderDash: [3, 3]`) and lower bound line with translucent area fill (`fill: '-1'`) on Chart.js.
  - Added rich Chart.js hover tooltips displaying point forecast alongside confidence intervals.
- **Universal Data Validation Preview Modal (`css/styles.css`, `js/main.js`, all tool dropzones)**:
  - Built modal dialog `ErlanglyUtils.showCSVPreviewModal(options)` displaying file metadata, valid row count, skipped/error row count, diagnostic line-by-line error alerts, and a scrollable 7-row parsed table preview before committing an upload.
  - Connected preview modal to CSV dropzones in Capacity Planning (`capacity.js`), Forecasting history & actuals (`forecasting.js`), and Shift Scheduling agent roster (`scheduling.js`).
- **Comprehensive Mobile Responsiveness Pass (`css/styles.css`)**:
  - Added touch target padding ($\ge 44\text{px}$) for mobile controls, `.table-responsive` horizontal scrolling containers, flexible stacked panels for $\le 860\text{px}$, $\le 640\text{px}$, and $\le 480\text{px}$ viewports.
  - Verified navigation drawer toggle, panel stacking, and layout readability on 375px mobile viewports.

### Found & fixed during QA
- Guarded optional button and input DOM references in `js/capacity.js` (`btnSendSingleScheduling`, `btnSampleCSV`, `btnDownloadTemplate`, `btnExportBulkCSV`, `btnSendBulkScheduling`) to prevent null reference warnings.
- Fixed `parseCSV` in `js/main.js` to skip completely empty all-blank cell lines (e.g. `,,`), preventing phantom empty rows.
- Added Test Suite 21 to `test/run-tests.js` verifying theme switching, CI calculations, horizon error expansion, and CSV validation (336 total tests passing).

### Deviations from spec (if any)
- None.

---

## [Phase 11] — Collaboration & Multi-Skill Routing — 2026-08-21
**QA sign-off:** erlangly-qa

### Built
- **Database Schema & RLS Policies (`sql/schema.sql`)**:
  - Updated `plans` table RLS policies allowing `SELECT` if owner or listed in `plan_collaborators`; `UPDATE` if owner or `'editor'` in `plan_collaborators`; `DELETE` restricted to owner.
  - Created `public.plan_collaborators` join table (`id`, `plan_id`, `user_id`, `user_email`, `role`, `invited_by`, `invited_at`) with complete RLS access controls.
  - Created `public.plan_versions` table (`id`, `plan_id`, `version_number`, `name`, `inputs`, `outputs`, `created_by`, `created_by_email`, `created_at`) for immutable version snapshots on every save/restore.
- **Supabase Offline & Demo Persistence Engine (`js/supabaseClient.js`)**:
  - Extended local fallback `mockClient` to support chained queries (`select`, `eq`, `in`, `order`, `insert`, `update`, `delete`) across `plans`, `plan_collaborators`, and `plan_versions` with `localStorage` persistence.
- **Plans Persistence, Collaboration & Versioning (`js/plans.js`, `plans.html`)**:
  - Three-tier permission model: **Owner** (full control, share, delete), **Editor** (modify and save), and **Viewer** (read-only inspect/export).
  - Optimistic concurrency conflict detection using `expectedUpdatedAt` vs `updated_at`. If modified by a teammate, displays `showConflictModal` with 3 resolution options (Overwrite, Discard & Reload, Save as New).
  - Automatic immutable version snapshotting on every save, creating version history milestones (`v1, v2, v3...`).
  - Interactive Version History modal (`showVersionHistoryModal`) with timestamps, creator email, one-click version restoration, and visual parameter diffing.
  - Side-by-side visual Diff modal (`showDiffModal`) displaying added, removed, and modified parameter deltas with color-coded comparison badges.
  - Collaborator Management modal (`showCollaboratorsModal`) allowing owners to invite teammates by email, switch roles (`editor` / `viewer`), and remove access.
  - Quick share link modal (`showShareModal`) generating direct copyable URL parameters.
  - Plans Dashboard scope filters (`All Plans`, `👑 Created by Me`, `👥 Shared with Me`) and role badge indicators on plan cards.
- **Multi-Queue Math Engine (`js/erlang.js`)**:
  - `Erlangly.overflowRouting(queues, overflowThresholdSec, intervalSec)`: Pure function computing wait tail probability $P(W > t) = P_C \cdot e^{-(c\mu - \lambda)t}$, overflow Erlangs, primary queue allocation, secondary/backup queue absorption, and headcount savings vs siloed dedicated queues.
  - `Erlangly.skillBasedRouting(queues, dedicatedSplit, intervalSec)`: Pure function solving dedicated specialist requirements and shared multi-skill flex pool with Erlang pooling gain.
- **Capacity Planner Multi-Queue UI (`capacity.html`, `js/capacity.js`)**:
  - Added 4th navigation tab `tab-multiqueue` ("Multi-Queue & Skills").
  - Strategy selector supporting 4 models: `Siloed Dedicated`, `⚡ Overflow Routing`, `🎯 Skill-Based (Flex Tier)`, and `🌐 Full Blended Pool`.
  - Dynamic queue definition editor (add/remove queues, adjust volume, AHT, and target SLAs).
  - Interactive strategy lever controls (wait overflow threshold slider and specialist/flex split slider).
  - Real-time KPI summary (Strategy Staffing, Siloed Baseline, Headcount Saved, Pooling Gain %).
  - Queue performance breakdown table (Offered, Handled, Overflow, Erlangs, Staff, SLA, ASA, Occupancy).
  - Interactive Chart.js comparative bar chart showing staffing distribution across queues and flex tiers.
  - Multi-queue RFC-4180 CSV export and plan persistence.
- **Simulator Queue Architecture & Pooling Lever (`simulator.html`, `js/simulator.js`)**:
  - Added Queue Architecture & Pooling Gain lever in strategic scenario modeling (`Siloed: 0%`, `Overflow: 10%`, `Skill Flex: 15%`, `Full Pool: 20%`), automatically reducing required staffing by the active pooling gain across the simulation horizon.
- **Automated Verification**:
  - Added Test Suite 20 in `test/run-tests.js` covering overflow routing math, wait threshold monotonicity, skill-based flex pooling gain, parameter diffing engine, optimistic concurrency conflict detection, and collaborator persistence. Total passing tests: 322 (0 failures).

### Found & fixed during QA
- Refined `Erlangly.overflowRouting` and `Erlangly.skillBasedRouting` to correctly partition handled volume vs spillover traffic, avoiding double-counting primary capacity and guaranteeing pooling monotonicity ($N_{\text{pooled}} \le N_{\text{multi-queue}} \le N_{\text{siloed}}$).
- Added CommonJS and standard global export support in `js/plans.js` and `js/supabaseClient.js` for standalone Node test runner execution without requiring DOM mocks.

### Deviations from spec (if any)
- None.

---

## [Phase 10] — Enhanced Simulation & Real-Time — 2026-08-21
**QA sign-off:** erlangly-qa

### Built
- **Monte Carlo Simulation Mode in Simulator (`simulator.html`, `js/simulator.js`)**:
  - Probability engine executing 500 stochastic iterations over 12–24 planning horizons in <30ms client-side using pure `Erlangly.*` calculations.
  - Multi-parameter variability configuration with Box-Muller Normal and Uniform distributions for Volume ($\pm \sigma_{\text{vol}}\%$), AHT ($\pm \sigma_{\text{aht}}\%$), Attrition ($\pm \sigma_{\text{att}}\%$), and Hires ($\pm \sigma_{\text{hire}}$ agents).
  - Percentile aggregation engine calculating $P10, P25, P50$ (median), $P75, P90$, Mean, and StdDev across staffing needs, SLA, ASA, Occupancy, and labor cost.
  - Interactive Chart.js confidence band visualizer rendering $P10\text{–}P90$ outer shaded band (`rgba(0, 210, 211, 0.12)`), $P25\text{–}P75$ inner confidence band (`rgba(0, 210, 211, 0.25)`), $P50$ median solid curve, and deterministic baseline overlay.
  - Metric selector (`SLA`, `Required Headcount`, `Productive Headcount`, `Total Labor Cost`) and table view toggle (`Point Projections` vs `Percentiles P10–P90`).
  - Probabilistic executive narrative summary and full matrix CSV exporter.
- **Mobile-Optimized Real-Time Command Center (`realtime.html`, `js/realtime.js`, `css/styles.css`)**:
  - Responsive single-column layout optimized for mobile viewports ($\le 480\text{px}$ and $\le 860\text{px}$).
  - Touch gesture swipe navigation (`touchstart`, `touchmove`, `touchend`) allowing smooth horizontal swiping across intraday intervals.
  - Mobile swipe indicator banner with active interval step counter (`1 / 24`).
  - Mobile touch-optimized action targets ($\ge 44 \times 44\text{px}$) for VTO approval/revocation and stepper controls.
  - Mobile collapsible Day-to-Date Performance Scorecard bar with accessible ARIA toggle.
- **Client-Side Live Data Feed Connector (`realtime.html`, `js/realtime.js`)**:
  - HTTP polling engine supporting JSON and CSV endpoint feeds with configurable refresh intervals (30s, 60s, 120s, or manual).
  - Live status indicator dot and header badge (🟢 Connected / 🟡 Stale Data / 🔴 Connection Error / ⚪ Manual Stepper).
  - Automatic stale data detection triggering visual warning if no update is received in $>2$ polling cycles.
  - Built-in Synthetic Demo Live Feed for offline interactive demonstration with realistic volume and handle-time jitter.
  - Live Feed Configuration modal with endpoint tester and connection diagnostics.
- **Automated Verification**:
  - Expanded `test/run-tests.js` with Test Suite 19 verifying random sampling distributions, percentile monotonicity ($P10 \le P25 \le P50 \le P75 \le P90$), 500-iteration Monte Carlo performance, real-time queue math, and live feed JSON/CSV parsers. Total passing tests: 299.

### Found & fixed during QA
- Guarded DOM references inside `initDOM()` in `js/simulator.js` and `js/realtime.js` so modules export pure calculations cleanly in both browser environments and headless Node.js unit test runners.
- Ensured mathematical engine resolution via `ErlangEngine` fallback across all execution environments.

### Deviations from spec (if any)
- None.

## [Phase 9] — Scheduling Labor Rules & Constraints — 2026-08-21
**QA sign-off:** erlangly-qa

### Built
- **Configurable Labor Rule Engine (`DEFAULT_LABOR_RULES`, `checkShiftCompliance`)**:
  - Configurable hard labor constraints: Max Daily Hours (default 10h), Max Weekly Hours (default 40h), Minimum Rest Period between shifts (default 11h anti-clopening rule), and Max Consecutive Working Days (default 6 days).
  - Pure validator function evaluating agent assignments against hard statutory rules and soft preferences.
- **Part-Time Shift Patterns & Variable-Length Dynamic Breaks (`getBreakRulesForLength`, `DEFAULT_SHIFTS`)**:
  - Dynamic shift break calculator adjusting meal deductions based on shift duration ($\le 4\text{h} \to 0\text{m}$, $\le 6\text{h} \to 15\text{m}$, $\le 8.5\text{h} \to 30\text{m}$, $> 8.5\text{h} \to 60\text{m}$).
  - Supported shift library featuring Full-Time patterns (`S1` Early, `S2` Mid-Morning, `S3` Afternoon, `S4` Close) and Part-Time patterns (`PT1` Morning 4h, `PT2` Mid-Day 6h, `PT3` Afternoon 4h).
- **Agent Availability, Preference Input & Profile Generator (`generateRosterFromFte`)**:
  - Generates realistic agent profiles matching headcount and FT/PT contract mix with availability windows (e.g. Mon–Fri 07:00–21:00, weekends OFF) and preferred shifts.
  - Agent Availability Manager modal dialog (`#modal-agent-manager`) with editable roster table, CSV upload dropzone, and downloadable template (`downloadAgentAvailabilityTemplate`).
- **Constraint-Aware Heuristic Multi-Day Shift Allocator (`optimizeRoster`)**:
  - Evaluates interval deficit reductions, ranks candidate shift patterns, and matches agents while strictly enforcing hard labor rules.
  - Heuristic scoring prioritizes soft shift preferences and balances hours towards weekly target contracts.
  - Generates Bottleneck Diagnostics (`#box-bottleneck-diagnostics`) detailing unmet interval deficits and blocked reason counts (rest periods, weekly hours, consecutive days, availability).
- **7-Day Interactive Agent Roster & Compliance Matrix (`#panel-roster-grid`)**:
  - Full weekly matrix table with sticky agent identity column, interactive colored shift chips (`.shift-ft`, `.shift-pt`, `.shift-off`, `.shift-violation`, `.shift-warning`), and real-time compliance badges (`Pass`, `Warn`, `Error`).
  - Interactive shift picker popover (`#popover-shift-picker`) allowing instant 1-click reassignment of any shift cell with real-time schedule re-auditing.
- **Schedule Audit Engine (`auditRoster`)**:
  - Real-time audit engine verifying all 7-day assignments and computing total paid hours, days worked, compliance rate %, hard violation counts, and soft warning logs.
- **Multi-Day Interval Coverage Visualizer**:
  - Day selector pills (Mon–Sun) updating daytime KPI metrics, Chart.js required vs. scheduled coverage curve, and 48-interval net coverage table.
- **Compliance-Aware CSV Exporter (`exportAgentRosterCSV`)**:
  - Exports full 7-day agent schedule with Agent ID, Name, Contract Type, Mon–Sun shifts, Total Paid Hours, Compliance Status, and Violation Details.

### Found & fixed during QA
- Resolved greedy solver premature break condition by ranking all candidate shifts with positive coverage benefits so unfillable peak shifts do not block filling earlier intervals.
- Tested clopening rest calculations across day boundaries (13:30–22:00 close followed by 08:00 open correctly yields 10.0h rest < 11.0h min, triggering hard error).
- All 275 automated tests in `test/run-tests.js` passed with 0 errors.

### Deviations from spec (if any)
- None.

---

## [Enhancement] — Multi-Skill Demand Forecasting & Standardized Templates — 2026-08-20
**QA sign-off:** erlangly-qa

### Built
- **Standardized RFC-4180 CSV Templates (`downloadHistoricalTemplate`, `downloadActualsTemplate`)**:
  - Downloadable Historical Demand Template (`Date,Skill,Volume,AHT`) providing users a single pre-formatted structure that prevents upload formatting errors.
  - Downloadable Actuals Tracking Template (`Date,Skill,Forecast,Actual,AHT`) for actuals volume tracking and accuracy evaluation.
  - Quick-download action buttons integrated in both the Historical Training CSV dropzone (`#btn-download-forecast-template`) and the Actuals & Accuracy tracking dropzone (`#btn-download-accuracy-template`).
- **Multi-Skill Demand Web Worker & Parser (`js/workers/csv-parser.js` & `js/forecasting.js`)**:
  - Automatically identifies skill/queue columns (`Skill`, `Queue`, `Channel`, `LOB`, `Service`, `Skill_Group`, `Line_of_Business`).
  - Supports large files up to 100k+ rows parsed in background Web Worker, aggregating demand by `(Date, Skill)` and computing volume-weighted AHTs.
- **Combined + Per-Skill Dual Forecasting Engine (`runForecast` & `updateActiveSkillView`)**:
  - Generates individual forecasts for each discrete skill queue in the uploaded dataset.
  - Computes a blended, volume-weighted composite forecast across all queues ($\sum V_i$ volume and $\frac{\sum V_i \times \text{AHT}_i}{\sum V_i}$ blended AHT).
- **Interactive Multi-Skill Filter Bar & UI (`forecasting.html`, `js/forecasting.js`, `css/styles.css`)**:
  - Skill filter toolbar (`#box-skill-filter-bar`) with dropdown selector (`#select-skill-filter`) and mode badge (`#badge-skill-mode`).
  - Seamlessly toggles between "🌐 Combined (All Skills)" and individual queues (e.g. `Customer Care`, `Technical Support`, `Billing & Inquiries`).
  - Dynamically updates the historical training table, forecast projection table, and Chart.js visualization with queue-specific labels and metrics.
- **Multi-Skill Actuals Matching & History Merge**:
  - Auto-matches actuals CSV rows against baseline forecasts using compound keys `(Period, Skill)`.
  - Merging actuals into historical series preserves per-skill breakdowns and updates existing records without duplication.
- **Multi-Skill CSV Export & Capacity Planning Handoff**:
  - "Export Forecast CSV" exports all individual queues plus the combined rollup with queue tags and Erlangs.
  - "Send to Capacity" hands off active queue parameters to `capacity.html`.

### Found & fixed during QA
- Verified in `SAMPLE_MULTI_SKILL_HISTORY` that 28 days with 3 skills (84 records) parse with distinct AHTs (180s, 300s, 150s) and combine into a volume-weighted composite.
- Verified in browser subagent that downloading templates generates valid RFC-4180 CSV files with expected headers and sample rows.
- All 236 automated unit tests passed with 0 failures (`node test/run-tests.js`).

### Deviations from spec (if any)
- None.

---

## [Phase 13] — Forecast Holdout Sandbox — 2026-08-20
**QA sign-off:** erlangly-qa

### Built
- **Forecast Holdout Sandbox UI & Architecture (`forecasting.html`, `js/forecasting.js`, `css/styles.css`)**:
  - Interactive "test algorithm on past months" harness integrated directly into the Model Comparison panel.
  - Interactive Segmented Mode Toggle: easily switches between **📊 Last N Periods** (fast walk-forward holdout) and **🎯 Specific Month Sandbox** (calendar month holdout).
- **Target Month Selection & Discovery (`extractHistoryMonths`)**:
  - Automatically parses historical dates, groups records by calendar year-month (`YYYY-MM`), extracts period counts and preceding training days.
  - Interactive month chip grid in UI with multi-select support, eligibility status badges, and quick-select helpers (*Select Last Month*, *Select Last 3 Months*, *Clear*).
  - First calendar month in historical series is automatically marked ineligible and disabled with explanatory tooltip (zero preceding training data).
- **Strict Before-Only Training (Zero Data Leakage)**:
  - For any target month $M$, training slice strictly includes data with timestamp $< M_{\text{start}}$.
  - Data from or after target month $M$ is strictly excluded, ensuring 100% out-of-sample integrity.
- **Configurable Lookback Window**:
  - Allows constraining the training window preceding the target month: "All available history" or 1, 3, 6, or 12 months lookback.
- **Accuracy Metrics Engine Integration**:
  - Reuses the shared Phase 12 accuracy metrics engine (`calculateAccuracyMetrics`) across candidate models (`holt`, `decomp_mult`, `trend`, `regression`, `yoy_trend`, `ensemble`) to compute:
    - Holdout WAPE % (Volume-weighted error)
    - Holdout MAPE % (Mean absolute percentage error)
    - Signed Forecast Bias % ($+$/$-$ error direction)
    - Holdout MAE & RMSE
- **Multi-Month Consistency Matrix (`evaluateSandboxConsistency`)**:
  - When 2+ target months are selected, dynamically renders a side-by-side consistency matrix table.
  - Displays per-month WAPE columns, Overall Volume-Weighted WAPE %, Overall Signed Bias %, Stability Standard Deviation ($\sigma_{\text{WAPE}}$), and WAPE Range ($\max - \min$).
  - Highlights the **🏆 Best Overall** algorithm and **Most Stable** algorithm.
- **Interactive Live Chart Overlay (`renderChart`)**:
  - Displays full historical actuals, target month ground truth curve, and dashed holdout prediction curve for the actively viewed model.
  - 1-click "👁️ View" buttons allow instant switching of the active overlay model.
- **1-Click Model Selection & Carry-Over Action (`applySandboxWinner`)**:
  - "⚡ Use Winner for Production" action immediately promotes the top-performing holdout algorithm to the active production forecast for future horizons.
- **Persistence & RFC-4180 CSV Export**:
  - Holdout sandbox configuration (`backtestMode`, `sandboxTargetMonths`, `sandboxLookback`, `sandboxActiveModelId`) persists in Supabase plans via `plans.js` and URL share tokens.
  - Dedicated "Export Sandbox CSV" exports comprehensive holdout records and accuracy metrics.

### Found & fixed during QA
- Verified in `SAMPLE_MULTI_YEAR_HISTORY` that 730 periods generate 24 calendar months spanning `2024-06` to `2026-05`, with preceding counts starting at 0 for the first month and advancing to 699 for the 24th month.
- Verified that lookback window filtering correctly bounds the training slice (e.g. 92 days for 3-month lookback vs 487 days for all-history lookback on October 2025).
- All 194 automated test assertions passed with 0 failures (`node test/run-tests.js`).
- Verified complete browser interaction via browser subagent.

### Deviations from spec (if any)
- None. Fully adheres to `FEATURES.md`, `ROADMAP.md`, `AGENTS.md`, and `styles.css` token conventions.

---

## [Phase 12] — Forecasting Enhancements II — 2026-08-19
**QA sign-off:** erlangly-qa

### Built
- **Year-over-Year (YoY) Seasonal Trend Projection Model (`yoy_trend`)**:
  - Registered in `forecasting.js` modular model registry.
  - Aligns future dates with the matched calendar day 52 weeks (364 days) prior to preserve day-of-week demand patterns (e.g. Monday-to-Monday alignment).
  - Trailing YoY growth window calculates annualized baseline shift ($g_{\text{YoY}}$) with configurable lookback.
  - Minimum history guard: dynamically inspects loaded date span and displays a visual warning / disables fitting when history is $< 12$ months ($< 365$ days), with graceful fallback to linear trend.
  - Added 2-year synthetic dataset generator (730 daily intervals) with multi-year trend and seasonal variations.
- **Walk-Forward Out-of-Sample Backtesting (`backtestModel`, `runBacktestAll`)**:
  - Automatically partitions history into training and holdout windows (configurable holdout periods, default 7).
  - Evaluates models out-of-sample and computes holdout metrics: Holdout MAE, Holdout Out-of-Sample MAPE %, Holdout WAPE %, Holdout RMSE, and Overfit Gap ($\text{MAPE}_{\text{OOS}} - \text{MAPE}_{\text{in-sample}}$).
  - Integrated into Model Comparison table with side-by-side ranking.
- **Forecast Accuracy Tracking Tool (`forecasting.html` + `js/forecasting.js`)**:
  - Dedicated Accuracy Tracking view with interactive actuals-vs-forecast pairs table, CSV import, and 1-click "From Forecast" population.
  - Computes WFM standard accuracy KPIs:
    - Volume-Weighted MAPE ($\text{WAPE} = \frac{\sum |A - F|}{\sum A} \times 100$)
    - Standard Unweighted MAPE ($\frac{1}{N} \sum \frac{|A - F|}{A} \times 100$)
    - Signed Forecast Bias % ($\frac{\sum (F - A)}{\sum A} \times 100$, where positive denotes over-forecasting/surplus and negative denotes under-forecasting/deficit)
    - Mean Absolute Error (MAE) and Root Mean Squared Error (RMSE)
    - Cumulative Tracking Signal ($\frac{\text{Cumulative Bias}}{\text{MAD}}$)
  - Detailed interval variance table with color-coded status badges (`On Target`, `Over-Forecast`, `Under-Forecast`).
  - Historical evaluations log table and persistence across plans (`savePlan`, `loadPlan`, and RFC-4180 CSV export).
- **Ensemble / Blended Forecast Model (`ensemble`)**:
  - Blends predictions from multiple candidate models (e.g., Holt's, Seasonal Decomposition, Multi-variable Regression, YoY Trend).
  - Supports **Auto-Weighting** via inverse backtest RMSE ($w_i \propto \frac{1}{\text{RMSE}_i^2}$) and **Manual Weighting** with interactive slider/number inputs normalized to 100%.
  - Seamless handoff to Capacity Planning tool.
- **Automated Tests (`test/run-tests.js`)**:
  - Added 20 new unit tests covering YoY seasonal matching, history sufficiency checks, out-of-sample walk-forward backtesting, accuracy metric calculations (WAPE, Bias, Tracking Signal), and ensemble auto/manual weighting.
  - Full test suite passes with 147 passed and 0 failed.

### Found & fixed during QA
- Adjusted Phase 8 model count assertion in test runner to accommodate the new total of 10 registered models.
- Verified that backtesting holdout parameter dynamically updates OOS metrics across all candidate models without altering training series bounds.
- Verified Capacity Planning handoff receives the blended ensemble forecast output seamlessly.

### Deviations from spec (if any)
- Implemented Phase 12 prior to Phases 9–11 per explicit user directive (`/goal read the roadmap and skip phase 9-11. Implement phase 12 1st`). Phases 9–11 remain pending in `ROADMAP.md`.

---

## [Phase 8] — Advanced Forecasting Models — 2026-08-19
**QA sign-off:** erlangly-qa

### Built
- **Pluggable Model Architecture (`js/forecasting.js`)**:
  - Modular model registry exposing a unified contract (`id`, `name`, `category`, `params`, `fit`, `predict`, `getMetrics`).
  - Standardized in-sample fit metrics: MAE, MAPE %, MSE, RMSE, and $R^2$ goodness-of-fit %.
  - 8 Time-Series Forecasting Algorithms:
    1. **Weighted Moving Average (WMA)** with local window trend estimation.
    2. **Simple Moving Average (SMA)** unweighted rolling mean.
    3. **Linear Trend Projection (OLS)** Ordinary Least Squares linear regression.
    4. **Seasonal Decomposition (Multiplicative)**: Extracts cyclical day-of-week indices ($Y = T \times S \times I$), deseasonalizes history, and fits trend projection.
    5. **Seasonal Decomposition (Additive)**: Extracts zero-sum seasonal offsets ($Y = T + S + I$).
    6. **Simple Exponential Smoothing (SES)**: Level recursion with 1D grid search auto-optimization of $\alpha$ minimizing MSE.
    7. **Holt's Double Exponential Smoothing**: Level and trend tracking with 2D grid search auto-optimization of $(\alpha, \beta)$ minimizing MSE.
    8. **Multi-Variable Regression**: Matrix OLS estimating time slope plus 6 day-of-week binary indicator dummy variables ($D_1 \dots D_6$) solved via Gaussian elimination with partial pivoting.
- **Holiday & Event Flag System (`forecasting.html` + `js/forecasting.js`)**:
  - Event manager table supporting custom dates, event names, and actions (`scale` multiplicative adjustment or `exclude` outlier from training).
  - Outlier handling: excludes or interpolates historical spikes/dips before model training.
  - Future projection scaling: multiplies forecast on flagged dates by $(1 + \text{impact}\%)$ and displays event badge (e.g. `🎉 Memorial Day Spike`).
- **Model Comparison View & Multi-Model Visualizer**:
  - Side-by-side comparative table ranking models by in-sample fit metrics (MAPE, MAE, RMSE, $R^2$) with "Best Fit" highlight and 1-click model activation.
  - Chart.js multi-curve visualizer plotting historical actuals alongside multiple candidate forecast projections in distinct control-room dashed colors.
- **Persistence & Cross-Tool Handoff**:
  - Save Plan modal (`ErlanglyPlans.showSaveModal('forecasting', ...)`) and Shareable Link modal (`ErlanglyPlans.showShareModal('forecasting', ...)`).
  - Cross-tool handoff receiver for `?from=plans` and `window.ERLANGLY_SHARED_DATA`.
  - Handoff sender to Capacity Planning (`capacity.html?from=forecast`) and RFC-4180 CSV export.
- **Automated Test Suite (`test/run-tests.js`)**:
  - 32 new unit tests covering all 8 models, fit metrics, auto-optimization search, seasonal decomposition, matrix solvers, and holiday scaling (92 total tests passing with 0 failures).

### Found & fixed during QA
- Verified 2D grid search for Holt's parameters correctly disables manual slider inputs when auto-optimization is checked.
- Verified holiday scaling dynamically adjusts forecast table and reflects in Capacity Planning handoff (`13,395` total volume transferred).
- Verified responsive layout and clean console logs across all interactions.

### Deviations from spec (if any)
- None.

---

## [Phase 7] — Polish & Portfolio Packaging — 2026-08-18
**QA sign-off:** erlangly-qa

### Built
- **Full Accessibility & Responsive Pass**:
  - Global `:focus-visible` ring on all interactive controls using `--border-focus` token.
  - `prefers-reduced-motion` media query in `css/styles.css` collapses all animation/transition durations to 0.01ms.
  - Responsive layout confirmed across all six tool pages at 375px viewport width.
  - `aria-current="page"` applied to active nav links; `aria-expanded` on mobile menu toggle.
- **README.md** — Comprehensive portfolio documentation including:
  - Feature summaries for all five WFM tools with algorithmic detail.
  - Full Erlang C queueing theory math writeup with LaTeX-rendered formulas (traffic intensity, Erlang B recursion, Erlang C delay probability, service level, ASA, occupancy, shrinkage).
  - Repository structure map, running instructions, test suite coverage description, and security architecture.
  - Badges for architecture, math engine, test pass rate, and persistence method.
- **Shareable Read-Only Links** (complete end-to-end implementation):
  - `ErlanglyPlans.createShareableLink()` encodes plan inputs as base64 URL parameter `?shared=1&data=<b64>`.
  - `ErlanglyPlans.showShareModal()` displays a share dialog with 1-click clipboard copy.
  - `ErlanglyUtils.getSharedData()` added to `main.js` — decodes and validates the URL payload safely (catches malformed base64).
  - `ErlanglyUtils.checkSharedPreview()` updated to decode and expose shared data via `window.ERLANGLY_SHARED_DATA` before tool init runs.
  - `capacity.js`, `scheduling.js`, and `simulator.js` updated to read `window.ERLANGLY_SHARED_DATA` on init and restore all form inputs from the shared link.
  - Shared-mode hides Save button to enforce read-only semantics.
- **My Plans "Open" Handoff** fix:
  - `capacity.js` now handles `?from=plans` — restores both single-mode params and bulk intervals from the `localStorage` handoff set by `plans.html`.
  - `scheduling.js` now handles `?from=plans` — restores interval data and FTE settings.
  - `simulator.js` already had `from=plans` support (carried forward); shared-data loading added.
- **Multi-Skill / Multi-Queue Erlang C Variant** (`js/erlang.js`):
  - `Erlangly.blendedWorkload(queues, intervalSec)` — computes composite Erlangs and volume-weighted AHT across multiple skill queues.
  - `Erlangly.multiSkillPoolingEfficiency(queues, targetSLA, targetTime, intervalSec)` — quantifies headcount savings from consolidating siloed queues into a single blended pool.
  - Both functions tested in `test/run-tests.js` (tests [8]).

### Found & fixed during QA
- **Shared link data loading was missing** — `checkSharedPreview()` previously only showed a banner without decoding the URL payload. Fixed by adding `getSharedData()` and exposing `window.ERLANGLY_SHARED_DATA` for tool pages to consume.
- **`?from=plans` handoff not handled** in `capacity.js` and `scheduling.js` — both fixed to restore plan inputs when navigated to from My Plans dashboard.
- All 29 automated unit tests passed with 0 failures after all Phase 7 changes.

### Deviations from spec (if any)
- None. All Phase 7 items delivered as specified: accessibility pass, README, shareable links, multi-skill Erlang C variant, and final QA sign-off.

---

## [Phase 6] — Workforce Planning Simulator — 2026-08-18
**QA sign-off:** erlangly-qa

### Built
- **Workforce Planning Simulator (`simulator.html` + `js/simulator.js`)**:
  - Multi-period strategic scenario simulation (6, 12, 24-month planning horizons) driven purely by `js/erlang.js`.
  - Comprehensive what-if levers: baseline volume, AHT, monthly volume growth %, AHT drift %, starting headcount, monthly attrition %, monthly new-hire batches, time-to-productivity nesting lag (0, 1, or 2 months), loaded hourly wage, and monthly budget ceilings.
  - Productivity nesting ramp modeling tracking new-hire cohorts across multiple training months before reaching 100% operational throughput.
  - Multi-scenario comparative visualization with Chart.js plotting Scenario A (Status Quo), Scenario B (Aggressive Hiring), and Scenario C (Budget Capped) simultaneously.
  - Automated breach detection identifying the exact first period where a scenario drops below the 80% SLA threshold or breaches monthly budget caps.
  - Automated plain-language executive narrative generator providing clear strategic recommendations for leadership presentations.
  - Full persistence integration with Phase 5 Supabase/Plans layer (`tool: "simulation"`) and RFC-4180 CSV export.

### Found & fixed during QA
- Verified multi-scenario chart updates upon adjusting volume growth (5% growth detected SLA breach at Month 3).
- Verified scenario saving and re-opening via `plans.html` with restored inputs.
- All 27 automated unit tests passed with 0 failures.

### Deviations from spec (if any)
- None.

## [Phase 5] — Accounts & Persistence — 2026-08-18
**QA sign-off:** erlangly-qa

### Built
- **Database Schema (`sql/schema.sql`)**: Single `plans` table with indexes and comprehensive Row Level Security (RLS) policies enforcing `auth.uid() = user_id` for SELECT, INSERT, UPDATE, and DELETE.
- **Supabase Client (`js/supabaseClient.js`)**: Pure client-side initialization using safe public anon key, with automatic mock storage sandbox fallback for offline or unconfigured environments.
- **Authentication Engine (`js/auth.js`)**: Sign up, login with email/password, magic link OTP, sign out, session management, and dynamic navigation bar profile updates.
- **Plans Persistence Engine (`js/plans.js`)**: `savePlan`, `loadPlan`, `listPlans`, `deletePlan`, `renamePlan`, and accessible `showSaveModal` modal dialog supporting explicit save actions across tools.
- **Authentication Page (`login.html`)**: Clean tabbed login and registration interface with magic link option.
- **My Plans Dashboard (`plans.html`)**: Tool category filters (All, Capacity, Forecasting, Scheduling, Real-Time, Simulation), search by plan name, re-open into corresponding tool with restored inputs, in-place rename, and delete actions.

### Found & fixed during QA
- Verified end-to-end plan lifecycle: Created "Peak Season Retail Line" in Capacity Planner, listed on dashboard, renamed to "Peak Season Retail Line v2", reopened with restored parameters, and deleted.
- Verified authenticated navigation state update (`👤 test`) and logout flow.

### Deviations from spec (if any)
- None.

## [Phase 4] — Real-Time / Intraday Analysis & VTO Calculator — 2026-08-18
**QA sign-off:** erlangly-qa

### Built
- **Real-Time & VTO Tool (`realtime.html` + `js/realtime.js`)**:
  - Intraday shift simulation stepper ("Simulate the Day") with Previous, Next, Reset, Jump-to-interval, and Play/Pause auto-advance timer.
  - Live interval queue metrics: Actual Service Level %, ASA (s), Agent Occupancy %, Volume Actual vs Plan variance %, Staffing Adherence %, and Erlangs.
  - Day-to-date cumulative performance scorecard tracking cumulative volume variance, volume-weighted SLA, average ASA, and adherence alerts.
  - Full intraday interval progression timeline with color-coded status badges (Normal, Volume Spike, Adherence Alert, SLA Breach).
  - Guarded VTO Calculator with configurable SLA protection buffer, occupancy ceiling, per-interval agent cap, and hourly wage rate.
  - VTO management sheet calculating maximum offerable safe VTO agents and hours per surplus interval without putting target SLA at risk.
  - Interactive "+1" / "-1" VTO approval controls that recalculate projected SLA in real-time.
  - "Approve All Safe VTO" action with cumulative daily labor cost savings computation ($2,002.00 saved on 91.0 safe VTO hours) and CSV export.

### Found & fixed during QA
- Verified stepper loop advances smoothly across all 24 intervals.
- Tested single-interval VTO approval (+1 agent reduced SLA safely from 99.7% to 99.3% with +$11.00 savings).
- Verified zero console errors.

### Deviations from spec (if any)
- None.

## [Phase 3] — Scheduling & Forecast-to-FTE Converter — 2026-08-18
**QA sign-off:** erlangly-qa

### Built
- **Scheduling Tool (`scheduling.html` + `js/scheduling.js`)**:
  - Forecast → Required FTE Converter translating interval demand into weekly net/gross staff-hours, standardized FTE (e.g. 40.0h or 37.5h work week), and hiring breakdown by FT/PT mix.
  - Daily FTE breakdown table with day-of-week demand distributions and export to CSV.
  - Shift pattern definition system (start time, shift length, unpaid meal start/duration, net paid work-hours).
  - Shift coverage optimization algorithm that distributes headcount across shift patterns to eliminate understaffing gaps while minimizing surplus waste.
  - Chart.js interval coverage analysis visualizer (Required Headcount stepped line vs. Scheduled Headcount area).
  - Interval coverage breakdown table with surplus/deficit tracking and CSV export.
  - Seamless handoff receiver from Capacity Planning (`?from=capacity`).

### Found & fixed during QA
- Verified dynamic FTE updates on varying work-week (37.5h) and PT proportions (30%).
- Verified shift optimizer reduces coverage deficit from 26h down to 5h (99.3% match).

### Deviations from spec (if any)
- None.

## [Phase 2] — Forecasting — 2026-08-18
**QA sign-off:** erlangly-qa

### Built
- **Forecasting Tool (`forecasting.html` + `js/forecasting.js`)**:
  - Manual history table with dynamic row addition/removal and sample 28-day dataset.
  - Large-CSV parsing off-thread via Web Worker (`js/workers/csv-parser.js`) with chunked FileReader, progress bar UI, and client-side aggregation (daily rollup or interval).
  - Tolerant parser that skips malformed rows with count reporting and verified against 200,000 synthetic rows in 77ms.
  - Forecast algorithms: Weighted Moving Average (WMA), Simple Moving Average (SMA), and Linear Trend Projection (OLS).
  - Day-of-week multiplicative seasonality weighting indices ($S_d$) and growth modifier percentage.
  - Interactive Chart.js history vs forecast dual-curve visualizer in dark control-room theme.
  - Forecast breakdown results table with trend factors, seasonal indices, and estimated Erlangs.
  - Export Forecast CSV and "Send to Capacity Planning" cross-tool handoff via `localStorage`.

### Found & fixed during QA
- Tested Web Worker streaming against a synthetic 200k-row CSV (4.70 MB) — successfully aggregated 200k rows into 2,084 daily periods without UI freezing.
- Seamless handoff between Forecasting and Capacity Planning confirmed (`capacity.html?from=forecast`).

### Deviations from spec (if any)
- None.

## [Phase 1] — MVP: Capacity Planning End-to-End — 2026-08-18
**QA sign-off:** erlangly-qa

### Built
- **Capacity Planning Page (`capacity.html` + `js/capacity.js`)**:
  - Single-interval Erlang C solver with synchronized range sliders and numeric steppers (Volume, AHT, Interval, Target SLA, Answer Threshold, Max Occupancy, Shrinkage).
  - Dynamic KPI cards (Staffed Agents, Base Net Agents, Projected SLA %, ASA, Occupancy %, Erlangs) with color-coded status badges.
  - Headcount Sensitivity Analysis table showing adjacent agent counts (-3 to +3) with selected plan highlight.
  - Bulk CSV Interval Mode supporting multi-interval day/week upload, custom delimiter/quote handling, template download, and preloaded daytime 24-interval sample data.
  - Bulk Summary KPI cards: Total Volume, Weighted AHT, Peak Staffed Headcount & interval time, Total Paid Staff-Hours, Weighted Average SLA %, Weighted Average Occupancy %.
  - Full interval staffing table with status badges.
  - Export Plan as CSV.
  - Cross-tool handoff to Scheduling tool via `localStorage` with `?from=capacity` query string.
  - Auto-load incoming handoff parameters from landing page hero (`?from=hero`) or forecasting (`?from=forecast`).

### Found & fixed during QA
- Responsive viewport testing confirmed layout stacks smoothly on mobile down to 375px with scrollable table container.
- Clean console logs with zero runtime exceptions.

### Deviations from spec (if any)
- None.

## [Phase 0] — Foundations — 2026-08-18
**QA sign-off:** erlangly-qa

### Built
- **Design system (`css/styles.css`)**: Dark "control room" theme, custom tokens (`--accent`, `--warn`, `--danger`, `--success`), typography (`IBM Plex Mono` + `Inter`), responsive layouts, accessible `:focus-visible` rings, and `prefers-reduced-motion` compliance.
- **Core math engine (`js/erlang.js`)**: Pure, numerically stable queueing engine supporting `trafficIntensity`, `erlangB`, `erlangC`, `serviceLevel`, `averageSpeedOfAnswer`, `occupancy`, `shrinkageAdjust`, `agentsRequired` solver, and `sensitivityCurve`.
- **Shared utilities (`js/main.js`)**: Navigation active states, RFC-4180 CSV parser, CSV export, drag-and-drop file upload handler, numeric/time formatters, toast notification system, and `localStorage` cross-tool handoff.
- **Landing page (`index.html`)**: Semantic structure, responsive navigation, integrated WFM suite showcase, queueing theory educational section, and live interactive Erlang C hero mini-calculator with dynamic KPI cards, sensitivity sparkline, and Capacity Planner handoff.
- **Verification suite (`test/run-tests.js`, `test/math-test.html`)**: Automated and in-browser test runners verifying Erlang B/C reference points, monotonicity, boundary overloads, zero-volume handling, and shrinkage math.

### Found & fixed during QA
- Reference test expectations for $A=100$, $m=110$ refined to exact analytical values ($P_w = 0.2370$, $\text{ASA} = 4.27\text{s}$, $\text{SL} = 92.2\%$).
- Verified 375px mobile viewport rendering and responsive hamburger menu drawer with zero overflow.

### Deviations from spec (if any)
- None.

## [Unreleased]

Nothing unreleased for Phase 0. Phase 1 (MVP: Capacity Planning) is ready to begin.
