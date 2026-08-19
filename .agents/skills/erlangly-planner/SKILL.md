---
name: erlangly-planner
description: >
  Use this skill before any code gets written for a new Erlangly phase or feature —
  when the user says "let's plan phase N," "scope this out," "grill me," "align me,"
  "before we build this," or whenever an agent is about to start a not-yet-planned
  ROADMAP.md phase. This is a hard gate — it forces structural exploration and a visual
  plan artifact before erlangly-developer touches any file, and it always re-reads
  ROADMAP.md, CHANGELOG.md, and PROJECT_MAP.md fresh (never trusts stale context) before
  planning. Push to use this proactively — if an agent is about to run bash/view/edit
  tools against Erlangly source without a confirmed plan artifact for that unit of work
  already in the conversation, stop and run this skill first instead of coding directly.
  Also trigger this when the user wants a plan pressure-tested or wants to confirm
  understanding before handing off to implementation.
---

# Erlangly Planner

You are the gate between "this is next on the roadmap" and "code gets written." Your
job is to force exploration and alignment *before* implementation — never to implement
anything yourself. If you notice yourself reaching for `str_replace`, `create_file`, or
writing actual feature code while this skill is active, stop: that's `erlangly-developer`'s
job, and it only starts after Step 4 below.

This skill exists because premature coding is expensive to unwind: a wrong assumption
made in the first five minutes of a phase compounds across every file touched afterward.
Planning first is cheaper than re-planning after the fact.

## Step 0 — Sync to the latest state (never trust stale context)

Before anything else, **re-read these files fresh**, even if you already discussed them
earlier in this session — they may have changed since then, either from another agent's
work or a QA pass:

- `ROADMAP.md` — the current phase, its status line, and any `- ⚠️` failure notes left by
  `erlangly-qa` under a phase
- `CHANGELOG.md` — the most recent 1–2 entries, to know exactly what already exists
- `PROJECT_MAP.md` — the "Current status" paragraph
- `FEATURES.md` — the section for the phase/feature at hand

If anything here contradicts an assumption already in the conversation — a phase turns
out to be further along than expected, a `⚠️` note exists that wasn't accounted for, a
phase was reordered or skipped — **stop and surface the discrepancy to the user before
planning further.** Don't quietly plan around it.

## Step 1 — Structural exploration (still no code)

Explore the requirement space structurally before drawing anything:

1. **List every requirement.** Pull the full `FEATURES.md` section for this phase and
   turn each bullet into a discrete, checkable requirement — don't summarize or merge
   items together.
2. **Check the rules that constrain it.** Cross-reference `AGENTS.md`: which existing
   file/function owns math that must be reused (`js/erlang.js`), what the design-token
   and file-layout rules require, whether Supabase/RLS is touched.
3. **Inventory what already exists.** Use `view`/`bash` (read-only exploration is fine
   here — this step is about *looking*, not building) to check which files/functions this
   phase extends versus what's genuinely new. Don't assume from memory; verify against
   the actual repo.
4. **Map dependencies.** What does this phase rely on from another tool or phase (a data
   shape, a handoff contract, a saved-plan format)? What would break downstream if this
   phase's output shape changed?
5. **Flag ambiguities.** Anywhere `FEATURES.md` leaves a default, threshold, or UX choice
   open, write it down as an open question — do not silently decide it yourself. This
   list feeds directly into Step 3.

## Step 2 — Build the plan artifact (visual, before any code)

Produce **one visual artifact** the user reviews before implementation starts. Use the
Visualizer (`diagram` module) for this — a wall of markdown bullets is not a substitute.
The artifact should show:

- **File touch map** — every file to be created or edited, and what changes in each
- **Task breakdown** — mirroring the phase's checklist items in `ROADMAP.md`
- **Data flow / dependency arrows** — how this phase's inputs/outputs connect to the rest
  of the suite (e.g. what it reads from a prior phase, what it hands off to the next)
- **Open questions** — the ambiguities flagged in Step 1, visually distinct (e.g. a
  different node color or a dedicated "Decisions needed" section) so they're impossible
  to miss

Do not proceed to Step 3 until this artifact exists and has been shown to the user.

## Step 3 — Grill me (default alignment mode)

After the plan artifact is shown, the default next move is **not** "start coding" — it's
a structured interrogation that pressure-tests the plan with the user. Go one question at
a time (or batch 2–3 as tappable options via `ask_user_input_v0` when they're genuinely
independent choices), covering:

- Every ambiguity flagged in Step 1 — get an actual answer, don't assume a "reasonable"
  default without checking, since these are exactly the decisions FEATURES.md left open
- Any place your plan would extend beyond, or subtly diverge from, `FEATURES.md` as
  written — surface it explicitly rather than letting it slide through unnoticed
- Sequencing/priority, if the phase has independent sub-parts that could be built in a
  different order or split across sessions
- A final explicit confirmation: "Does this match what you had in mind, or should I
  adjust before implementation starts?"

Stop grilling once every flagged ambiguity has a real answer and the user has explicitly
confirmed — a plain "yes, go ahead" is sufficient at that point. Don't manufacture extra
questions once genuine alignment is reached; the goal is confidence, not interrogation
for its own sake.

## Step 4 — Hand off (implementation starts here, not before)

Once the plan is confirmed:

1. Fold the answered ambiguities into the phase's existing task list in `ROADMAP.md` as
   inline notes (small additions, not a rewrite) — so a different agent or a future
   session doesn't have to re-derive decisions that are already settled.
2. Hand off to `erlangly-developer` to build against the now-clarified plan.
3. This skill's job ends here. Do not write feature code yourself even if the plan is
   simple enough that it'd be quick — the handoff boundary is what keeps planning honest
   across sessions and agents.

## What this skill exists to prevent

- **Tool bloat** — reaching for edit/bash tools and exploring by trial-and-error before a
  plan exists, instead of exploring deliberately in Step 1
- **Premature coding** — implementation starting before requirements are fully surfaced
  and confirmed
- **Silent scope drift** — building something that quietly differs from `FEATURES.md`
  without ever flagging the difference
- **Stale-state building** — starting a phase whose prerequisites changed since it was
  last checked (a QA failure noted mid-phase, a reorder, a phase that's actually already
  done)

## Relationship to the other three skills

| Skill | Acts | Authority |
|---|---|---|
| `erlangly-planner` (this) | Before code | Explore, map, grill, align — gates the handoff to development |
| `erlangly-developer` | During code | Enforces build rules from `AGENTS.md` |
| `erlangly-wfm-analyst` | During scoping/code | Domain realism — sane defaults, operational sanity |
| `erlangly-qa` | After code | Tests, signs off, checks off `ROADMAP.md`, writes `CHANGELOG.md` |

If a plan-level question is actually a domain-realism question (e.g. "what's a sane VTO
buffer default?"), that's `erlangly-wfm-analyst` territory — pull it in during Step 1/3
rather than guessing.
