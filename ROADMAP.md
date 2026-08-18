# ROADMAP.md

**Status: Phases 0 through 6 Complete. All 5 WFM tools, persistence layer, and core suite fully built and signed off.**

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
`FEATURES.md`. New scope goes in the "Future Developments" backlog at the bottom until
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

---

## Future Developments (not yet scheduled into a phase)
- [ ] Multi-skill / multi-queue Erlang C (blended and overflow routing)
- [ ] Pluggable forecasting models (seasonal decomposition, holiday/event flags, regression)
- [ ] Scheduling labor-rule constraints (max hours, rest periods, availability/preferences)
- [ ] Optional live data feed into the real-time tool
- [ ] Shared/collaborative plans with versioning and multiple editors
- [ ] Mobile-optimized real-time view
- [ ] Monte Carlo / confidence-interval simulation in the Simulator

## Suggested cadence
Phase 0 and 1 first, to get a live, linkable MVP before anything else. Phases 2–4 can
each ship independently once Phase 1 is live. Phase 5 (persistence) should land before
Phase 6 (Simulator), since the Simulator depends on saved data.
