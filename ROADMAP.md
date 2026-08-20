# ROADMAP.md

**Status: v1 Complete (Phases 0–7). All 5 WFM tools, persistence, portfolio polish, and core suite fully built and signed off. Phase 8 (Advanced Forecasting Models) complete. Phase 12 (Forecasting Enhancements II) complete out of order. v2 Phases 9–11 and 13 planned and queued for implementation.**

This file is the single source of truth for project progress. Any agentic coding tool
(Claude Code, Cursor, or otherwise) picking up this project must read it before writing
code, and must follow the update rules below rather than editing checkboxes freely.

## How this file gets updated

1. Work proceeds phase by phase, in order, using `erlangly-developer` to build and
   `erlangly-wfm-analyst` to sanity-check domain realism as each feature takes shape.
2. A task or phase is only checked off **after `erlangly-qa` has audited it** against
   `FEATURES.md` (does it do what was specified) and `AGENTS.md` (does it follow the
   architecture/security rules) — not by the developer marking their own work done.
3. When `erlangly-qa` signs off on a phase, it (a) checks off every task under that phase
   in this file, (b) updates the phase's status line, and (c) adds a corresponding entry
   to `CHANGELOG.md` before any work on the next phase begins.
4. If `erlangly-qa` finds a failing check, the phase stays unchecked, the specific
   failure is noted inline under the phase (as a `- ⚠️` line) until fixed, and work loops
   back to the developer — it does not proceed to the next phase.
5. Phases should be completed in order. If the user explicitly asks to skip or reorder,
   note that deviation inline where it happens rather than silently reordering the list.
6. Don't edit `FEATURES.md` scope from this file — if building a phase reveals the
   feature spec needs to change, update `FEATURES.md` itself and note why in
   `CHANGELOG.md`, then continue.

Once every phase below is checked, the project is complete per the current scope in
`FEATURES.md`. New scope goes in the "Post-v2 Backlog" at the bottom until
it's promoted into a numbered phase.

---

## Phase 0 — Foundations
**Status:** Complete
- [x] Design system: dark control-room theme, IBM Plex Mono + Inter, tokens in `css/styles.css`
- [x] Core math engine: `js/erlang.js` (Erlang B/C, service level, ASA, occupancy, agents-required, shrinkage)
- [x] Shared nav/CSV/file-drop helpers: `js/main.js`
- [x] Landing page with live interactive Erlang C hero demo: `index.html`

## Phase 1 — MVP: Capacity Planning end-to-end
**Status:** Complete
- [x] `capacity.html` + `js/capacity.js`: single-interval Erlang C calculator (volume, AHT, interval length, target SL, answer-within threshold, max occupancy, shrinkage)
- [x] Bulk CSV mode: upload a full day/week and get an interval-by-interval staffing plan
- [x] Edge cases handled: 0 volume, overstaffed, shrinkage ≥ 100%, agents ≤ traffic intensity
- [x] Mobile responsiveness pass
- [x] `erlangly-qa` sign-off, then deploy MVP (landing + capacity only) so there's a live link early

## Phase 2 — Forecasting
**Status:** Complete
- [x] `forecasting.html` + `js/forecasting.js`
- [x] Manual history table (add/remove rows) + CSV upload path
- [x] Large-CSV upload path:
  - [x] CSV parsing in a Web Worker (`js/workers/csv-parser.js`)
  - [x] Chunked/streamed file read instead of one `FileReader.readAsText()` call
  - [x] Progress UI while parsing/aggregating
  - [x] Client-side aggregation (interval → daily/weekly) before charting or modeling
  - [x] Malformed-row handling: skip + surface a count, never hard-fail the upload
  - [x] Tested against a synthetic ~200k-row CSV
- [x] Weighted moving average + trend model, adjustable horizon
- [x] Day-of-week / interval seasonality weighting
- [x] Chart.js history-vs-forecast chart, downsampled for large datasets
- [x] "Send to Capacity Planning" handoff
- [x] `erlangly-qa` sign-off

