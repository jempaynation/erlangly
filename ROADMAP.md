# ROADMAP.md

**Status: v1 Complete (Phases 0–7) & v2 Complete (Phases 8–13). All 5 WFM tools, advanced forecasting models, labor rule scheduling, Monte Carlo simulation, mobile real-time & live feed, multi-user collaboration & versioning, multi-queue routing, forecast accuracy tracking, and holdout sandbox fully built and signed off with 322 automated tests passing. Next: Phase 14 (Quick Wins & Polish) and v3–v6 Product Strategy (Phases 15–19).**

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
**Status:** Complete
- [x] Labor rule engine: configurable max daily hours, max weekly hours, minimum rest period between shifts, max consecutive working days
- [x] Agent availability / preference input: per-agent or per-group availability windows (e.g. "available Mon–Fri 06:00–22:00") and shift preferences (preferred vs. available vs. unavailable)
- [x] Part-time shift patterns: support variable-length shifts (4h, 6h, 8h) with break rules that adjust by shift length
- [x] Constraint-aware shift allocator: extend the existing greedy optimizer to respect labor rules as hard constraints, with a fallback warning when no feasible allocation exists
- [x] Constraint violation highlighting: flag any shift assignment that breaches a labor rule, with severity level (warning = soft preference violated, error = hard rule violated)
- [x] Updated CSV export: include constraint compliance status per shift assignment
- [x] `erlangly-qa` sign-off

## Phase 10 — Enhanced Simulation & Real-Time
**Status:** Done (2026-08-21)
- [x] Monte Carlo simulation mode in the Simulator:
  - [x] User configures variability ranges (volume ± σ%, AHT ± σ%, attrition ± σ%) on top of existing what-if levers
  - [x] Run N iterations (configurable, default 500) with randomized inputs drawn from those ranges
  - [x] Compute percentile outcomes: P10, P25, P50 (median), P75, P90 for staffing need, service level, and budget impact per period
  - [x] Must reuse `Erlangly.*` per iteration — loop over existing simulation engine with randomized inputs, not a new math system
- [x] Confidence band visualization: shade P10–P90 range on the scenario chart, plot median line, highlight worst-case breach period
- [x] Export Monte Carlo results: CSV with percentile columns per period, plain-language summary with confidence-interval narrative
- [x] Mobile-optimized real-time view:
  - [x] Responsive single-column layout for `realtime.html` at ≤ 480px viewport
  - [x] Swipeable interval cards (touch-friendly navigation)
  - [x] Large-touch VTO approve/revoke buttons sized for phone use
  - [x] Condensed day-to-date scorecard for small screens
- [x] Optional live data feed connector for the real-time tool:
  - [x] Define a polling endpoint URL (JSON or CSV format) in the tool settings
  - [x] Configurable polling interval (e.g. every 30s, 60s, 120s)
  - [x] Auto-populate forecast-vs-actual interval data from the feed instead of manual/CSV entry
  - [x] Client-side `fetch()` only — no WebSocket server, no custom backend
  - [x] Error handling: connection failure, malformed response, stale-data detection with visual indicators and fallback to last-known-good data
- [x] `erlangly-qa` sign-off

## Phase 11 — Collaboration & Multi-Skill Routing
**Status:** Done (2026-08-21)
- [x] Shared / collaborative plans:
  - [x] Invite other users (by email) to view or edit a saved plan
  - [x] Permission model: owner (full control), editor (can modify), viewer (read-only)
  - [x] Supabase schema update: `plan_collaborators` join table (`plan_id, user_id, role, invited_at`) with RLS policies allowing users to see plans shared with them
- [x] Plan versioning:
  - [x] Automatic version snapshot on each save (append-only `plan_versions` table)
  - [x] Version history list with timestamps and author
  - [x] Diff view between any two versions (inputs/outputs JSON comparison)
  - [x] Restore a previous version (creates a new version from the restored snapshot)
  - [x] Supabase schema update: `plan_versions` table (`id, plan_id, version_number, inputs jsonb, outputs jsonb, created_by, created_at`) with RLS
