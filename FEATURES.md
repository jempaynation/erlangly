# Erlangly — Features

## Platform (cross-cutting)
- Landing page with a live, interactive Erlang C demo as the hero (not a screenshot — a real working mini-calculator)
- Shared dark "control room" design system (`css/styles.css`) reused by every tool page
- Shared math engine (`js/erlang.js`) — one source of truth for Erlang C, ASA, occupancy, staffing math
- CSV upload OR manual form entry on every tool, per your preference
- CSV export from every tool's output table
- Handoff between tools via `localStorage` (e.g. capacity plan → scheduling tool) so the suite feels like one product, not four disconnected pages
- No build step — static HTML/CSS/JS, deployable to GitHub Pages, Netlify, Vercel, or any static host, which matters both for a portfolio piece (clean, readable source) and for a WFM team that may not have a dev pipeline

## Accounts & Saved Data (NEW — moved in from Future Developments)
- Sign up / log in (email+password or magic link)
- Every tool's output can be saved to the user's account, not just exported as CSV:
  - Named, timestamped "plans" per tool (e.g. "Q3 forecast — retail line", "Peak week capacity plan")
  - A "My Plans" dashboard listing everything a user has saved, across all tools, newest first
  - Re-open a saved plan into the tool that created it, with all inputs restored
  - Delete / rename saved plans
- `localStorage` handoff between tools (capacity → scheduling, etc.) stays as-is for same-session, no-login use — accounts are additive, not required to use the core tools
- Data model: one row per saved plan, storing tool type, inputs, computed outputs, and a free-text name — see AGENTS.md for schema

