# CHANGELOG.md

Append-only log of completed work on Erlangly, one entry per phase (or notable fix)
from `ROADMAP.md`. Entries are added by `erlangly-qa` at the moment it signs off on a
phase and checks it off in `ROADMAP.md` — not by the developer, and not before tests
pass. This file is history; it is never edited retroactively except to fix a factual
error in a past entry.

Newest entries at the top. Format loosely follows [Keep a Changelog](https://keepachangelog.com).

## How to add an entry (for `erlangly-qa`)

When a phase passes audit:
1. Add a new entry at the top of the log below, under `## [Phase N] — <name>`, dated the day of sign-off.
2. Summarize what was built, in a few bullets — enough for a new agent to know what exists without re-reading every file.
3. Note anything meaningful found and fixed during QA (not routine — just what a future agent should know about).
4. Note any deviation from `FEATURES.md`/`AGENTS.md` as originally written, and why, if one was approved during the phase.
5. Link the phase status in `ROADMAP.md` is now fully checked before moving to the next phase.

```
## [Phase N] — <phase name> — YYYY-MM-DD
**QA sign-off:** erlangly-qa

### Built
- <what was implemented, in a few bullets>

### Found & fixed during QA
- <anything non-routine that came up>

### Deviations from spec (if any)
- <what changed from FEATURES.md/AGENTS.md and why, or "None">
```

---

## [Unreleased]

Nothing shipped yet. Project is fully specified and sequenced (`FEATURES.md`,
`ROADMAP.md`) but no phase has been built. The first entry in this log will be
**Phase 0 — Foundations**, once `erlangly-qa` signs off on it.