- [x] Collaborative conflict handling: last-write-wins with a visual indicator when another editor has saved since you loaded (optimistic concurrency via `updated_at` check)
- [x] Multi-skill / multi-queue Erlang C routing:
  - [x] Extend beyond Phase 7's `blendedWorkload` proof-of-concept to model overflow routing (primary queue → overflow queue with configurable threshold, e.g. "overflow after 30s wait")
  - [x] Skill-based routing: agents tagged with skills, queues mapped to required skills, staffing computed per skill group
  - [x] New math functions in `js/erlang.js`: `Erlangly.overflowRouting()` and `Erlangly.skillBasedRouting()` — pure functions, iterative numerical methods for overflow probabilities
  - [x] Multi-queue UI mode: capacity planning and simulator pages get a "multi-queue mode" toggle to define 2+ queues with routing rules and see combined staffing requirements
- [x] `erlangly-qa` sign-off

## Phase 12 — Forecasting Enhancements II
**Status:** Done (2026-08-19)
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
**Status:** Done (2026-08-20)
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

## Phase 14 — Quick Wins & Polish
**Status:** Not started
*Near-term (30–60 day) improvements identified in the product strategy review. These are
small, independent, high-value items that don't require new skills or architecture
changes — good candidates to pick up in any order, ahead of the larger v3–v6 phases below.*
- [ ] Dark/light theme toggle (keep dark as default; extend the existing token system in `css/styles.css` rather than introducing a second stylesheet)
- [ ] Expand inline help & examples: contextual tooltips/examples on inputs across all five tools
- [ ] Confidence intervals on forecast charts (visual band around the forecast line — precursor to the fuller Monte Carlo confidence bands in Phase 10)
- [ ] Improve mobile responsiveness beyond the Phase 7 pass and the Phase 10 real-time-specific mobile view (general pass across remaining tools)
- [ ] Data validation preview before import: show a preview/summary of parsed CSV rows (including malformed-row counts) before committing an upload, across all CSV-upload entry points
- [ ] `erlangly-qa` sign-off

## Phase 15 — AI Forecasting & Insights (v3)
**Status:** Not started — **requires new skill: `erlangly-ai-engineer`** (see `AGENTS.md`)
*First phase of the "v3: AI & Intelligence" track. Extends forecasting beyond the
statistical models in Phases 8/12/13 with ML-based models and natural-language output.
Requires a scoping pass with `erlangly-planner` before build — in particular, whether any
model training happens client-side (in keeping with the no-custom-backend rule) or
requires a new architecture decision needs to be resolved before this phase starts.*
- [ ] ML-based forecasting models (e.g. Prophet-style decomposition, XGBoost, LSTM) as additional entries in the Phase 8 model registry
- [ ] Auto model selection: recommend a model based on detected data patterns (seasonality strength, trend, history length, noise) rather than requiring the user to pick
- [ ] Anomaly detection on historical/actuals data (flag unusual spikes/dips distinct from the existing holiday/event flagging in Phase 8)
- [ ] Natural-language insights generator (e.g. "Volume will peak 18% next Friday due to trend + seasonality") surfaced alongside the forecast chart
- [ ] `erlangly-qa` sign-off
- ⚠️ **Open question (flag for `erlangly-planner`):** ML models like LSTM/XGBoost are not "a small additional dependency" in the way the Phase 2 CSV worker was — confirm with the user whether these run via a lightweight in-browser JS implementation/library, or whether this phase requires revisiting the "no backend beyond Supabase" rule in `AGENTS.md` before any code is written.

