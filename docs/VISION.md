# Software Factory: Medium and Long-Term Vision

Date: 2026-08-06
Status: Living vision (not a roadmap, not a backlog)
Stance: Product vision informed by systems thinking (Meadows)

This document holds direction. It does not define features, schedules, or
acceptance criteria. Implementation specs and content waves live elsewhere;
this is the "why this shape of game" layer those docs should serve.

---

## North star

**Optimize fun while teaching systems thinking, using the software SDLC as
the playground.**

Fun is the engagement loop that keeps the player inside the model long
enough for structure to become felt. Systems thinking is the educational
loop: the player leaves with transferable mental models, not trivia about
software process. The SDLC is not the subject — it is the familiar ground
where stocks, flows, delays, and feedback become visible without a lecture.

The game succeeds when a player says something like: "I sped up coding and
suddenly shipping didn't move — oh, that's a bottleneck," and later
recognizes the same pattern in hiring, healthcare, or climate work.

---

## Where we are (as of this writing)

A working stocks-and-flows delivery loop. Tech debt as a regenerating stock
that drags throughput and scales incidents. Context-switch tax on concurrent
work. Reputation as Success to the Successful (with a real downward spiral).
A decision graph (requires / unlocks, synergies, categories) that already
steers builds — densest on the automation / agent ladder; thinner elsewhere.
Legacy decision tags and challenge tag gates have been retired; eligibility
now uses stocks, human headcount, and live decision ownership. One-shot
archetype narration for Limits to Growth and Shifting the Burden. Endless play
with reputation milestones. Cockpit / watchability UX (P0.1) largely shipped
so the machine stays watchable.

The core thesis is already playable: **structure generates behavior**. The
medium and long term are about deepening that thesis — not bolting on more
shop items for their own sake. The decision tree is where that deepening
mostly happens.

---

## Medium term: make the system feel honest and the lesson stick

**Horizon:** deepen the existing factory until every major play pattern
teaches a distinct systems idea, and until fun no longer fights the model.

### Meta direction

1. **One long arc: scale eras → far future (Paperclips cadence).**
   Settled early ladder: **Studio → Company → Megacorp → …**. Studio is
   short/tutorial (~$10k start; hires *and* early agents belong here —
   do not gate “AI” as its own era). **Company** is where most playtime
   lives. Eras advance by **scale of cost** (grind gates and/or
   breakthrough events), one-way. Megacorp and later intensify satire and
   world-eating stakes; loop honesty stays in stocks, flows, and delays.

2. **Treat the decision graph as the curriculum map (content-owned).**
   Requires / unlocks, synergies, costs, and categories — expressed in JSON
   — are how players navigate the journey. No first-class track/tag
   taxonomy. Medium-term ambition: a cleaner, honest graph first, then
   deeper era steps that change what problems find you. Depth and
   consequence before catalog width; the shop is not a checklist.

3. **Promote delays from afterthought to first-class experience.**
   Meadows: people underestimate delays. Hires that ramp, refactors that
   hurt before they help, debt that bites later, reputation that lags
   shipping — the medium-term game should make *time between cause and
   effect* a felt part of play, not only a balance knob.

4. **Teach by recognition, not by tutorial.**
   Keep archetype moments sparse and after-the-fact. Expand the set of
   patterns the factory can honestly exhibit (escalation, drift to low
   performance, policy resistance, seeking the wrong goal) only when the
   simulation already produces them. Narration names what the player just
   lived; it never substitutes for living it.

5. **Make watching the machine as rewarding as buying from the shop.**
   Fun in this genre is mostly attention to a changing system. Layout,
   speed, goals, and feedback exist so the player can stay in the loop
   diagram — the game's signature systems thesis — without fighting the UI.
   Content growth must not bury the model under the menu.

6. **Couple growth loops to governors.**
   Every reinforcing loop that feels good (ship → money → capacity;
   ship → reputation → bigger contracts; agents → throughput → more agents)
   needs a balancing pressure that is legible in play. Debt, incidents,
   morale, compute cost, quota — whatever stocks arrive — should exist
   because the reinforcing loop would otherwise lie about how systems work.

7. **Preserve emergence over authored campaign modes.**
   The engine stays ignorant of which story the player is in. Owned
   decisions, synergies, stocks, and challenge/project gates in content do
   the steering — not a track enum or tag curriculum. Medium-term ambition
   is richer identity through interaction density and era pacing, not
   cutscenes or mode locks.

### What "done enough" for medium term feels like

A thoughtful player can meander inside a scale era, cross into the next
by grind or breakthrough, hit false summits that felt earned, and
articulate at least a few Meadows-shaped insights in their own words —
without the game having explained systems theory to them. Reading the
decision tree should feel like reading commitments at *this* scale:
early choices visibly open later costs and close others. Fun holds
across a long session because bottlenecks move, recovery is possible but
not free, and the next era’s entry is always expensive or lucky enough
to stay interesting.

---

## Long term: from one factory to systems literacy

