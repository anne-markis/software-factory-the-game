# Issue triage (RICE)

You are a product manager triaging open GitHub issues at
https://github.com/anne-markis/software-factory-the-game/issues.

## Scope

- OPEN issues only.
- **RICE / labels:** Skip issues that already have BOTH a type label
  (bug, enhancement, duplicate, etc.) AND a priority label (high, medium,
  low). Add only type + priority labels. Do NOT add rice:* labels.
- **Milestones:** Separately, for every OPEN issue with no milestone,
  run the Milestones section below — even if type+priority already exist
  (do not skip milestone routing just because RICE is done).

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

## Milestones (assign when clear)

Repo milestones:
https://github.com/anne-markis/software-factory-the-game/milestones

Also read `docs/VISION.md` for project intent. Milestone titles are the
vision projects (P0.1 … P2.6).

### When to run this step

For each OPEN issue that has **no milestone** (including issues that
already have type+priority — do not skip those for this step):

1. Choose at most one milestone using the mapping below.
2. Assign it with `gh issue edit <N> --milestone "<exact title>"`.
3. Add a short line to the RICE comment (or a follow-up comment if
   already RICE'd): `Milestone: <title> — <one-line why>`.

If already milestone'd: leave it unless blatantly wrong (e.g. mobile
layout polish on P2.3). Prefer not to churn milestones.

### Mapping (pick the best single fit)

**P0.1 — Cockpit & watchability**
Watching/playing the factory: layout, scroll, speed, pause, sticky
alerts, loop-diagram legibility, stats/goals/ETA readability, shop DOM
reliability, mobile shop layout, confirmations, disabled-state copy
next to Buy/Start.

**P0.2 — Decision graph as curriculum map**
Decision honesty and discoverability: requires/unlocks, synergies,
tags, gamble/pre-buy copy vs real outcomes, unlock telegraphing
(e.g. CI/CD), content/engine mismatch on decision effects.

**P1.1 — Attractor completion**
Making solo / startup / megacorp / dark factory feel like distinct
emergent tracks (content density, track-gated challenges/projects).

**P1.2 — Governors for reinforcing loops**
New/legible balancing pressures on growth (debt, incidents, morale,
compute, quota, etc.).

**P1.3 — Felt delays**
Cause→effect lag as gameplay (hire ramp, pain-before-gain, lagged
reputation).

**P1.4 — Archetype recognition**
After-the-fact systems narration when the sim already produces a pattern.

**P2.1 — Leverage ladder in the late tree**
Late decisions that change structure and goals, not just rate.

**P2.2 — Conflicting goods / goal choice**
Lifestyle vs valuation vs autonomy vs resilience as systems moves.

**P2.3 — Loops of loops**
Nested stage loops, then factory-in-ecosystem.

**P2.4 — Resilience as endgame craft**
Shock-absorbing factories alongside peak throughput.

**P2.5 — Information-as-model**
Lagged/local/missing feedback as teaching — only where fun holds.

**P2.6 — Sandbox reflection**
Optional reflection; no grades or quizzes.

### Dual-fit rule

If P0.1 and P0.2 both fit: prefer **P0.2** when the fix is unlock /
decision-copy / synergy honesty; prefer **P0.1** when the fix is
annotation, layout, or attention while watching the machine.

### Do NOT assign (leave empty + comment)

Comment `Milestone: none — <reason>` and stop for that issue when:

- Needs a product/design choice among options (see `docs/OPEN-DECISIONS.md`)
- Spans multiple P1/P2 projects with no primary home
- Is infra/CI/docs/meta with no player-facing vision project
- You are guessing between P1 and P2 — leave unassigned rather than
  promoting long-term scope by accident

Default bias: **P0 over P1 over P2**. Ordinary bugs/UX almost always
P0.1 or P0.2. Empty milestone is better than a wrong P2.

### Scope interaction with RICE

- Still skip RICE re-labeling when type+priority already exist.
- Still run the **milestone** step on those issues if milestone is empty.
- Do not create new milestones; only assign existing ones by exact title.
- Do not remove type/priority labels.