## Phase 16 — Advanced Visualizations & Performance (v3)
**Status:** Not started
*Second phase of the "v3: AI & Intelligence" track — pairs the "Advanced Visualizations"
and "Performance & Reliability" items from the product strategy review, since both are
cross-tool platform work rather than a single tool's feature. May involve
`erlangly-ui-ux-designer` (visualizations, accessibility) and `erlangly-data-engineer`
(large-dataset performance, caching).*
- [ ] Interactive dashboards with drill-down (landing page and/or per-tool summary views)
- [ ] Heatmap visualizations (volume, ASA, occupancy) as a Chart.js addition alongside existing line charts
- [ ] Confidence intervals / uncertainty bands on charts beyond forecasting (builds on the Phase 14 forecast-chart version and the Phase 10 Monte Carlo bands)
- [ ] IndexedDB-backed offline support for in-progress work (distinct from Supabase cross-visit persistence — this is a local-only cache)
- [ ] Smarter data caching for large CSVs (reduce redundant re-parsing/re-aggregation on the same file)
- [ ] Client-side performance monitoring (basic metrics: parse time, render time) surfaced for debugging, not sent to any server
- [ ] `erlangly-qa` sign-off

## Phase 17 — Team Collaboration (v4)
**Status:** Not started — **requires new skill: `erlangly-ui-ux-designer`** (see `AGENTS.md`)
*"v4: Collaboration" track. Builds on top of the plan-level sharing/versioning already
scoped in Phase 11 (`plan_collaborators`, `plan_versions`) — Phase 11 must be complete
before this phase starts, since workspaces and roles are a layer above individual-plan
sharing, not a replacement for it.*
- [ ] Team workspaces: a workspace groups multiple users and their shared plans under one namespace (new Supabase table(s), RLS scoped by workspace membership)
- [ ] Role management at the workspace level (admin / analyst / viewer — distinct from Phase 11's per-plan owner/editor/viewer roles)
- [ ] Shared dashboards: a workspace-level view aggregating plans/metrics across members, not just a single shared plan
- [ ] Comments & tags on saved plans (threaded comments, free-text tags for organization/search on the My Plans dashboard)
- [ ] `erlangly-qa` sign-off

## Phase 18 — Enterprise Readiness (v5)
**Status:** Not started — **requires new skill: `erlangly-security-auditor`** (see `AGENTS.md`)
*"v5: Enterprise" track. This phase contains the items most likely to conflict with the
current "Supabase-only, no custom backend" architecture rule in `AGENTS.md` — treat every
item below as requiring an explicit `erlangly-planner` scoping session and direct user
sign-off before any implementation, per the "when to stop and ask" rules in `AGENTS.md`.*
- [ ] API access: a documented, authenticated API surface for external systems to read/write plan data — needs a decision on whether this is exposed via Supabase's own auto-generated REST/RPC layer (staying within the existing architecture) or requires a custom backend (a deviation from `AGENTS.md` that must be approved first)
- [ ] White-label option (custom branding/theming per customer) — likely buildable on the existing CSS token system, lower architectural risk than the other items in this phase
- [ ] SSO (SAML/OAuth) — evaluate against Supabase Auth's supported providers first; a requirement outside what Supabase Auth supports natively would be a stop-and-ask case
- [ ] Multi-tenant support — the biggest architectural question in this entire roadmap: the current schema/RLS model (Phase 5) is single-tenant-per-user, and Phase 11 extends it to per-plan sharing, not organization-level tenancy. This needs a dedicated planning pass, not an incremental extension, before it's broken into tasks
- [ ] `erlangly-qa` sign-off
- ⚠️ **Do not start this phase's build step from an autonomous agent loop.** Every item here is a "stop and ask" case per `AGENTS.md`. `erlangly-planner` should scope this phase and get explicit user confirmation on each architectural question above before any task is broken out.

## Phase 19 — Ecosystem & Integrations (v6)
**Status:** Not started — **requires new skill: `erlangly-data-engineer`** (see `AGENTS.md`)
*"v6: Ecosystem" track, and the final phase in the current product strategy. Depends on
Phase 18's API access item for the integration and BI-export items below — sequence
this after Phase 18, not in parallel.*
- [ ] Third-party integrations (e.g. Zendesk, Salesforce, NICE) — client-side connectors against each platform's public API, in keeping with the no-custom-backend rule, or flagged for architecture review if a given integration requires server-side secrets/webhooks
- [ ] BI export support (e.g. Power BI) — scheduled or on-demand export of plan data in a BI-consumable format
- [ ] Mobile app as a Progressive Web App (PWA) — installable, offline-capable wrapper around the existing responsive site rather than a native app (native mobile stays explicitly out of scope per `FEATURES.md`)
- [ ] Localization / i18n — externalize UI strings, support at least one additional language end-to-end as a proof of concept
- [ ] `erlangly-qa` sign-off

---

## v3–v6 Product Strategy (context for Phases 14–19)

This section captures the product-strategy review that produced Phases 14–19 above, so a
future agent understands *why* these phases exist and how they relate to each other, not
just their task lists.

**Sequencing:** Phase 14 (Quick Wins) has no dependencies and can start anytime, in
parallel with the remaining v2 phases (9–11). Phases 15–16 (v3) are next and only need
the new `erlangly-ai-engineer` skill (Phase 15) plus design/perf specialists (Phase 16).
Phase 17 (v4) depends on Phase 11 being complete. Phase 18 (v5) is the highest-risk phase
architecturally and should not be started without a dedicated planning session. Phase 19
(v6) depends on Phase 18's API work.

**New skills introduced by this strategy** (in addition to the existing four —
`erlangly-planner`, `erlangly-developer`, `erlangly-wfm-analyst`, `erlangly-qa` — see
`AGENTS.md` for full role descriptions):
- `erlangly-data-engineer` — large-dataset performance, caching, data pipelines (Phases 16, 19)
- `erlangly-ui-ux-designer` — accessibility, theming, design-system evolution (Phases 14, 16, 17)
- `erlangly-security-auditor` — auth, RLS, privacy, OWASP review (Phase 18 especially)
- `erlangly-ai-engineer` — ML forecasting models, anomaly detection, NL insights (Phase 15)

These are **specialist skills**, consulted the same way `erlangly-wfm-analyst` is
consulted today for domain judgment calls — they don't replace the four-role build loop
(`planner` → `developer` → `wfm-analyst` (as needed) → `qa`) in `AGENTS.md`; they plug
into it for the phases that need their expertise.

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

**v1 (Phases 0–7) and v2 (Phases 8–13) are 100% complete and signed off.**

All 14 phases across core tools, advanced forecasting algorithms, scheduling labor rules, Monte Carlo simulation, mobile real-time & live feed, collaboration & version diffing, and multi-queue routing are fully functional and covered by 322 automated tests.

For subsequent work (**v3–v6 Product Strategy**):

- **Phase 14** (Quick Wins & Polish) has no dependencies on anything — it can be picked up
  at any point as near-term enhancements (dark/light theme toggle, inline tooltips, validation preview).
- **Phase 15–16** (v3: AI Forecasting & Insights, Advanced Visualizations & Performance)
  are the recommended next major track. Phase 15 needs `erlangly-ai-engineer` and a resolved answer on the client-side-only ML
  question flagged inline in that phase. Phase 16 focuses on interactive drill-down dashboards and performance caching.
- **Phase 17** (v4: Team Collaboration) builds directly on top of Phase 11 (plan-level sharing/versioning) to introduce multi-user workspaces and workspace-level roles.
- **Phase 18** (v5: Enterprise Readiness) is the highest-risk phase in the roadmap (API, SSO, multi-tenancy) and
  should be scoped with its own dedicated planning session per the ⚠️ note on that phase — don't let it get picked up without that step.
- **Phase 19** (v6: Ecosystem & Integrations) follows Phase 18, since several of its items
  depend on the API access work scoped there.