## 1. Forecasting
- Manual entry table for historical volume (add/remove rows) or CSV upload (`date/interval, volume`)
- **Large CSV support**: multi-year interval-level history (potentially 100k+ rows — e.g. 15-min intervals over 3 years) must not freeze the tab
  - Streamed/chunked parsing instead of reading the whole file into memory at once
  - Parsing runs off the main thread (Web Worker) so the UI stays responsive
  - Progress indicator during parse/aggregate ("Parsed 40,000 / 210,000 rows")
  - Client-side pre-aggregation (e.g. roll 15-min rows up to daily) so the forecast model and chart aren't fed the raw row count
  - Friendly handling of malformed rows (skip + report count, don't hard-fail the whole upload)
- Weighted moving average + trend forecast, with adjustable horizon
- Optional day-of-week / interval seasonality weighting
- Chart of history vs. forecast (Chart.js), downsampled for rendering when history is very long
- Export forecast as CSV, save to account, or send straight into Capacity Planning

## 2. Capacity Planning
- Single-interval Erlang C calculator: volume, AHT, interval length, target SL, answer-within threshold, max occupancy, shrinkage
- Outputs: base agents required, shrinkage-adjusted staffed agents, service level, ASA, occupancy
- Bulk mode: upload a full day/week CSV (`interval, volume, aht`) and get an interval-by-interval staffing plan
- Color-coded service-level tags (on target / at risk / breach)
- Export plan as CSV, save to account, or send required-agents-per-interval straight into Scheduling

## 3. Scheduling
- Input: required agents per interval (from Capacity, CSV, or manual) + a set of shift patterns (start time, length, break placement)
- Allocates headcount across shift patterns to cover the requirement
- Coverage chart: required vs. scheduled agents per interval, with gaps/surplus highlighted
- Export the shift allocation as CSV, or save to account

### Forecast → Required FTE Converter (NEW)
The bridge step before shift-building: turns an interval-level volume forecast into a
headcount number a scheduling or budget conversation can actually use.
- Input: interval-level forecast volume for a period (day/week/month) — pulled straight
  from a saved Forecast, an interval-level CSV, or Capacity Planning's bulk output
- Runs each interval through the same Erlang C engine as Capacity Planning to get
  required agents per interval (reuses `Erlangly.agentsRequired`, not a separate calc)
- Sums required-agent-intervals into total required staff-hours for the period
- Converts staff-hours into required FTE using a configurable standard work week
  (e.g. 37.5 or 40 hrs), with an optional part-time mix input (e.g. "20% of staff at
  20 hrs/week") so the FTE number reflects the actual workforce mix, not just a
  full-time assumption
- Applies shrinkage on top (reuses the same shrinkage input/logic as Capacity Planning)
  to get a "staff to hire/schedule" FTE figure, not just a theoretical minimum
- Breaks the total down by day (for a week/month forecast) so it's clear where demand
  concentrates, not just a single flat number
- Output feeds directly into the shift-pattern allocator above — required FTE becomes
  the target headcount the shift patterns need to cover
- Export the FTE breakdown as CSV, or save to account

## 4. Real-Time / Intraday Analysis
- Input forecast vs. actual volume and staffing per interval (manual or CSV)
- "Simulate the day" stepper that walks through intervals like a live shift
- Live-recomputed service level, ASA, occupancy per interval as actuals come in
- Adherence view (scheduled vs. actual staff) with breach alerts (amber/red states)
- Save a completed session to account as a record of "how the day actually went" vs. plan

### VTO Calculator (NEW)
Flip side of understaffing alerts: when an interval is running *over* plan, this tells
you how much Voluntary Time Off you can safely offer without putting the interval at risk.
- Reads the same per-interval actual-vs-required staffing data as the rest of the
  real-time tool — no separate data entry
- For each surplus interval, computes the max agents/hours offerable as VTO while
  still holding a configurable buffer above the Erlang C-required staffing (e.g.
  "keep service level ≥ 80% even after VTO is approved," not just "≥ required agents")
- Guardrails, all adjustable:
  - Minimum occupancy floor (don't let approving VTO push occupancy above a ceiling either — over-offering VTO can overcorrect into understaffing later if actuals shift)
  - Max VTO per interval (agent count or % of interval headcount), to avoid single-interval swings
  - Optional daily/weekly VTO cap per agent, if that data is available
- Output per surplus interval: agents eligible, VTO hours available, projected service
  level/occupancy if fully approved
- Running daily total of VTO hours offered, and cumulative labor cost saved if an
  hourly rate is provided
- "Approve" a VTO amount inline and see the interval's projected service level update
  live, same pattern as the rest of real-time analysis
- Export the VTO offer list as CSV (interval, agents eligible, hours) — the sheet an
  RTA analyst would actually send out or post

## 5. Workforce Planning Simulator (NEW)
The tool that turns the other four into an actual planning exercise instead of four
separate calculators. Lets a user build "what-if" scenarios and simulate how staffing
needs evolve over a multi-week or multi-month horizon, not just one interval or one day.
- Start from a saved forecast (or enter a baseline volume + growth assumption)
- Adjustable what-if levers, each as a simple slider or input:
  - Volume growth/decline (% per week or month)
  - AHT change (e.g. a new IVR or product launch shifts AHT by X%)
  - Shrinkage change (e.g. a new PTO policy, seasonal absenteeism)
  - Attrition rate and hiring ramp (new hires per month, time-to-productivity/nesting period)
  - Budget ceiling (max headcount or max labor cost)
- Runs the simulation period-by-period using the same Erlang C engine under the hood,
  projecting required agents, staffed agents (accounting for attrition/hiring lag), and
  resulting service level/occupancy for each period
- Scenario comparison: build 2–3 scenarios side by side (e.g. "status quo" vs. "aggressive
  hiring" vs. "budget-capped") and see projected service level and headcount gap for each,
  on one chart
- Flags the period a scenario first breaches target service level or budget, so the "what
  happens if we don't hire" question has a concrete answer
- Save scenarios to account; reopen and tweak assumptions later
- Export a scenario as CSV (period-by-period projection) or as a simple summary a planner
  could paste into a business case

## Explicitly out of scope (not planned)
- Native mobile app — responsive web only (but see mobile-optimized real-time view below)
- Real-time collaborative editing with live cursors / presence indicators (see simpler collaborative plans below instead)
- Server-side computation, ML model training, or external optimization solvers — all math stays client-side and pure
- WebSocket / SSE live data infrastructure — the live data feed is client-side polling only

---

## v2 Features (Phases 8–13 — see ROADMAP.md for build order and status)

### 8. Advanced Forecasting Models (Phase 8)
Extends the forecasting tool from three basic models (WMA, SMA, Linear Trend) to a
pluggable model architecture with richer options. All models remain pure client-side
JavaScript functions — no external ML libraries.

- **Pluggable model architecture**: refactored `forecasting.js` with a common model
  interface so algorithms are interchangeable without touching the rest of the tool.
  Each model exposes: `fit(historyData)`, `predict(horizon)`, and `metrics()` (fit
  quality). The existing WMA/SMA/Trend models are migrated to this interface, then new
  models are added alongside them.
- **Seasonal decomposition**: additive and multiplicative decomposition
  (Trend × Seasonal × Residual or Trend + Seasonal + Residual). User picks the
  decomposition type; the tool extracts the seasonal component and uses it for
  deseasonalized forecasting. Builds on the existing day-of-week seasonality weighting
  but adds formal decomposition math.
- **Exponential smoothing**:
  - Simple Exponential Smoothing (SES) with configurable smoothing constant α — best
    for level data without trend or seasonality
  - Holt's Double Exponential Smoothing with separate α (level) and β (trend) parameters
    — captures trend without seasonality
  - Both support auto-optimization of smoothing parameters by minimizing in-sample MSE
    (grid search or golden-section, not gradient descent — keep it simple and debuggable)
- **Holiday / event flag system**: user marks specific dates as holidays or events via a
  simple table (date + label + expected impact %) or CSV upload. Flagged dates are either
  excluded from training data (so they don't distort the baseline) or treated with a
  user-specified multiplicative adjustment (e.g. "Black Friday = 250% of normal"). The
  flag list is saved with the forecast plan.
- **Regression model**: simple linear regression on detrended data (OLS with time as the
  independent variable). Optional inclusion of day-of-week dummy variables for basic
  multi-variable regression. This is deliberately simple — a step above trend projection,
  not a full statistical modeling package.
- **Model comparison view**: select 2–3 models, run them all on the same history, and see
  side-by-side Chart.js lines plus a metrics table (MAE, MAPE, RMSE, in-sample fit %).
  Helps the user pick the model that best fits their data characteristics without needing
  to understand the math deeply. The selected model's forecast feeds into the existing
  "Send to Capacity Planning" handoff.

### 9. Scheduling Labor Rules & Constraints (Phase 9)
Makes the scheduling tool production-realistic by adding the labor-rule guardrails that
real WFM teams operate under. Extends the existing shift-pattern allocator — does not
replace it.

- **Labor rule engine**: configurable constraints that the shift allocator must respect as
  hard limits:
  - Maximum daily working hours (e.g. 10h including breaks)
  - Maximum weekly working hours (e.g. 48h, per local labor law)
  - Minimum rest period between shifts (e.g. 11h — prevents clopening)
  - Maximum consecutive working days before a mandatory rest day (e.g. 6)
  - These rules are global defaults with optional per-agent or per-group overrides
- **Agent availability / preference input**: per-agent or per-group scheduling data:
  - Availability windows: "Agent A is available Mon–Fri 06:00–22:00, not weekends"
  - Shift preferences: preferred shifts (weighted higher in allocation), available shifts
    (acceptable), and unavailable shifts (hard block)
  - Input via manual form or CSV upload (agent ID, day, availability start/end, preference)
  - Preferences are soft constraints (optimizer tries to satisfy them); availability is a
    hard constraint (optimizer never assigns a shift outside availability)
- **Part-time shift patterns**: support variable-length shifts (4h, 6h, 8h) each with
  their own break rules (e.g. 4h shift = no meal break, 6h = 15min, 8h = 30min unpaid
  meal). Integrates with the existing part-time mix % from the FTE converter — the
  scheduler now actually assigns part-time shifts, not just accounts for them as a ratio.
- **Constraint-aware shift allocator**: the existing greedy coverage optimizer is extended
  to check labor rules before each assignment. If no feasible allocation exists that
  satisfies all hard constraints, the tool reports the gap clearly ("need 3 more agents
  on Tuesday 14:00–22:00 but no one is available") rather than silently violating a rule.
- **Constraint violation highlighting**: any shift assignment that breaches a rule is
  flagged inline with a severity indicator:
  - ⚠️ Warning: soft preference violated (e.g. agent assigned a non-preferred shift)
  - 🚫 Error: hard rule violated (e.g. less than 11h rest between shifts) — this only
    appears if the user forces an override; the allocator never produces these on its own
- **CSV export**: updated to include constraint compliance status per shift assignment
  (pass / warning / override columns)

### 10a. Monte Carlo / Confidence-Interval Simulation (Phase 10)
Upgrades the Simulator from point-estimate projections to probabilistic range-of-outcomes
modeling. Uses the same `Erlangly.*` math engine — Monte Carlo is a loop over existing
simulation logic with randomized inputs, not a new math system.

- **Variability configuration**: for each what-if lever (volume growth, AHT change,
  shrinkage, attrition rate), the user can specify a ± range (standard deviation as % of
  the base value). These ranges define the distribution from which each iteration samples.
  Default distribution is normal (truncated to avoid negative values); uniform is available
  as an alternative.
- **Iteration engine**: runs N iterations (user-configurable, default 500, max 2000) of
  the full period-by-period simulation. Each iteration draws randomized values for every
  lever from the configured distributions. Performance target: 1000 iterations over 24
  months should complete in under 3 seconds on a modern browser (the per-iteration math
  is just Erlang C lookups, which are fast).
- **Percentile aggregation**: across all iterations, compute P10, P25, P50 (median), P75,
  P90 for each output metric (required agents, staffed agents, service level, occupancy,
  labor cost) per period. Store these as the Monte Carlo result set.
- **Confidence band visualization**: on the existing scenario chart, shade the P10–P90
  range as a translucent band, plot the P50 (median) as a solid line, and highlight the
  worst-case (P90 for staffing need / P10 for service level) breach period with a marker.
  The existing point-estimate scenario lines can be overlaid for comparison.
- **Export**: CSV with one row per period, columns for each percentile (P10/P25/P50/P75/P90)
  of each metric. Plain-language summary includes confidence-interval narrative (e.g.
  "There is a 90% chance you will need between 45 and 62 agents by month 12").
- **Saved plans**: Monte Carlo configuration (variability ranges, iteration count) and
  results (percentile arrays) are stored in the existing `inputs`/`outputs` jsonb fields
  alongside the point-estimate scenario data.

### 10b. Mobile-Optimized Real-Time View (Phase 10)
The real-time / intraday tool is the one most likely to be checked from a phone mid-shift
by an RTA analyst. This feature gives it a dedicated mobile layout.

- **Responsive single-column layout** at ≤ 480px viewport width: inputs stack vertically,
  the interval stepper becomes a swipeable card carousel (previous/next with touch
  gesture support), and the day-to-date scorecard condenses into a compact summary bar.
- **Large-touch controls**: VTO approve/revoke buttons sized ≥ 44×44px for phone use,
  with generous tap targets and visual feedback on press.
- **Swipeable interval cards**: each interval's data (volume, staffing, SLA, adherence,
  VTO status) is displayed as a card that can be swiped left/right to advance through the
  day. The stepper controls (Play/Pause, Jump) remain accessible but secondary to swipe.
- **Condensed scorecard**: the day-to-date performance metrics collapse into a single
  horizontal bar with key numbers (cumulative SLA %, total VTO hours, alert count) and
  expand on tap for the full breakdown.

### 10c. Optional Live Data Feed (Phase 10)
Replaces manual or CSV entry of forecast-vs-actual data in the real-time tool with an
optional automatic polling connection to an external data source.

- **Endpoint configuration**: user provides a URL (JSON or CSV format) and a polling
  interval (30s, 60s, 120s, or manual refresh). The URL and format are stored in
  `localStorage` (not in Supabase — this is a local device setting, not a saved plan).
- **Data format**: the endpoint must return interval-level data matching the real-time
  tool's expected schema: `interval, forecast_volume, actual_volume, forecast_agents,
  actual_agents`. JSON and CSV formats are both supported; the tool auto-detects based
  on Content-Type or file extension.
- **Client-side `fetch()` only**: no WebSocket, no SSE, no custom server. The browser
  polls the user-provided URL using standard `fetch()`. This means the endpoint must
  support CORS, or the user must serve it from the same origin. This is a conscious
  trade-off to stay within the no-custom-backend architecture.
- **Error handling**:
  - Connection failure: show a "Last updated: X minutes ago" badge with amber warning;
    continue displaying last-known-good data; retry on next poll cycle
  - Malformed response: skip the update, show a "Feed error" indicator with the HTTP
    status or parse error, log to console
  - Stale data: if the most recent interval timestamp in the feed is more than 2 polling
    cycles old, show a "Stale feed" warning so the analyst knows data isn't current
- **Fallback**: the manual and CSV entry paths remain fully functional alongside the
  live feed. Switching from feed to manual doesn't lose already-loaded data.

### 11a. Shared / Collaborative Plans (Phase 11)
Extends the Phase 5 persistence layer so users can share saved plans with teammates.
Requires Supabase schema changes and new RLS policies.

- **Invite flow**: from the My Plans dashboard or the Save modal, the plan owner can
  invite another user by email. The invited user sees the plan in their own dashboard
  with a "Shared with me" badge.
- **Permission model**: three roles per plan:
  - **Owner**: full control (edit, share, unshare, delete, rename, version history)
  - **Editor**: can modify inputs/outputs and save new versions; cannot delete or change
    sharing settings
  - **Viewer**: read-only access; can open and view the plan but not modify or save
- **Schema changes** (`sql/schema.sql`):
  - New `plan_collaborators` table: `plan_id uuid, user_id uuid, role text
    ('editor'|'viewer'), invited_by uuid, invited_at timestamptz`
  - RLS policies: a user can read any plan where they appear in `plan_collaborators` OR
    where they are the `user_id` (owner). Write access depends on role. This is the first
    time RLS goes beyond the simple `auth.uid() = user_id` pattern — it needs extra review.
  - The `plans` table itself is unchanged; collaboration is a join-table concern.
- **Plan versioning** (pairs with sharing):
  - New `plan_versions` table: `id uuid, plan_id uuid, version_number integer,
    inputs jsonb, outputs jsonb, created_by uuid, created_at timestamptz`
  - Every save creates a new version row (append-only). The `plans` table always reflects
    the latest version.
  - Version history UI: list of versions with timestamps and author, diff view between
    any two versions (JSON comparison of inputs/outputs), restore a previous version
    (which creates a new version from the restored snapshot, preserving history)
  - RLS on `plan_versions`: mirrors the `plan_collaborators` permissions — if you can see
    the plan, you can see its version history.
- **Conflict handling**: optimistic concurrency via the `updated_at` timestamp. If an
  editor saves and the plan's `updated_at` has changed since they loaded it, the save
  shows a warning: "This plan was updated by [user] at [time]. Save anyway (overwrites)
  or reload their version first?" This is last-write-wins with awareness, not real-time
  collaborative editing.

### 11b. Extended Multi-Skill / Multi-Queue Erlang C (Phase 11)
Extends Phase 7's `blendedWorkload` and `multiSkillPoolingEfficiency` proof-of-concept
into a usable multi-queue modeling system.

- **Overflow routing model**: two or more queues where calls that wait beyond a
  configurable threshold in the primary queue overflow to a secondary queue. Math:
  iterative fixed-point method to compute the overflow traffic (Hayward's approximation
  or equivalent) that feeds the secondary queue's Erlang C calculation. New function:
  `Erlangly.overflowRouting(queues, overflowThresholdSec)` in `js/erlang.js`.
- **Skill-based routing model**: agents are tagged with one or more skills; queues are
  mapped to required skills. The tool computes staffing requirements per skill group,
  accounting for agents who can serve multiple queues (pooling efficiency). New function:
  `Erlangly.skillBasedRouting(queues, agentSkillMatrix)` in `js/erlang.js`. Uses the
  existing `blendedWorkload` logic as a building block for the shared-agent pool portion.
- **Multi-queue UI mode**: capacity planning and simulator pages get a "Multi-Queue"
  toggle that replaces the single-queue input panel with:
  - A queue definition table (queue name, volume, AHT, SLA target, answer threshold)
  - A routing rules panel (overflow threshold, skill mappings)
  - Combined results showing per-queue and total staffing requirements, with a
    "pooling savings" comparison (siloed vs. blended vs. overflow-routed)
- **All math stays in `js/erlang.js`**: the new functions are pure, numerically stable,
  and tested in `test/run-tests.js`. Tool pages call them the same way they call
  `Erlangly.agentsRequired` — no duplicated formulas.

### 12. Forecasting Enhancements II (Phase 12)
Phase 8 gave the forecasting tool a pluggable model architecture and *in-sample* fit
comparison (how well each model explains the history it was trained on). This phase
adds the piece that's still missing: how a forecast performs against what actually
happened afterward, plus a model that explicitly uses prior-year data to project
forward. Both build directly on the Phase 8 model interface (`fit`/`predict`/`getMetrics`)
— no architecture changes needed.

- **Year-over-Year Seasonal Trend Projection (new model)**: for each future period,
  finds the matching calendar period one year prior, computes a YoY growth rate from
  the trailing overlap window, and projects forward as
  `forecast = last_year_same_period × (1 + YoY_growth_rate)`, then applies the existing
  day-of-week seasonal indices for intra-period shape.
  - Requires at least 12 months of history to compute a matched period at all; the tool
    should recommend 24+ months so the YoY growth rate itself isn't a single noisy
    data point.
  - Graceful degradation: if less than 12 months of history is available, the model is
    disabled in the selector with an inline explanation, rather than silently producing
    a bad number.
  - Registers in the Phase 8 model registry like any other model, so it appears
    automatically in the model comparison view.
- **Out-of-sample backtesting (walk-forward validation)**: Phase 8's model comparison
  only reports in-sample fit (MAE/MAPE/RMSE/R² against the training data itself), which
  can make an overfit model look artificially good. Backtesting instead:
  - Holds out the last N periods of history (user-configurable, default = forecast
    horizon length)
  - Trains each candidate model on everything before the holdout, forecasts forward
    across it, and compares the forecast to the actual held-out values
  - Reports the same metric set (MAE, MAPE, RMSE) but computed out-of-sample, alongside
    the existing in-sample numbers, so the comparison table shows both and the
    discrepancy between them is visible at a glance
  - Runs entirely client-side against the same history already loaded — no separate
    upload
- **Forecast Accuracy Tracking Tool**: closes the loop after a forecast plan has been
  in use for a while.
  - User uploads (or manually enters) actual volumes for the periods a saved forecast
    already covered, either against a saved plan or a fresh forecast/actual CSV pairing
  - Computes MAPE, WAPE (volume-weighted, more representative when period sizes vary),
    and bias % (systematic over- or under-forecasting, signed)
  - Accuracy history view: since forecasts are regenerated periodically, this tracks
    accuracy across multiple forecast runs over time (not just one run), so a forecaster
    can see whether accuracy is improving, degrading, or has a recurring seasonal blind
    spot
  - Accuracy results can be saved alongside the originating plan (`tool: "forecasting"`,
    same persistence layer as everything else) so accuracy history survives across
    sessions
- **Ensemble / blended forecast (optional)**: combine 2+ selected models into a single
  forecast via weighted average.
  - Weights are either set manually by the user or derived automatically from each
    model's backtested (out-of-sample) accuracy — better-performing models get more
    weight
  - The blended output is itself selectable as "the" forecast for the "Send to Capacity
    Planning" handoff, same as any single model
- **CSV export**: accuracy metrics and backtest results export alongside the existing
  forecast CSV export, so an analyst can paste accuracy figures into a reporting deck
  without re-deriving them.

### 13. Forecast Holdout Sandbox (Phase 13)
Extends Phase 12's out-of-sample backtesting (`backtestModel`/`runBacktestAll`) from a
single "hold out the last N periods" check into an interactive sandbox where a user can
pick any specific month(s) already inside their uploaded history, watch each algorithm's
forecast for that month plotted against the real actual, and settle on a winning
algorithm before trusting it on a real future month. No new pages — this lives inside
`forecasting.html`/`js/forecasting.js`, as a mode alongside the existing "last N periods"
backtest, sharing the same model registry and accuracy metrics.

- **Backtest mode toggle**: the existing Phase 12 holdout configuration gets two modes:
  - **Last N periods** (existing Phase 12 behavior, unchanged)
  - **Pick specific month(s)** (new): user selects one or more calendar months that
    already exist in their uploaded history as holdout targets, instead of a trailing count
- **Target month selection**: multi-select of any month(s) present in the uploaded
  history (e.g. October 2025 and November 2025 from a Jan–Dec 2025 upload). Not limited
  to one month at a time — picking multiple lets the user check whether an algorithm's
  accuracy holds up consistently across different months, not just one favorable one.
- **Before-only training (no data leakage)**: for each target month, every registered
  model trains **only on data before that month** — never on data from after it, even if
  it exists in the uploaded set. This keeps the simulation honest: it answers "if I only
  knew data up to this point, how would this algorithm have predicted the target month?"
- **Configurable lookback window**: alongside the target month picker, a lookback input
  controls how much history before the target month is used for training — either
  "use everything available before the target month" (default) or a specific number of
  months (e.g. "last 6 months before target"). This lets a user also test how an
  algorithm performs with limited history, not just with the full dataset.
- **Live chart overlay**: as the user switches the selected algorithm, the Chart.js
  view re-renders the forecast line for the target month(s) against the real actual
  line for that same period, using the existing dual-curve chart pattern. Switching
  algorithms updates the overlay immediately — no need to re-run the whole page.
- **Accuracy panel (reused from Phase 12)**: MAPE, WAPE, and signed bias % are computed
  per algorithm per target month using the same metrics engine as the existing Accuracy
  Tracking Tool — no separate calculation logic.
- **Multi-month consistency view**: when more than one target month is selected, an
  additional view shows one algorithm's accuracy across all picked months side by side,
  so the user can judge consistency rather than relying on a single lucky/unlucky month.
- **Carry-over to production forecast**: once the user settles on a winning algorithm in
  the sandbox, an explicit "Use this algorithm for my next forecast" action sets that
  algorithm as the active model in the normal (production) forecast flow for a real
  future/unknown month — no need to manually reselect it.
- **Persistence**: a sandbox session (target months picked, lookback window, algorithm
  results) is savable through the existing persistence layer (`tool: "forecasting"`,
  `js/plans.js`), the same as any other saved forecast — reopenable later via My Plans.
- **CSV export**: sandbox results (per algorithm, per target month: MAPE/WAPE/bias) can
  be exported the same way as the existing Phase 12 backtest/accuracy exports.

