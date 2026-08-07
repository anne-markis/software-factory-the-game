# P0.1 — Cockpit & watchability: Product plan

Date: 2026-08-07
Status: Planning complete (ready to cut / refine tickets)
Milestone: [P0.1 — Cockpit & watchability](https://github.com/anne-markis/software-factory-the-game/milestone/1)
Extends: `docs/VISION.md`, `docs/superpowers/specs/2026-07-22-ux-arc.md`

This is the complete P0.1 plan: user stories, functional and nonfunctional
requirements, milestone definition of done, and per-ticket definitions of
done (existing + missing). Implementation specs still land per slice when
work is pulled.

---

## 1. Milestone intent

Players spend most of the session **watching** the delivery loop, not
shopping. P0.1 makes that true in the UI: the machine stays visible,
urgent moments interrupt, goals are legible, and change is perceptible —
without abandoning monospace restraint or the loop diagrams as the
signature systems thesis.

**In one sentence:** by the end of P0.1, a long 2x/5x session is fun to
*watch*, and you do not miss the moments that matter.

---

## 2. Milestone definition of done

P0.1 is **done** when all of the following hold on a fresh build (desktop
~1440×1000 and a ~390px-wide mobile viewport):

1. **Watch > shop.** Both loop diagrams and the primary stats remain
   visible without scrolling away to spend, for a mid-game save with a
   populated shop (cockpit layout shipped).
2. **Urgent choices interrupt.** At 5x, a Decision-needed challenge cannot
   silently expire while the player is scrolled into the shop; the player
   gets a force-pause, sticky banner, or equivalent interrupt until they
   choose or consciously dismiss (per accepted #40 direction).
3. **The primary diagram teaches.** A new player can read from the
   Delivery loop alone that a growing stage is the bottleneck (caption
   and/or binding-stage cue).
4. **Commitments have time.** In-flight projects show a derived time
   estimate at current ship rate (not only points remaining).
5. **The endless loop has a next lean.** The UI surfaces at least one
   forward goal (next reputation milestone and/or next contract tier)
   without opening a buried panel.
6. **Change is visible.** Material stat or rate changes flash (or
   equivalent); hire gambles have a reveal moment beyond a log line.
7. **Shop trust hygiene.** Remove is confirmed; disabled Buy/Start reasons
   are numerically clear (singular/plural and shortfall where known).
8. **All P0.1 issues closed** (or explicitly moved out of the milestone
   with a comment). Automated tests + `npm run build` green; no new
   engine/UI boundary violations.

**Out of scope for P0.1 (do not block the milestone):**
decision-graph honesty (P0.2), attractor content (P1), nested loops
(P2.3), balance retunes unless a cockpit change forces a probe update.

---

## 3. High-level user stories

Stories are player-facing outcomes. Ticket IDs in parentheses are the
planned cut; `NEW` = file when cutting tickets.

| ID | Story | Priority | Ticket(s) |
| --- | --- | --- | --- |
| **US-1** | As a player running at 5x, I notice and can answer Decision-needed challenges before they default, even if I was looking at the shop. | Must | #40 |
| **US-2** | As a player watching the Delivery loop, I can tell which stage is binding (growing vs steady) without reading the Progress panel. | Must | #19 + NEW-A bottleneck cue |
| **US-3** | As a player with work in flight, I can see roughly how many days remain on a project at the current ship rate. | Must | #17 |
| **US-4** | As a player in an endless run, I always know what I’m leaning toward next (reputation milestone and/or contract tier). | Must | NEW-B next-goal |
| **US-5** | As a player mid-game, I can watch the loops and stats while shopping without scrolling the machine off-screen. | Must | NEW-C cockpit layout |
| **US-6** | As a player, I can perceive that a tick changed something important (stats/rates), and that a hire gamble resolved, without hunting the event log. | Should | NEW-D game feel |
| **US-7** | As a player, I do not accidentally remove an owned decision; destructive remove matches Reset’s confirmation bar. | Should | #16 |
| **US-8** | As a player facing a disabled Buy/Start, I know *how much* more budget or *how many* completions I need. | Could | #20 |

**Story → milestone DoD map:** US-1→DoD.2 · US-2→DoD.3 · US-3→DoD.4 ·
US-4→DoD.5 · US-5→DoD.1 · US-6→DoD.6 · US-7/US-8→DoD.7.

---

## 4. Functional requirements

### FR-1 Interrupt for pending choices (US-1)

- **FR-1.1** When a choice-challenge becomes pending, the UI presents a
  persistent, non-log-only affordance until resolved or expired.
- **FR-1.2** At speeds above 1x, pending choices must not be trivially
  missable: auto/soft-pause on appear, and/or timer that does not burn at
  wall-clock 5x the same way as 1x, and/or sticky banner that remains
  while other panels are open.
- **FR-1.3** Player can still complete the choice from the interrupt UI
  without hunting the Events log.
- **FR-1.4** Default-on-expiry remains the fail-safe; it must not be the
  only realistic outcome at 5x for an attentive player.

### FR-2 Loop teaching (US-2)

- **FR-2.1** Delivery loop includes brief interpretive copy (same terse
  voice as Progress panel footer): steady box ≈ balanced flow; growing
  box ≈ bottleneck.
- **FR-2.2** When a pipeline stage is clearly binding for a sustained
  period (e.g. Done inflow ≫ Done→Shipped), the UI cues that stage as
  release-/capacity-bound (annotation on stage or arrow). Exact threshold
  is a design/spec detail; behavior must be testable.
- **FR-2.3** Cue does **not** auto-open the shop or auto-buy; pointing at
  CI/CD unlock copy is P0.2 (#39). P0.1 owns machine-side visibility.

### FR-3 Project time estimate (US-3)

- **FR-3.1** Each in-flight project shows a derived estimate
  (`~N days at current rate` or equivalent) from remaining points and
  current points/day (or ship rate).
- **FR-3.2** Estimate updates as rates change; define clear behavior when
  rate is ~0 (e.g. “—” / “stalled”).
- **FR-3.3** Estimate is informational only; no engine rule change.

### FR-4 Next goal (US-4)

- **FR-4.1** Always-visible (or cockpit-sticky) indicator of the next
  unmet reputation milestone and/or next locked contract tier the player
  is progressing toward.
- **FR-4.2** Indicator updates when the goal is met (advance to following
  goal or “top milestone reached”).
- **FR-4.3** Does not end the game or invent a win screen.

### FR-5 Cockpit layout (US-5)

- **FR-5.1** Stats bar is sticky / persistently visible during normal play
  scroll.
- **FR-5.2** Both loop diagrams remain in view without scrolling them away
  to use shop/projects/owned (pinned region or equivalent).
- **FR-5.3** Shop, projects, and owned are progressive disclosure (tabs or
  equivalent): at most one primary spend panel fully open at a time by
  default.
- **FR-5.4** Pending choices and next-goal remain discoverable when the
  shop tab is active (no burying US-1 / US-4 behind disclosure).
- **FR-5.5** Preserve monospace restraint, loop SVG language, and
  no-reflow stability norms from prior releases where practical.

### FR-6 Game feel (US-6)

- **FR-6.1** Material numeric changes in the stats/cockpit flash (or
  equivalent brief highlight) on change.
- **FR-6.2** Hire (and similarly presented) gambles get a short reveal
  moment in the UI, not only an Events log line.
- **FR-6.3** Motion stays subtle; no decorative noise that fights reading
  the loops.

### FR-7 Shop hygiene (US-7, US-8)

- **FR-7.1** Remove on an owned decision requires confirmation (or
  equivalent explicit acknowledge), consistent with Reset.
- **FR-7.2** Disabled Buy/Start reasons use correct singular/plural.
- **FR-7.3** Where budget shortfall is known, disabled Buy shows needed
  amount (e.g. needs $X more).

### FR-8 Cross-cutting

- **FR-8.1** No game-rule changes required for P0.1 except thresholds
  purely for UI cues (FR-2.2); speed remains presentation-only.
- **FR-8.2** Engine stays DOM-free; UI owns layout, interrupt, and feel.
- **FR-8.3** Works on fresh game / Reset path, not only mid-game saves.

---

## 5. Nonfunctional requirements

| ID | Requirement |
| --- | --- |
| **NFR-1 Performance** | Cockpit chrome and flashes must not drop tick scheduling below the selected speed on the target desktop profile; no per-tick full-page layout thrash. |
| **NFR-2 Reliability** | Shop Buy/Remove clicks must not be lost to unrelated section re-renders (continue memo/patch discipline; P0.1 must not regress click races). |
| **NFR-3 Responsiveness** | Desktop (~1440×1000) meets DoD.1; mobile (~390px) remains playable: no unreachable controls, no per-row horizontal scroll traps for primary actions (building on closed mobile tech-tree work). |
| **NFR-4 Accessibility (pragmatic)** | Interrupt and confirmations are keyboard-clickable / focusable controls, not hover-only; confirm destructive actions. |
| **NFR-5 Testability** | Each Must story has automated coverage and/or a documented manual browser check in the issue DoD; `npm test` and `npm run build` pass. |
| **NFR-6 Aesthetic continuity** | No new visual system: monospace, minimal decoration, no card-heavy hero chrome; hierarchy via layout/dimming/size over new color language. |
| **NFR-7 Persistability** | Layout tab selection and speed remain acceptable to reset on refresh unless an existing persistence pattern already covers them; do not invent save-schema churn for chrome prefs unless needed. |
| **NFR-8 Boundary** | Presentation concerns stay out of `GameState` / content balance configs unless a cue threshold truly belongs in content (prefer UI constants with tests). |

---

## 6. Ticket cut list (existing + missing)

File `NEW-*` as GitHub issues on milestone P0.1 when cutting. Titles below
are suggested; bodies should paste the **Definition of done** block.

### Existing (keep on P0.1)

#### #40 — Decision-needed interrupt at speed  
**Story:** US-1 · **FRs:** FR-1  

**Definition of done:**
- [ ] At 5x, a Decision-needed challenge cannot expire solely because the player was in Alter the loop without a visible interrupt.
- [ ] Accepted approach implemented (auto/soft-pause and/or sticky banner and/or speed-aware timer) and documented in the PR.
- [ ] Player can resolve the choice from the interrupt surface.
- [ ] Tests and/or scripted UI verification; `npm test` + `tsc`/build green.
- [ ] Manual check: hire into challenge pool, 5x, leave shop focused, confirm interrupt before expiry.

#### #19 — Delivery loop explanatory text  
**Story:** US-2 (caption half) · **FRs:** FR-2.1  

**Definition of done:**
- [ ] Delivery loop shows terse caption(s) explaining steady vs growing stages, voice-matched to Progress panel.
- [ ] No Progress-panel regression; render/loop tests updated.
- [ ] Manual: fresh game, Delivery loop readable without opening Progress.

#### #17 — Project time estimate  
**Story:** US-3 · **FRs:** FR-3  

**Definition of done:**
- [ ] In-flight projects show derived ~days (or stalled) from remaining points + current rate.
- [ ] Updates when points/day changes; zero-rate behavior defined and tested.
- [ ] No engine rule change; UI/tests only unless a pure helper is shared.

#### #16 — Confirm remove owned decision  
**Story:** US-7 · **FRs:** FR-7.1  

**Definition of done:**
- [ ] Remove requires confirmation (or explicit acknowledge) before dropping modifiers / forfeiting one-time cost.
- [ ] Cancel leaves state unchanged; Reset confirmation behavior unchanged.
- [ ] Test covers confirm vs cancel path.

#### #20 — Disabled-state reason numerics  
**Story:** US-8 · **FRs:** FR-7.2, FR-7.3  

**Definition of done:**
- [ ] Project completion requirements singular/plural correctly.
- [ ] Disabled Buy shows budget shortfall when known.
- [ ] Render/unit coverage for copy strings.

---

### Missing (file under P0.1)

#### NEW-A — Binding-stage bottleneck cue on the Delivery loop  
**Story:** US-2 · **FRs:** FR-2.2–2.3 · **Depends on:** can ship after or with #19  

**Definition of done:**
- [ ] When a stage is clearly binding for a sustained window, that stage/arrow is visually cued as capacity-bound.
- [ ] Cue is machine-side only (no auto-navigation to CI/CD; that remains #39 / P0.2).
- [ ] Threshold documented in issue/PR; tested with a fixture or probe state (e.g. Done pile, ship rate pinned).
- [ ] Does not fire continuously as noise on a healthy balanced loop.

#### NEW-B — Next-goal indicator  
**Story:** US-4 · **FRs:** FR-4 · **Depends on:** best after NEW-C so it stays visible  

**Definition of done:**
- [ ] Player always sees next reputation milestone and/or next contract tier target without digging.
- [ ] Advances when crossed; top-out state defined.
- [ ] Visible when shop disclosure is open (works with cockpit).
- [ ] Tests for selection of “next” goal from state + content milestones/projects.

#### NEW-C — Cockpit layout (sticky stats, pinned loops, tabbed spend)  
**Story:** US-5 · **FRs:** FR-5 · **Blocks:** full value of US-1/US-4  

**Definition of done:**
- [ ] Mid-game: loops + stats remain in view while using shop/projects/owned without scrolling the machine away (desktop target).
- [ ] Spend surfaces use progressive disclosure (tabs or equivalent); default one primary panel.
- [ ] Pending-choice interrupt and next-goal remain discoverable with shop open.
- [ ] Mobile remains usable (NFR-3); no new click-loss regressions (NFR-2).
- [ ] UX arc increment 2 intent satisfied; screenshot or recording attached to PR optional but preferred.
- [ ] `npm test` + build green.

#### NEW-D — Game feel (number flash + gamble reveal)  
**Story:** US-6 · **FRs:** FR-6 · **Depends on:** nicer after NEW-C; can parallel  

**Definition of done:**
- [ ] Material cockpit/stat number changes show a brief flash/highlight.
- [ ] Hire gamble resolution has a short UI reveal (not log-only).
- [ ] Subtlety bar met (NFR-6); no seizure-grade strobing.
- [ ] Tests or deterministic DOM assertions where practical; manual check documented.

---

## 7. Suggested sequencing

```text
NEW-C cockpit layout          ─┐
#40 interrupt                 ─┼─ early parallel OK; integrate on cockpit
#19 caption → NEW-A bottleneck─┘
#17 project ETA
NEW-B next-goal               (after NEW-C)
NEW-D game feel               (after or with NEW-C)
#16 confirm remove · #20 microcopy   (anytime / last)
```

**Cutting rule:** Must stories (US-1…US-5) block milestone close. Should
(US-6, US-7) should ship inside P0.1 unless explicitly deferred with
milestone comment. Could (US-8) may slip only if P0.1 DoD.7 is waived in
writing on the milestone.

---

## 8. Relationship to other docs

| Doc | Role |
| --- | --- |
| `docs/VISION.md` | Why P0.1 exists (watch the machine) |
| `docs/superpowers/specs/2026-07-22-ux-arc.md` | Ordered UX increments; this plan binds them to DoD |
| `docs/superpowers/specs/2026-07-22-speed-controls-design.md` | Speed already shipped; #40 extends living with speed |
| P0.2 plan (future) | Unlock telegraph (#39), decision honesty — not this milestone |

When a near-term implementation spec conflicts with this plan, update one
deliberately before coding.
