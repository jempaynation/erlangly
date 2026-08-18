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

**Nothing has been implemented yet.** The project is fully specified (`FEATURES.md`) and
sequenced (`ROADMAP.md`), but no phase has started. Check `ROADMAP.md`'s phase status
lines for the authoritative, up-to-date answer — this paragraph will go stale as work
progresses, `ROADMAP.md` will not.

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

## Planned file structure

Nothing below exists yet — this is the target layout per `AGENTS.md`, shown here so a new
agent can predict where things belong without re-deriving it from `AGENTS.md`'s prose.

```
/index.html              landing page, live Erlang C hero demo
/forecasting.html         Phase 2
/capacity.html            Phase 1
/scheduling.html          Phase 3 (includes Forecast → FTE converter)
/realtime.html            Phase 4 (includes VTO calculator)
/simulator.html           Phase 6
/plans.html               Phase 5 — "My Plans" dashboard
/login.html               Phase 5 — sign up / log in
/css/styles.css           shared design tokens + all styling
/js/erlang.js             shared Erlang C math engine — single source of truth
/js/main.js               shared nav/CSV/file-drop helpers
/js/supabaseClient.js     Phase 5 — Supabase client init
/js/auth.js               Phase 5 — auth helpers
/js/plans.js              Phase 5 — save/load/list/delete against the `plans` table
/js/<tool>.js             one per tool page (capacity.js, forecasting.js, etc.)
/js/workers/csv-parser.js Phase 2 — large-CSV Web Worker
/sql/schema.sql           Phase 5 — Postgres schema + RLS policies
```

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

## The three skills, and when each one acts

- **`erlangly-developer`** — active while a phase is being built; enforces the rules in `AGENTS.md`
- **`erlangly-wfm-analyst`** — active while a feature is being scoped or reviewed; checks operational realism against `FEATURES.md`
- **`erlangly-qa`** — active at the end of a phase; tests against `FEATURES.md`/`AGENTS.md`, and on a pass, checks off the phase in `ROADMAP.md` and writes the `CHANGELOG.md` entry — this is what allows work to move to the next phase

See `AGENTS.md`'s "Autonomous phase workflow" section for the full build → QA → changelog → next-phase loop.
