# AGENTS.md

Instructions for any AI coding agent (Claude Code, Cursor, etc.) working on Erlangly.
Read this before writing or editing any file in this repo.

## Getting started on this project

1. Read the docs in this order: **`PROJECT_MAP.md`** (orientation — start here),
   **`FEATURES.md`** (what's being built), **`ROADMAP.md`** (what phase we're in, task
   status), this file, **`AGENTS.md`** (how to build it correctly), then
   **`CHANGELOG.md`** (what's already been completed and signed off).
2. Install the four project skills below — they encode role-specific knowledge
   (developer conventions, WFM domain correctness, QA checklist) that this doc
   summarizes but the skills apply automatically during the relevant work.
3. Check `ROADMAP.md` for the current phase and pick up the next unchecked task. See
   "Autonomous phase workflow" below for how to move through phases without needing to
   ask the user at every step.
4. No build step, no `npm install`, no server to start — open the HTML files directly in
   a browser, or serve the folder with any static file server, to preview changes.

## Skills for this project

Four skills capture the different perspectives this project needs. Install all four —
+ they're complementary, not overlapping: the planner skill decides *what's actually being
+ built and whether everyone agrees on it* before a line of code exists, the developer
+ skill enforces *how* code is written, the WFM analyst skill checks *whether it's
+ operationally realistic*, and the QA skill catches *what's broken* before a task is
+ marked done in `ROADMAP.md`.

| Skill | Role | Use it for |
|---|---|---|
| `erlangly-planner` | Planner (pre-implementation) | Gating a phase before any code is written — re-syncing against `ROADMAP.md`/`CHANGELOG.md`, mapping requirements into a visual plan artifact, and "grilling" the user to confirm ambiguities before handing off |
| `erlangly-developer` | Developer | Writing/editing any code — enforces the no-build-step architecture, the shared `erlang.js` math engine, the design token system, and the Supabase security rules |
| `erlangly-wfm-analyst` | WFM Manager / Analyst | Scoping or reviewing any feature for domain realism — sane defaults (shrinkage, occupancy, service level targets), catching gaps like ignoring seasonality or hire-ramp lag |
| `erlangly-qa` | QA (testing & fixing) | Verifying correctness before a phase is called done — Erlang C sanity/monotonicity checks, edge cases, cross-tool handoff and save/load regressions — and, on a pass, checking off the phase in `ROADMAP.md` and writing the `CHANGELOG.md` entry |

**To install:** each skill ships as a `.skill` file. In Claude.ai or Claude Code, open the
skill file and click **Save skill** (or run the equivalent "add skill" action in your
client) to add it to your profile/project. Once installed, each skill triggers
automatically when its described context comes up — e.g. `erlangly-developer` triggers on
any Erlangly code edit, `erlangly-qa` triggers before a roadmap task is finalized. You
don't need to invoke them by name, but you can (e.g. "use erlangly-qa to check this") if
you want to force a specific pass.

If you're setting these up for the first time and don't have the `.skill` files, they can
be regenerated from this repo's skill definitions using Claude's `skill-creator` skill —
ask it to package `erlangly-developer`, `erlangly-wfm-analyst`, and `erlangly-qa`.

## Autonomous phase workflow

This is how work moves through `ROADMAP.md` from Phase 0 to the final phase without
needing a human to manually approve every single step. Any agentic coding tool working on
Erlangly should follow this loop:

1. **Read `ROADMAP.md`.** Find the first phase that is not fully checked off. That's the
   current phase. If the phases immediately before it aren't fully checked, stop and flag
   it — don't build ahead of an incomplete earlier phase unless the user explicitly says to.
2. **Plan the phase with `erlangly-planner`** before any file is touched. It re-reads
  `ROADMAP.md`/`CHANGELOG.md`/`PROJECT_MAP.md` fresh, explores the phase's requirements
    against `FEATURES.md` and `AGENTS.md`, produces a visual plan artifact (file touch
    map, task breakdown, dependencies, open questions), and grills the user on any
    ambiguity until the plan is explicitly confirmed. Do not proceed to step 3 without
    that confirmation — this is a hard gate, not an optional nicety.
3. **Build the phase** using `erlangly-developer` conventions, against the now-confirmed
    plan and the spec in
   `FEATURES.md`. Consult `erlangly-wfm-analyst` for any judgment call about realistic
   defaults, formulas, or workflow (shrinkage %, occupancy ceilings, seasonality,
   hire-ramp lag, etc.) rather than guessing.
4. **Hand off to `erlangly-qa`** once the phase's tasks appear complete. QA audits against
   `FEATURES.md` (does it do what was specified) and `AGENTS.md` (does it follow
   architecture/security rules), and runs the edge-case and math-correctness checks in
   its own skill file.
5. **On a QA pass:** `erlangly-qa` checks off every task under that phase in
   `ROADMAP.md`, updates the phase's status line to done, and adds an entry to
   `CHANGELOG.md` (format and instructions are in that file). Only after the changelog
   entry is written does work begin on the next phase.
6. **On a QA fail:** the phase stays unchecked. `erlangly-qa` notes the specific failure
   inline in `ROADMAP.md` under the phase (as a `- ⚠️` line). Work loops back to step 2
   for that phase — do not proceed to the next phase with a known failure outstanding.
   (A QA failure means a build problem, not a planning problem — resume at step 3, not
   step 2, unless the failure reveals the plan itself was wrong.)
7. **Repeat** until every phase in `ROADMAP.md` is checked off. At that point the project
   matches the full scope in `FEATURES.md`; anything further comes from the "Future
   Developments" backlog at the bottom of `ROADMAP.md`, promoted into a new phase first.

**When to stop and ask the user instead of continuing autonomously:**
- Requirements in `FEATURES.md` are ambiguous or contradictory for the phase at hand
- `erlangly-planner`'s grill step doesn't reach a clear confirmation after reasonable
  back-and-forth — that means the plan itself is contested, not just a detail, and needs
  the user's direct input rather than a default guess
- A task can't be completed within the rules in `AGENTS.md` without breaking one of them
  (e.g. would require a second backend, would require the Supabase service role key)
- `erlangly-qa` has failed the same phase twice in a row without a clear fix
- The next action would touch real user data, spend real money (e.g. provisioning a live
  Supabase project), or otherwise leave the sandbox/no-build-step, static-file world

## What this project is
Erlangly is a mostly-static, no-build-step website packaging five WFM tools:
forecasting, capacity planning, scheduling, real-time/intraday analysis, and a
what-if planning simulator — plus accounts so a user's plans persist across visits.
It doubles as a portfolio piece, so code quality and readability matter as much as
functionality.

## Tech stack — do not deviate without asking
- Plain HTML, CSS, vanilla JS for every page. No React, no bundler, no npm install,
  no server-rendered templating.
- Chart.js may be pulled from `cdnjs.cloudflare.com` via a `<script>` tag for charts
  (forecasting, real-time, simulator).
- Backend/database: **Supabase** (Postgres + Auth), used client-side only via the
  `@supabase/supabase-js` CDN build — no custom server, no API routes. This is the
  one approved backend dependency; see "Backend & data persistence" below before
  touching anything auth- or database-related.
- Fonts: Google Fonts (`IBM Plex Mono` for display/mono, `Inter` for body) via `<link>` tag.
- Cross-tool handoff within a single session still uses `localStorage` — Supabase is
  for durable, cross-visit persistence, not a replacement for that lightweight handoff.

## File layout (keep this structure)
```
/PROJECT_MAP.md          orientation for any agent picking up this project — read first
/FEATURES.md             feature spec — the WHAT
/ROADMAP.md              phase status, live source of truth — the WHEN
/AGENTS.md               this file — the HOW
/CHANGELOG.md            history, one entry per completed phase — the HISTORY
/index.html             landing page
/forecasting.html
/capacity.html
/scheduling.html
/realtime.html
/simulator.html          workforce planning simulator (Phase 6)
/plans.html              "My Plans" saved-data dashboard (Phase 5)
/login.html              sign up / log in (Phase 5)
/css/styles.css          single shared stylesheet — all tokens live here
/js/erlang.js            core math engine, framework-free, reused by every tool
/js/main.js              shared helpers: nav active-state, CSV parsing, file-drop, CSV export
/js/supabaseClient.js    Supabase client init (URL + anon key), imported by any page that needs auth/DB
/js/auth.js              sign up / log in / log out / session-state helpers
/js/plans.js             save/load/list/delete against the `plans` table
/js/<tool>.js            one JS file per tool page, page-specific logic only
/js/workers/csv-parser.js  Web Worker for large CSV parsing (forecasting only)
/sql/schema.sql          Postgres schema + RLS policies, source of truth for the DB shape
```
Do not create a new CSS file per page. Do not duplicate math from `erlang.js` into a
tool file — import/call it. Do not duplicate save/load logic per tool — route it
through `js/plans.js`.

## Design system rules
- All colors, spacing, radii, fonts are CSS custom properties in `:root` in `styles.css`.
  Never hardcode a hex value in a page or a tool JS file — add or reuse a token.
- Theme: dark "control room" palette (near-black navy surfaces, teal accent `--accent`,
  amber `--warn`, red `--danger`). Do not shift to a light theme or a different accent
  color without explicit request — it's a deliberate choice, not a placeholder.
- Display/numeric UI uses `var(--mono)` (IBM Plex Mono). Body copy uses `var(--sans)` (Inter).
- Every new interactive control must have a visible `:focus-visible` state and respect
  `prefers-reduced-motion` (see existing rules at the top of `styles.css`).

## Math engine rules (`js/erlang.js`)
- This file is the single source of truth for Erlang C, service level, ASA, occupancy,
  and shrinkage math. Every tool that needs staffing math calls into `Erlangly.*` —
  never re-implement the formula locally.
- Keep functions pure (no DOM access, no globals besides the `Erlangly` namespace).
- If you add a new calculation (e.g. multi-skill routing), add it here as a new pure
  function and export it from the returned object at the bottom of the IIFE.
- The VTO calculator (real-time tool) is not a separate math system: "max agents
  offerable as VTO" is just a search over staffed-agent counts using
  `Erlangly.serviceLevel`/`Erlangly.occupancy`, the same way `agentsRequired` searches
  upward. Implement it as a small helper in `js/realtime.js` that calls the shared
  engine, or add it to `erlang.js` if it'd be reused elsewhere — don't hand-roll a
  parallel staffing formula for it.
- Same rule for the Forecast → Required FTE converter (scheduling tool): it calls
  `Erlangly.agentsRequired` per interval and then does simple arithmetic (sum
  staff-hours, divide by standard work week, apply part-time mix and shrinkage) — the
  FTE math itself is not Erlang C and doesn't belong in `erlang.js`; a reasonable home
  is a small `fteFromAgentIntervals()` helper in `js/scheduling.js`.

## Backend & data persistence (Supabase)
Accounts and saved plans are backed by Supabase (Postgres + Auth). Treat the
following as hard rules, not suggestions — this is the one part of the project where
a mistake is a real data-exposure risk, not just a style nit:

- **Only the Supabase anon/public key ever ships to the client.** It belongs in
  `js/supabaseClient.js` and is safe to expose — Supabase is designed for this. The
  **service role key must never appear in any file in this repo**, client-side or
  otherwise. If a task seems to need it, stop and ask.
- **Row Level Security (RLS) must be enabled on every table before it holds real
  data**, with policies restricting each row to `auth.uid() = user_id`. A table with
  data in it and RLS off is a bug, not a "finish later."
- Schema lives in `sql/schema.sql` and is the source of truth — if you change the
  schema, update that file in the same change, don't let the live DB and the repo drift.
- One table, `plans`, covers all five tools' saved data:
  `id uuid, user_id uuid, tool text, name text, inputs jsonb, outputs jsonb,
  created_at timestamptz, updated_at timestamptz`. Don't create a separate table per
  tool — `tool` + `inputs`/`outputs` jsonb keeps this simple and consistent.
- All reads/writes to `plans` go through `js/plans.js` (`savePlan`, `loadPlan`,
  `listPlans`, `deletePlan`) — tool pages call these, they don't talk to the Supabase
  client directly.
- Saving is always an explicit user action (a "Save" button). Never auto-save on every
  keystroke or auto-create an account. Never silently overwrite an existing saved plan
  — save-as-new vs. update-existing should be a clear, distinct choice in the UI.
- Auth failures, expired sessions, and offline/network errors must fail visibly and
  gracefully (e.g. "Couldn't save — check your connection and try again"), never
  silently drop the user's data. If a save fails, keep the data in the form/in memory
  so the user can retry without re-entering everything.

## Adding a new tool page
1. Copy the structure of `capacity.html` (nav → `tool-header` → `tool-body` grid → footer).
2. Left column = input panel(s) (`<div class="panel">`), right column = results.
3. Support both manual entry and CSV upload where the feature list calls for it, using
   `wireFileDrop()` and `parseCSV()` from `main.js`.
4. Add the nav link to **all five** HTML files, not just the new page.
5. Add a `js/<tool>.js` file, loaded after `erlang.js` and `main.js`.

## Large CSV handling (forecasting tool)
Forecasting must accept large interval-level history files (100k+ rows) without
freezing the tab. This changes a couple of the default rules above, on purpose:
- Do NOT parse large files on the main thread with `main.js`'s simple `parseCSV()` —
  that helper is fine for small bulk uploads (capacity/scheduling) but not for
  multi-year interval data. For forecasting, parse inside a Web Worker
  (`js/workers/csv-parser.js`), and read the file in chunks rather than one
  `FileReader.readAsText()` call.
- Aggregate on the way in (e.g. roll 15-min rows to daily) before handing data to the
  chart or the forecast model — never chart or model raw 100k+ rows directly.
- Show parse/aggregate progress; don't leave the UI silent on a multi-second parse.
- Skip and count malformed rows rather than aborting the whole upload.
- This is the one place a small additional dependency (e.g. a lightweight worker-based
  CSV streaming approach) is acceptable if hand-rolled chunking proves messy — ask
  before adding it, and keep it to this one file.

## Cross-tool handoff
Tools pass data to each other via `localStorage` (see `sendToScheduling` in
`js/capacity.js` for the pattern: write JSON to a namespaced key, navigate with a
`?from=` query param, and have the receiving page check for that param and offer to
load the stored data — never auto-overwrite a user's in-progress input).

## What NOT to do
- Don't add a build step, framework, or state-management library.
- Don't add any backend beyond Supabase, or write custom server/API code — the client
  talks to Supabase directly.
- Don't ever commit or reference the Supabase service role key, and don't add a table
  that holds user data without RLS policies already in place.
- Don't require login to use the core calculators — accounts are for saving/reopening
  plans, not a gate on the tools themselves.
- Don't invent new colors/fonts outside the token system.
- Don't ship a tool page without a CSV export option if the feature list specifies one.
- Don't build the Simulator's own math — it must call into `js/erlang.js` per period,
  same as every other tool.

## Before considering a phase "done"
- Test with empty inputs, zero volume, and extreme values (e.g. shrinkage ≥ 100%,
  agents ≤ traffic intensity) — these should degrade gracefully, not throw.
- Check the page at a 375px-wide viewport.
- Cross-check FEATURES.md and ROADMAP.md — check off completed items in ROADMAP.md.
