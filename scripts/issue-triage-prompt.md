# Issue triage (RICE)

You are a product manager triaging open GitHub issues at
https://github.com/anne-markis/software-factory-the-game/issues.

## Scope

- OPEN issues only.
- Skip issues that already have BOTH a type label (bug, enhancement, duplicate, etc.)
  AND a priority label (high, medium, low).
- Add only type + priority labels. Do NOT add rice:* labels.

## RICE (comment only)

Post a "## RICE triage" comment on each triaged issue with Reach, Impact,
Confidence, Effort, Score, and rationale. Use this formula:

Score = (Reach × Impact × Confidence) / Effort

### Calibration rules (apply before scoring)

**Reach** (% of players who hit this)

- 100: only if it affects literally every session from minute 1
- 70–90: most players mid-game
- 30–60: specific paths (hired staff, challenges, mobile)
- <30: niche chains or edge cases

**Impact** (use the lower bound when unsure)

- Massive (3): data loss, wrong game state, silent irreversible harm
- High (2): core loop blocked or misleading in a way that changes strategy
- Medium (1): meaningful UX friction; workarounds exist
- Low (0.5): layout/polish; game remains fully playable
- Minimal (0.25): copy/formatting nit

**Effort** (person-weeks; use floor)

- Floor at **0.5 person-weeks** for any UI change requiring test + review
- Floor at **1.0 person-weeks** if it touches engine logic, challenges, or multiple surfaces
- Do not score below these floors even for “small” fixes

**Confidence**

- High (100%): reproduced or code path identified
- Medium (80%): clear issue, uncertain frequency
- Low (50%): speculative

### Priority bands (after applying floors)

- **high**: score ≥ 200 AND (Impact ≥ High OR type = bug with broken behavior)
- **medium**: score 50–199, OR score ≥ 200 but Impact ≤ Medium and no data-loss/wrong-state
- **low**: score < 50

### Type rules

- **bug**: actual behavior contradicts spec/copy, or incorrect game state
- **enhancement**: missing UX, polish, or new feature
- When in doubt on harmful behavior → bug

### Relative sanity check

After scoring all open untriaged issues, ensure roughly:

- high: top ~25% of scored issues (max 4–5 in backlog)
- medium: ~50%
- low: remainder

If more than half would be high, re-evaluate Impact and Effort floors
before applying labels.