**Horizon:** the game becomes a durable sandbox for practicing leverage —
changing structure, goals, and information flows — with the SDLC still as
ground, but the transferable skill as the product.

### Meta direction

1. **Climb Meadows' leverage ladder through play.**
   Early play is parameters (buy more rate). Mid play is feedback and delays
   (debt, reputation, ramp). Long-term play should increasingly reward
   changing *structure* and *goals*: what counts as shipped, who the system
   optimizes for, whether the player is still inside the loop. The dark
   factory endgame — the factory that no longer needs humans, including
   you — is the sharpest version of this idea already in the design DNA.

2. **Let the decision space climb that ladder with the player.**
   Late-tree decisions should increasingly change structure and goals, not
   just add rate: new stocks unlocked by commitment, rules rewritten,
   late-arc end-states reached through the graph rather than a mode
   switch. The tech tree becomes leverage space — where you stand in it
   is what kind of system you have become.

3. **Loops of loops.**
   Nested systems: each SDLC stage as an inner loop; eventually the factory
   inside a market, a talent pool, an ecosystem of vendors and incidents.
   Hierarchy and boundaries become gameplay, not diagram decoration. The
   lesson: optimize a subsystem and watch the larger system punish you —
   or redesign the boundary.

4. **Multiple goals, conflicting goods.**
   Points/day is a clean primary score for v1. Long term, the game should
   make goal choice itself a systems move: lifestyle vs valuation vs
   autonomy vs resilience. Seeking the wrong goal should be a trap the
   player can walk into with eyes open, not a fail state the UI prevents.

5. **Resilience and self-organization as endgame crafts.**
   Beyond "biggest throughput," celebrate factories that absorb shocks,
   reorganize after loss, and keep shipping under constraint. That is both
   truer to software delivery and truer to Meadows: resilience is a property
   of structure, not of peak rate.

6. **The player as information flow.**
   What the UI shows and hides is part of the model. Long-term vision:
   information architecture that sometimes mirrors real orgs (lagged
   metrics, local optima, missing feedback) without becoming frustrating
   chrome. Teaching "missing feedback" by letting the player feel its
   absence — carefully, and only when fun still holds.

7. **Stay a sandbox, resist becoming a course.**
   No win screen that grades systems literacy. No quiz. Optional reflection
   (archetypes, milestones, build-as-diagram) can deepen learning; compulsory
   pedagogy will kill fun and therefore kill the lesson. The long-term
   product is a *place to practice*, shareable and extensible via content,
   not a curriculum product with a certificate.

8. **Content as the living model.**
   The long-term technical posture stays: engine as grammar, content as
   vocabulary. New decisions, stocks (morale, compute, valuation, …), and
   archetypes arrive when they earn a place in the loop grammar — each one
   a new way for structure to generate behavior — not as checklist
   completion of the original design doc. The decision graph remains the
   primary surface for extending the model.

### What "arrived" for long term feels like

Players talk about their factories the way systems thinkers talk about
systems: stocks, delays, goals, boundaries. Early delivery-shop play still
reads as software; late eras feel alien without abandoning the loop grammar.
The SDLC remains the on-ramp, but the takeaway travels. Fun still comes
first; without it, nobody stays long enough to learn.

---

## Guardrails (non-negotiables for both horizons)

- **Structure generates behavior.** Prefer mechanics that exhibit a pattern
  over text that describes one.
- **Second-order effects stay emergent.** Do not model-and-display every
  interaction; let the simulation surprise.
- **Fun is a governor on teaching ambition.** If a systems-honest mechanic
  is unfun, redesign the feel — do not abandon honesty or abandon play.
- **One delivery loop as the home base** until nested loops are earned.
  Complexity is a privilege the UI and the player must be ready for.
- **Client-side sandbox, deterministic engine.** The educational value of
  reproducible runs and content-driven balance probes is part of the
  product's integrity.
- **No first-class parallel tracks or modes.** Scale **eras** are one-way
  progression levels (content JSON); capability mix meanders inside an
  era. The dark-factory / world-eating far future is late *scale*, not a
  peer campaign you pick on day one.
- **The decision graph is the curriculum map — and it lives in JSON.**
  Prefer per-era content bundles and content-defined, one-way era entry
  over story-aware engine code. Grow depth and consequence before
  catalog width; shop sprawl without era pull is not progress.

---

## Relationship to other docs

| Doc | Role |
| --- | --- |
| `docs/VISION.md` (this file) | Medium / long-term *direction* |
| `docs/superpowers/specs/2026-08-11-p02-decision-graph-plan.md` | P0.2: retire tags/tracks, honesty tickets, era sketch |
| `docs/superpowers/specs/*` | Concrete design for a near change |
| `docs/superpowers/plans/*` | Implementation sequencing |
| `docs/OPEN-DECISIONS.md` | Deferred tactical choices |
| `docs/CONTENT-AUTHORING.md` | How to extend the living model |

When a near-term spec conflicts with this vision, update one of them
deliberately — do not let the backlog silently redefine the product.
