# PROJECT_MAP.md

Orientation doc for any agentic coding tool (Claude Code, Cursor, or otherwise) picking
up this project — including one with zero prior context on this conversation. Read this
first, then follow the pointers below in order.

## Read the docs in this order

1. **`PROJECT_MAP.md`** (this file) — what the project is, how the docs relate, current status
2. **`FEATURES.md`** — what each tool does, in full detail (the spec)
3. **`ROADMAP.md`** — what phase the project is in right now, task-by-task status
4. **`AGENTS.md`** — the rules: tech stack, file layout, math engine, design tokens, security, and the phase-completion workflow
5. **`CHANGELOG.md`** — history of what's been completed so far, phase by phase

If any of these five files is missing, stop and ask before writing code — don't
reconstruct assumptions about scope or architecture from the code alone.

## What Erlangly is, in one paragraph

Erlangly is a static (no build step), browser-only website packaging five workforce
management tools — forecasting, capacity planning, scheduling, real-time/intraday
analysis, and a what-if planning simulator — around one shared Erlang C math engine, with
optional accounts (Supabase) so a user's plans persist across visits. It's designed to be
a working portfolio piece as much as a usable tool.

## Current status

**v1 is complete (Phases 0–7).** All five WFM tools (Forecasting, Capacity Planning,
Scheduling, Real-Time/Intraday, Simulator), accounts & persistence (Supabase), shareable
links, multi-skill pooling proof-of-concept, and portfolio polish are built and signed off.

**v2 Phase 8 (Advanced Forecasting Models), Phase 12 (Forecasting Enhancements II), and
Phase 13 (Forecast Holdout Sandbox) are complete**, built out of the original phase order
per explicit user directive. Phases 9–11 (Scheduling Labor Rules, Enhanced Simulation &
Real-Time, Collaboration & Multi-Skill Routing) remain not started.

**Phases 14–19 are planned but not started**, added by a product-strategy review covering
near-term polish and a v3–v6 direction: Phase 14 (Quick Wins & Polish), Phase 15 (AI
Forecasting & Insights), Phase 16 (Advanced Visualizations & Performance), Phase 17 (Team
Collaboration), Phase 18 (Enterprise Readiness), Phase 19 (Ecosystem & Integrations).
Phase 18 in particular carries open architectural questions (multi-tenancy, SSO, a
possible API backend) that are flagged as stop-and-ask items rather than approved scope —
see `ROADMAP.md`'s "v3–v6 Product Strategy" section for the full picture.

Check `ROADMAP.md` for the authoritative phase status — this paragraph will go stale as
work progresses, `ROADMAP.md` will not.

## How the docs relate to each other

```
FEATURES.md   → the WHAT — one section per tool, full feature detail, "future developments" backlog
ROADMAP.md    → the WHEN — phases in build order, checkboxes, status per phase, live source of truth
AGENTS.md     → the HOW — tech stack rules, file layout, math engine, design tokens,
                 Supabase security, and the workflow for moving through ROADMAP.md phases
CHANGELOG.md  → the HISTORY — one entry per phase completed, written by erlangly-qa on sign-off
PROJECT_MAP.md → the ORIENTATION — this file, ties the above together for a new agent/session
```

Rule of thumb: if you're deciding *whether* to build something, check `FEATURES.md`. If
you're deciding *when/whether it's your turn to build it*, check `ROADMAP.md`. If you're
deciding *how to build it*, check `AGENTS.md`. If you want to know what already
happened, check `CHANGELOG.md`.

## File structure

All v1 files exist. This is the current layout per `AGENTS.md`:

