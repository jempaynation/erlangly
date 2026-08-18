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

## Explicitly out of scope for v1
- Multi-skill / multi-queue routing math (single queue Erlang C only)
- Native mobile app — responsive web only
- Real-time collaborative editing (multiple users on the same plan at once)

## Future developments (post-v1, see ROADMAP.md "Future Developments")
- Multi-skill, multi-queue Erlang C (blended/overflow routing)
- Smarter forecasting: seasonal decomposition, holiday/event flags, or a pluggable model swap (e.g. simple exponential smoothing vs. weighted average vs. a regression model)
- Scheduling constraints: labor rules (max hours, required rest between shifts), agent preferences/availability, part-time patterns
- Real-time data feeds: optional live connection to a contact-center API instead of manual/CSV entry for the real-time tool
- Team/collaborative mode: shared plans, comments, versioning, multiple editors
- Native mobile-optimized "real-time" view, since that tool is the one most likely to be checked from a phone mid-shift
- Monte Carlo / confidence-interval simulation in the Simulator (range of outcomes, not just point estimates)