## Phase 3 — Scheduling
**Status:** Complete
- [x] Forecast → Required FTE Converter:
  - [x] Accept interval-level forecast volume (saved Forecast, CSV, or Capacity bulk output)
  - [x] Run each interval through `Erlangly.agentsRequired` (no duplicated Erlang C logic)
  - [x] Sum to staff-hours per period, convert to FTE via configurable standard work week
  - [x] Optional part-time mix input
  - [x] Apply shrinkage (reuse Capacity Planning's handling)
  - [x] Daily breakdown view for week/month forecasts
  - [x] CSV export
- [x] Shift pattern input (start, length, breaks)
- [x] Coverage allocation algorithm against required-agents-per-interval
- [x] Coverage gap chart + CSV export
- [x] "Receive from Capacity Planning" handoff
- [x] `erlangly-qa` sign-off

## Phase 4 — Real-Time / Intraday
**Status:** Complete
- [x] `realtime.html` + `js/realtime.js`
- [x] Forecast-vs-actual input (manual or CSV)
- [x] Interval-by-interval "simulate the day" stepper
- [x] Adherence + breach-alert states
- [x] VTO Calculator:
  - [x] Surplus-interval detection off the existing actual-vs-required staffing data
  - [x] Max-offerable-VTO calc using `Erlangly.serviceLevel`/`occupancy` against a configurable buffer
  - [x] Guardrail inputs: occupancy floor/ceiling, max VTO per interval, optional per-agent cap
  - [x] Inline "approve VTO" control that live-updates projected service level
  - [x] Running daily VTO-hours total + optional cost-saved figure
  - [x] CSV export of the VTO offer list
- [x] `erlangly-qa` sign-off

## Phase 5 — Accounts & Persistence
**Status:** Complete
- [x] Stand up Supabase (Postgres + Auth), client-side only via `@supabase/supabase-js` CDN
- [x] Auth: sign up / log in (email+password or magic link), session handling in `js/auth.js`
- [x] Schema: single `plans` table (`id, user_id, tool, name, inputs jsonb, outputs jsonb, created_at, updated_at`) — see `sql/schema.sql`
- [x] Row Level Security policies restricting each row to its owning user
- [x] "Save" button on all four existing tools
- [x] "My Plans" dashboard page (`plans.html`): list, open, rename, delete
- [x] `localStorage` cross-tool handoff confirmed still working for logged-out/same-session use
- [x] `erlangly-qa` sign-off, including an explicit check that RLS actually blocks cross-user access

## Phase 6 — Workforce Planning Simulator
**Status:** Complete
- [x] `simulator.html` + `js/simulator.js`
- [x] Scenario builder: baseline (saved forecast or manual) + what-if levers (volume growth, AHT change, shrinkage change, attrition rate, hiring ramp, budget ceiling)
- [x] Period-by-period simulation loop reusing `Erlangly.*` — no second math engine
- [x] Attrition/hiring model with a configurable time-to-productivity/nesting delay
- [x] Multi-scenario comparison view (2–3 scenarios on one chart)
- [x] Breach detection: first period a scenario drops below target SL or exceeds budget
- [x] Save/reopen scenarios via the Phase 5 persistence layer (`tool: "simulation"`)
- [x] Export a scenario as CSV and as a plain-language summary
- [x] `erlangly-qa` sign-off

## Phase 7 — Polish & portfolio packaging
**Status:** Complete
- [x] Full responsive/accessibility pass (keyboard focus, reduced-motion, contrast) across every page
- [x] README with screenshots, live link, and a short "how the Erlang C math works" writeup
- [x] Optional: shareable read-only link for a saved plan/scenario
- [x] Optional stretch: multi-skill/multi-queue Erlang C variant
- [x] `erlangly-qa` final full-suite sign-off

## Phase 8 — Advanced Forecasting Models
**Status:** Complete
- [x] Pluggable model architecture: refactor `forecasting.js` to support swappable forecast algorithms behind a common interface (model selector UI, shared input/output contract)
- [x] Seasonal decomposition model: additive and multiplicative decomposition (trend + seasonal + residual)
- [x] Exponential smoothing models: Simple Exponential Smoothing (SES) and Holt's Double Exponential Smoothing (trend-aware)
- [x] Holiday / event flag system: user marks specific dates as holidays or events (manual or CSV upload), forecast model adjusts predictions accordingly (multiplicative scaling or exclusion from training)
- [x] Regression model option: simple linear regression on detrended data as a forecast alternative
- [x] Model comparison view: run 2–3 selected models on the same history, display side-by-side with fit metrics (MAE, MAPE, RMSE) to help user pick the best model for their data
- [x] `erlangly-qa` sign-off

## Phase 9 — Scheduling Labor Rules & Constraints
**Status:** Not started
- [ ] Labor rule engine: configurable max daily hours, max weekly hours, minimum rest period between shifts, max consecutive working days
- [ ] Agent availability / preference input: per-agent or per-group availability windows (e.g. "available Mon–Fri 06:00–22:00") and shift preferences (preferred vs. available vs. unavailable)
- [ ] Part-time shift patterns: support variable-length shifts (4h, 6h, 8h) with break rules that adjust by shift length
- [ ] Constraint-aware shift allocator: extend the existing greedy optimizer to respect labor rules as hard constraints, with a fallback warning when no feasible allocation exists
- [ ] Constraint violation highlighting: flag any shift assignment that breaches a labor rule, with severity level (warning = soft preference violated, error = hard rule violated)
- [ ] Updated CSV export: include constraint compliance status per shift assignment
- [ ] `erlangly-qa` sign-off

## Phase 10 — Enhanced Simulation & Real-Time
**Status:** Not started
- [ ] Monte Carlo simulation mode in the Simulator:
  - [ ] User configures variability ranges (volume ± σ%, AHT ± σ%, attrition ± σ%) on top of existing what-if levers
  - [ ] Run N iterations (configurable, default 500) with randomized inputs drawn from those ranges
  - [ ] Compute percentile outcomes: P10, P25, P50 (median), P75, P90 for staffing need, service level, and budget impact per period
  - [ ] Must reuse `Erlangly.*` per iteration — loop over existing simulation engine with randomized inputs, not a new math system
- [ ] Confidence band visualization: shade P10–P90 range on the scenario chart, plot median line, highlight worst-case breach period
- [ ] Export Monte Carlo results: CSV with percentile columns per period, plain-language summary with confidence-interval narrative
- [ ] Mobile-optimized real-time view:
  - [ ] Responsive single-column layout for `realtime.html` at ≤ 480px viewport
  - [ ] Swipeable interval cards (touch-friendly navigation)
  - [ ] Large-touch VTO approve/revoke buttons sized for phone use
  - [ ] Condensed day-to-date scorecard for small screens
- [ ] Optional live data feed connector for the real-time tool:
  - [ ] Define a polling endpoint URL (JSON or CSV format) in the tool settings
  - [ ] Configurable polling interval (e.g. every 30s, 60s, 120s)
  - [ ] Auto-populate forecast-vs-actual interval data from the feed instead of manual/CSV entry
  - [ ] Client-side `fetch()` only — no WebSocket server, no custom backend
  - [ ] Error handling: connection failure, malformed response, stale-data detection with visual indicators and fallback to last-known-good data
- [ ] `erlangly-qa` sign-off

## Phase 11 — Collaboration & Multi-Skill Routing
**Status:** Not started
- [ ] Shared / collaborative plans:
  - [ ] Invite other users (by email) to view or edit a saved plan
  - [ ] Permission model: owner (full control), editor (can modify), viewer (read-only)
  - [ ] Supabase schema update: `plan_collaborators` join table (`plan_id, user_id, role, invited_at`) with RLS policies allowing users to see plans shared with them
- [ ] Plan versioning:
  - [ ] Automatic version snapshot on each save (append-only `plan_versions` table)
  - [ ] Version history list with timestamps and author
  - [ ] Diff view between any two versions (inputs/outputs JSON comparison)
  - [ ] Restore a previous version (creates a new version from the restored snapshot)
  - [ ] Supabase schema update: `plan_versions` table (`id, plan_id, version_number, inputs jsonb, outputs jsonb, created_by, created_at`) with RLS
- [ ] Collaborative conflict handling: last-write-wins with a visual indicator when another editor has saved since you loaded (optimistic concurrency via `updated_at` check)
- [ ] Multi-skill / multi-queue Erlang C routing:
  - [ ] Extend beyond Phase 7's `blendedWorkload` proof-of-concept to model overflow routing (primary queue → overflow queue with configurable threshold, e.g. "overflow after 30s wait")
  - [ ] Skill-based routing: agents tagged with skills, queues mapped to required skills, staffing computed per skill group
  - [ ] New math functions in `js/erlang.js`: `Erlangly.overflowRouting()` and `Erlangly.skillBasedRouting()` — pure functions, iterative numerical methods for overflow probabilities
  - [ ] Multi-queue UI mode: capacity planning and simulator pages get a "multi-queue mode" toggle to define 2+ queues with routing rules and see combined staffing requirements
- [ ] `erlangly-qa` sign-off

## Phase 12 — Forecasting Enhancements II
**Status:** Done (2026-08-19) — *Note: Implemented first per explicit user directive; Phases 9–11 remain pending.*
- [x] Year-over-Year Seasonal Trend Projection model: registers in the Phase 8 model
      registry; computes YoY growth off the matched calendar period one year prior,
      blended with existing day-of-week seasonal indices
  - [x] Minimum-history guard: disabled in the model selector (with inline explanation)
        when less than 12 months of history is loaded; 24+ months recommended
- [x] Out-of-sample backtesting (walk-forward validation): hold out the last N periods,
      train on the rest, forecast across the holdout, and report MAE/MAPE/RMSE
      out-of-sample alongside the existing in-sample metrics from Phase 8
- [x] Forecast Accuracy Tracking Tool:
  - [x] Upload/enter actuals against a saved forecast plan (or a fresh forecast/actual
        CSV pairing)
  - [x] Compute MAPE, WAPE (volume-weighted), and signed bias %
  - [x] Accuracy history view across multiple forecast runs over time, not just the
        latest run
  - [x] Save accuracy results alongside the originating plan via the existing
        persistence layer
- [x] Ensemble/blended forecast (optional): weighted combination of 2+ models, weights
      manual or auto-derived from backtested accuracy; selectable as the forecast for
      the Capacity Planning handoff
- [x] Updated CSV export: accuracy metrics and backtest results included alongside the
      existing forecast export
- [x] `erlangly-qa` sign-off

## Phase 13 — Forecast Holdout Sandbox
**Status:** Done (2026-08-20) — *Note: Implemented per explicit user directive; Phases 9–11 remain pending.*
- [x] Backtest mode toggle in the existing Phase 12 holdout config: "Last N periods" (existing) vs. "Pick specific month(s)" (new)
- [x] Target month picker: multi-select of any calendar month(s) already present in the uploaded history
- [x] Before-only training: for each target month, every model trains only on data strictly before it (no data leakage from after the target month, even if present in the uploaded set)
- [x] Configurable lookback window: "use everything available before target" (default) or a specific number of months
- [x] Live chart overlay: forecast vs. actual for the target month(s), updates immediately when the user switches algorithms
- [x] Reuse Phase 12's accuracy metrics engine (MAPE, WAPE, signed bias %) per algorithm per target month — no separate calculation logic
- [x] Multi-month consistency view: one algorithm's accuracy shown across all selected target months side by side
- [x] "Use this algorithm for my next forecast" carry-over action: sets the sandbox-winning algorithm as the active model in the production (future-month) forecast flow
- [x] Persistence: sandbox sessions savable/reopenable via the existing `plans.js` layer (`tool: "forecasting"`)
- [x] CSV export of sandbox results (per algorithm, per target month: MAPE/WAPE/bias)
- [x] `erlangly-qa` sign-off

---

## Post-v2 Backlog (not yet scheduled)

All original Future Developments items have been promoted into Phases 8–11 above. New
ideas and stretch goals go here until they're scoped and promoted into a numbered phase.

- [x] **Continuous Forecasting Loop (Forecast Baseline Pinning, Dedicated Actuals CSV Uploader & History Merge)** (Completed 2026-08-19):
  - [x] Forecast Baseline Lock: pin active forecast plan snapshot as official tracking benchmark
  - [x] Dedicated Actuals CSV drag & drop uploader with auto-matching against baseline forecast dates
  - [x] Merge Actuals into History: deduplicate and append verified post-shift actuals into training history and trigger automated re-forecasting
  - [x] Persistence of locked baseline forecast and accuracy runs in saved plans and shared links

## Suggested cadence

**v1 (Phases 0–7) is complete.** For v2:

- **Phase 8** (Advanced Forecasting) can start immediately — it extends an existing tool
  with no schema changes and no new pages.
- **Phase 9** (Scheduling Labor Rules) can start independently of Phase 8, or after it —
  no dependency between them. However, improved forecasts from Phase 8 make scheduling
  more realistic, so the ordering is recommended.
- **Phase 10** (Enhanced Simulation & Real-Time) depends loosely on the existing tools
  being stable. Monte Carlo simulation benefits from any forecasting improvements in
  Phase 8, but doesn't strictly require them. The mobile real-time view and live data
  feed are fully independent.
- **Phase 11** (Collaboration & Multi-Skill Routing) should come last among the original
  four. Shared plans require schema changes and new RLS complexity. Multi-skill routing
  extends the math engine significantly. Both are best tackled after the simpler
  enhancements are stable.
- **Phase 12** (Forecasting Enhancements II) has no dependency on Phases 9–11 — it only
  extends `forecasting.js` against the Phase 8 model interface, no schema changes and no
  new pages. It can be built immediately after Phase 8, in parallel with Phase 9, or
  slotted in whenever forecasting work is next picked up. Ordering here is a preference,
  not a requirement.
- **Phase 13** (Forecast Holdout Sandbox) depends on Phase 12's backtesting engine
  (`backtestModel`/`runBacktestAll`) and metrics, which are already complete — so Phase 13
  can start immediately. No dependency on Phases 9–11. It extends the same holdout config
  UI Phase 12 introduced rather than replacing it, so it should follow Phase 12
  conceptually even though both live in `forecasting.js` with no schema changes.