```
/index.html              landing page, live Erlang C hero demo
/forecasting.html         Forecasting tool
/capacity.html            Capacity planning tool
/scheduling.html          Scheduling tool (includes Forecast → FTE converter)
/realtime.html            Real-time / Intraday tool (includes VTO calculator)
/simulator.html           Workforce Planning Simulator
/plans.html               "My Plans" dashboard
/login.html               Sign up / log in
/css/styles.css           shared design tokens + all styling
/js/erlang.js             shared Erlang C math engine — single source of truth
/js/main.js               shared nav/CSV/file-drop helpers
/js/supabaseClient.js     Supabase client init
/js/auth.js               auth helpers
/js/plans.js              save/load/list/delete against the `plans` table
/js/<tool>.js             one per tool page (capacity.js, forecasting.js, etc.)
/js/workers/csv-parser.js large-CSV Web Worker
/sql/schema.sql           Postgres schema + RLS policies
/test/run-tests.js        automated math verification suite (29 tests)
```

v2 phases (8–13) don't add new HTML pages. Phase 11 adds new schema tables
(`plan_collaborators`, `plan_versions`) to `sql/schema.sql`. Phases 8, 9, 10, 12, and 13
extend existing JS files only. Phases 14–19 (v3–v6, planned) will likely add new schema
(Phase 17 workspaces, Phase 18 multi-tenancy) and possibly new pages (Phase 17 dashboards,
Phase 19 PWA shell) — see `ROADMAP.md` for the current thinking on each; nothing in that
range is built yet.

## How data flows between tools

```
Historical volume ──▶ Forecasting ──▶ interval-level forecast volume
                                            │
                                            ▼
                                    Capacity Planning  (Erlang C)
                                            │
                              required agents per interval
                                            │
                                            ▼
                       Scheduling  (Forecast→FTE converter, then shift allocation)
                                            │
                                     scheduled headcount
                                            │
                                            ▼
                         Real-Time / Intraday  (actual vs. plan, VTO calculator)

                    Simulator draws on a saved Forecast/Capacity plan as its
                    baseline and projects the same Erlang C math forward across
                    multiple future periods under different what-if assumptions.

    Every tool can save its inputs/outputs to the `plans` table (Phase 5) and
    reopen them later — persistence sits underneath all five tools, not in the
    linear flow above.
```

Same-session handoff between tools (e.g. Capacity → Scheduling) uses `localStorage`.
Cross-visit persistence (save/reopen later, from any device) uses Supabase. See
`AGENTS.md` for the distinction and the rules around each.

## The eight skills, and when each one acts

**Core build-loop (every phase passes through these):**
- **`erlangly-planner`** — active before any code is written for a phase; re-syncs
  against `ROADMAP.md`/`CHANGELOG.md`/`PROJECT_MAP.md`, maps requirements into a visual
  plan artifact, and gets explicit user confirmation before handoff — a hard gate, not optional
- **`erlangly-developer`** — active while a phase is being built; enforces the rules in `AGENTS.md`
- **`erlangly-wfm-analyst`** — active while a feature is being scoped or reviewed; checks operational realism against `FEATURES.md`
- **`erlangly-qa`** — active at the end of a phase; tests against `FEATURES.md`/`AGENTS.md`, and on a pass, checks off the phase in `ROADMAP.md` and writes the `CHANGELOG.md` entry — this is what allows work to move to the next phase

**Specialists (consulted by the core loop for the phases that need them — see
`AGENTS.md` for the full mapping):**
- **`erlangly-ai-engineer`** — ML forecasting models, anomaly detection, NL insights (Phase 15)
- **`erlangly-ui-ux-designer`** — accessibility, theming, design-system evolution (Phases 14, 16, 17)
- **`erlangly-security-auditor`** — auth, RLS, privacy/compliance review (Phase 18 especially)
- **`erlangly-data-engineer`** — large-dataset performance, caching, pipelines (Phases 16, 19)

The four specialist skills don't exist yet as `.skill` files — they get packaged with
`skill-creator` just before the phase that first needs them (see `AGENTS.md`).

See `AGENTS.md`'s "Autonomous phase workflow" section for the full build → QA → changelog → next-phase loop.
