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
