---
name: erlangly-developer
description: Use this skill whenever writing, editing, or reviewing code for the Erlangly WFM toolkit project — any HTML/CSS/JS file under an Erlangly repo, any new tool page (forecasting, capacity, scheduling, real-time, simulator), any Supabase/auth/database work, or any task referencing AGENTS.md, FEATURES.md, or ROADMAP.md. Push to use this skill even if the user just says "add a feature," "fix this bug," or "build the next phase" without naming Erlangly explicitly, as long as the surrounding context (file paths, project docs, prior conversation) makes clear it's this project. This skill enforces the project's no-build-step architecture, its single shared math engine, its design token system, and its Supabase security rules — do not write Erlangly code without consulting it first.
---

# Erlangly Developer

You are acting as the developer on Erlangly, a static WFM (workforce management) toolkit
site. This skill's job is to keep every change consistent with the project's established
architecture, which is documented in full in the repo's `AGENTS.md`. That file is the
source of truth — this skill tells you how to use it, not a replacement for it.

## First step, always

Before writing or editing any file: locate and read `AGENTS.md` in the project root. It
defines the tech stack, file layout, design tokens, the shared math engine rules, and the
Supabase security rules. If `AGENTS.md` isn't present or can't be found, stop and ask the
user for it or for the project root — don't guess at conventions.

Also skim `FEATURES.md` (what each tool should do) and `ROADMAP.md` (what phase you're in
and what's already checked off) before starting work, so you don't build ahead of or
behind the current phase without the user asking for that.

## Non-negotiable rules (summarized from AGENTS.md — read that file for full detail)

- **No build step, no framework.** Plain HTML/CSS/vanilla JS only. Chart.js and
  `@supabase/supabase-js` via CDN `<script>` tags are the only approved external deps.
- **One shared math engine.** All Erlang C / service level / ASA / occupancy / staffing
  math lives in `js/erlang.js` and is called as `Erlangly.*`. Never reimplement or
  approximate this math inline in a tool file, including for derived features like the
  VTO calculator or the Forecast→FTE converter — they call into the shared engine.
- **One design token system.** All colors, fonts, spacing, radii are CSS custom
  properties in `css/styles.css`. Never hardcode a hex value or a font name in a page or
  script. The theme is a deliberate dark "control room" palette — don't lighten it or
  swap the accent color without an explicit request.
- **Supabase security is a hard line, not a style preference.** The anon key is the only
  key that ever ships client-side. The service role key must never appear in the repo.
  Every table holding user data needs Row Level Security before it goes live. If a task
  seems to require the service role key or a custom server, stop and flag it instead of
  proceeding.
- **File layout is fixed.** One JS file per tool page, shared helpers in `js/main.js`,
  Supabase/auth/plan-persistence helpers in their own files (`supabaseClient.js`,
  `auth.js`, `plans.js`). Don't scatter save/load logic across tool files.

## Workflow for a typical task

1. Read `AGENTS.md`, `FEATURES.md`, `ROADMAP.md` (or the relevant sections if they're
   long) to confirm what's being asked fits the current phase and the documented feature.
2. If the task is a new feature not yet in `FEATURES.md`, flag that to the user rather
   than silently inventing scope — features get documented before or alongside being built.
3. Write the code following the file layout and token rules above.
4. Before calling a task done, run it past the edge cases AGENTS.md calls out (empty
   inputs, zero volume, shrinkage ≥ 100%, agents ≤ traffic intensity) and check the page
   at a narrow (375px) viewport.
5. Update the relevant checkbox(es) in `ROADMAP.md` when a task is genuinely complete —
   don't leave the roadmap stale.

## When you're unsure

If a request would violate one of the non-negotiable rules above (e.g. "just add a quick
Node backend for this one thing," "let's use React for the simulator, it'll be easier"),
say so plainly, explain the conflict with AGENTS.md, and offer the AGENTS.md-compliant
alternative before proceeding. Don't silently comply and don't silently refuse — surface
the tradeoff and let the user decide.
