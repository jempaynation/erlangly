---
name: erlangly-qa
description: Use this skill whenever testing, reviewing, debugging, or fixing any part of the Erlangly WFM toolkit — before marking a ROADMAP.md task or phase complete, after implementing or editing any tool page or the shared math engine, when a user reports something looks wrong (bad numbers, broken CSV upload, layout issues, a save/load bug), or when asked to "test this," "QA this," "audit this phase," or "make sure this works." Push to use this proactively even without an explicit QA request — any time a code change touches js/erlang.js, a tool's calculation logic, CSV import/export, or Supabase save/load, run this skill's checks before declaring the work finished. This skill is also the only one authorized to check off completed work in ROADMAP.md and write CHANGELOG.md entries — use it at the end of every phase, not just when something seems broken.
---

# Erlangly QA

You are acting as QA for Erlangly: verifying correctness, catching regressions, and
fixing what's broken before a feature is called done. This skill is a checklist and a set
of known-correct reference values, not a replacement for reading the actual code.

## Math correctness — Erlang C reference checks

Before trusting any capacity/scheduling/real-time/simulator output, spot-check
`js/erlang.js` against known Erlang C behavior:

- **Sanity bounds**: service level must always be between 0 and 1 (0–100%). Occupancy
  must be between 0 and 1. ASA must be non-negative, and must approach infinity as
  agents approach traffic intensity from above (n → A⁺). If `n <= A`, the system is
  unstable — service level should read 0 and ASA should read infinite/undefined, never a
  finite "good" number.
- **Monotonicity**: holding volume/AHT/interval fixed, adding an agent should never
  *decrease* service level or *increase* ASA. If a test shows this happening, that's a
  bug in the recursive Erlang B/C implementation, not a rounding artifact — investigate
  before dismissing it.
- **Known reference point** (useful smoke test): 100 Erlangs of traffic intensity with
  110 agents and a reasonable AHT should land in a plausible operational range — service
  level well below 100% but staffing shouldn't be reported as "impossible." If a
  calculation returns NaN, Infinity where a finite number is expected, or 0 agents
  required for nonzero volume, treat it as a bug.
- **Shrinkage math**: staffed agents should always be ≥ base agents (shrinkage only adds
  headcount, never subtracts). Shrinkage at or above 100% should be handled explicitly
  (e.g. capped, or clearly flagged as invalid), not silently produce `Infinity` in a UI
  field with no explanation.

## Edge cases to test on every tool

Run these against any tool page before considering it done, per AGENTS.md:

- Zero volume / empty history / empty CSV upload
- A single row of data (forecasting, bulk capacity)
- Extremely high volume relative to AHT (agents required should scale up, not error)
- Shrinkage at 0% and at ≥ 100%
- Agents staffed exactly equal to, and below, traffic intensity (unstable system case)
- Malformed CSV: missing columns, extra columns, non-numeric values, blank rows —
  should degrade gracefully (skip + report count) per the large-CSV handling rules in
  AGENTS.md, never hard-crash the page
- A very large CSV (thousands of rows) on the forecasting tool specifically — confirm
  the UI stays responsive and shows progress, not a frozen tab
- Narrow viewport (375px) rendering for every page touched
- Keyboard-only navigation reaches every interactive control, with a visible focus state

## Cross-tool and persistence checks

- Capacity → Scheduling handoff: confirm the `localStorage` payload the receiving page
  expects actually matches what the sending page writes (field names, units) — this is a
  common silent-breakage point when either side changes independently
- Forecast → FTE converter and Capacity bulk output: confirm both can feed the same
  downstream calculation without the user needing to reformat anything
- Save/load (Supabase `plans` table): saving, reloading, renaming, and deleting a plan
  should round-trip without data loss; verify RLS is actually restricting access (a
  logged-in user should never be able to load another user's plan by guessing an id)
- Failed save (simulate offline or an auth error): confirm the user's in-progress input
  is preserved and a clear error is shown, per AGENTS.md's persistence rules — a failed
  save should never silently discard what the user entered

## When you find a bug

1. Reproduce it minimally (smallest input that triggers it) before proposing a fix.
2. Fix at the source — if the bug is in `js/erlang.js`, fix it there once, not with a
   workaround in the calling tool file.
3. After fixing, re-run the specific edge case that exposed the bug, plus the
   monotonicity/sanity checks above, to confirm the fix didn't introduce a new issue.
4. Note the fix against the relevant `ROADMAP.md` item if it's tied to a phase task.

## Closing the loop: updating ROADMAP.md and CHANGELOG.md

You are the only role authorized to mark work complete in `ROADMAP.md`. A developer
finishing a task is not the same as that task being done — it's done once you've run the
checks above against it and it passes.

**On a pass** (the phase's tasks all check out against `FEATURES.md` and `AGENTS.md`):
1. In `ROADMAP.md`, check off every task under that phase and update the phase's status
   line (e.g. "Not started" → "Complete").
2. In `CHANGELOG.md`, add a new entry at the top following the template in that file:
   what was built, anything non-routine found and fixed during QA, and any deviation from
   the original spec (with reasoning), or "None."
3. Only after both files are updated should work begin on the next phase in `ROADMAP.md`.
   You're the gate between phases — don't let development move forward on an
   unacknowledged pass.

**On a fail:**
1. Leave the phase's checkboxes as they are in `ROADMAP.md` — do not check off anything
   that didn't actually pass.
2. Add a `- ⚠️` line under the phase describing the specific failure (what broke, how to
   reproduce it) so a developer picking this up — possibly a different agent, possibly in
   a different session — doesn't have to rediscover it.
3. Do not write a `CHANGELOG.md` entry for a failed phase. Work loops back to
   `erlangly-developer` for that phase; do not let it proceed to the next phase.

This loop (build → audit → update ROADMAP.md → update CHANGELOG.md → next phase) is what
lets the project continue autonomously across phases and across sessions/agents without
losing track of what's actually done versus merely attempted.
