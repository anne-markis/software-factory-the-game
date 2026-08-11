# P0.2 — Decision graph as curriculum map: Product plan

Date: 2026-08-11
Status: Direction settled; simplification next steps listed for issue cut
Milestone: [P0.2 — Decision graph as curriculum map](https://github.com/anne-markis/software-factory-the-game/milestone/2)
Extends: `docs/VISION.md` (updated same date), planning conversation 2026-08-11

This plan records the **settled product direction** for journeys / the
decision graph, and the **near-term simplification work** that should
become GitHub issues on P0.2 before we author longer eras. It is not yet
a full user-story / FR cut like P0.1; cut tickets from §4 when ready.

Existing honesty tickets (#39, #32, #47) remain in scope; they sit
alongside simplification rather than replacing it.

---

## 1. Settled direction (planning 2026-08-11)

### Long arc

- **One long game** with Paperclips cadence: long grinds between
  *scale* thresholds, then newly strange choices open. No win screen.
- **Eras = progression of scale (cost of play), not capability tracks.**
  Demarcate by what a factory can afford and what problems that scale
  invites — not by “pre-agent SDLC” vs “automation.” Starting from zero
  today, agents/coding assistants belong in the first era alongside
  hires, git, and (often later) CI/CD.
- **Tone:** early game is a short **Studio** stretch (tutorial-scale;
  starting ~$10k; player can leave relatively fast). Most of the long
  session lives in **Company**. Weirdness, SV satire, and deep futurism
  intensify from **Megacorp** onward — not as day-one flavor, and not
  gated behind “unlocking AI.”
- **False summits** still exist at later scale rungs but sit on the
  **scale ladder**, not on a parallel automation track. Horizon keeps
  moving after each summit.
- **Whimsy** on scenarios and late choices; **systems honesty** stays in
  stocks, flows, delays, and governors.

### Eras vs old “tracks”

- **No first-class tracks or tags** as peer endgames (solo / startup /
  megacorp / darkfactory as mutually exclusive campaigns are retired).
- **Eras replace that vocabulary as a one-way progression ladder** —
  settled working names: **Studio → Company → Megacorp → …** (capability
  mix meanders inside each rung). Words like megacorp mean **how big you
  are**, not which parallel fantasy you picked.
- **Within an era:** meander (hire-heavy, agent-heavy, process-heavy,
  viral/funding luck). **Between eras:** irreversible entry once scale
  criteria (or lucky breakthrough rolls) fire.
- Late / expensive world-eating content is gated by **being able to pay
  for it at that scale**. How you got the money is gameplay.

### Parked for a later pass

- Headcount (`human: true`) vs any leftover “human” labeling — revisit
  when touching hire/challenge content, not in the first simplification
  cut.
- Exact dollar thresholds and breakthrough-roll design (“got funded”,
  “went viral”, …) for Studio→Company and Company→Megacorp — brainstorm
  in §5; ship after simplify + packaging.
- Names for rungs after Megacorp.
- Full late-era sci-fi content authorship — after the graph is simpler
  and content-driven.

---

## 2. Architectural goals

1. **Journey graph lives in JSON.** Requires / unlocks / costs / effects /
   challenge gates / project gates / **era entry** should express
   progression. Prefer content fields + generic engine predicates over
   TypeScript that knows story beats or track names.
2. **Simplify before lengthening.** Remove first-class track/tag machinery
   and docs drift *before* splitting into multi-era content, so longer
   journeys do not grow on a dual human/tag/track vocabulary.
3. **Eras are first-class in content, not in story code.** Each era is its
   own JSON (bundle or folder — see §2.1). The engine may hold
   `state.eraId` (or equivalent) read from content and advance it when
   content-defined entry criteria fire. It must not hardcode era names,
   flavor, or per-era special cases in the tick.
4. **Era transitions are one-way.** Many steps may lead *into* an era;
   once entered, the player cannot return to a prior era’s shop/pool.
   Prior owned effects may still apply (or be retired by content rules) —
   the irreversible part is **which era’s decision/challenge graph is
   live**, not necessarily wiping history.
5. **Authoring visibility:** a light local graph viewer reads the same
   JSON and shows decisions → requires/criteria → era edges. Framework-
   only; stand up with `make graph` (or similar). Not part of the player
   game UI.
6. **Existing content is not sacred.** Cards, tags, and thin branches may
   be deleted or rewritten when they fight the spine.

### 2.1 ADR — Per-era JSON layout (proposed)

**Decision:** one content bundle per era; a small index lists order and
entry criteria.

Proposed shape (names flexible at implementation):

```text
content/
  start.json                 # global constants, seed stocks (era-agnostic)
  eras.json                  # ordered era ids + entry criteria (OR-able paths)
  eras/
    studio/                  # short tutorial-scale era; ~$10k start fits
      meta.json              # id, name, player-facing blurb (optional)
      decisions.json         # hires AND agents/copilot AND process, etc.
      challenges.json
      projects.json
    company/                 # main long-session era
      ...
    megacorp/
      ...
    # later eras TBD (sci-fi / world-eating at cost)
```

**Do not** split eras by capability (e.g. “delivery” vs “automation”).
Agents belong in Studio content when costs fit that scale.

**Entry criteria** live in `eras.json` (or each era’s `meta.json`).
Prefer **OR of paths**, e.g. out of Studio into Company — any of:

- slow grind: budget / reputation / contract floors (exact numbers TBD;
  Studio should be *exitable fast*, so grind bar is modest or skippable
  via breakthrough);
- breakthrough rolls / challenges: “got funded”, “went viral”, etc.
  (exact events TBD — content, not engine special cases).

Company → Megacorp (and later) use the same OR pattern at higher bars —
Company is where most playtime lives, so its exit should feel earned.

Crossing any listed path sets `eraId` forward only.

**Load merge rule (engine):** active content = `start` + **current era’s**
decisions/challenges/projects (plus any explicitly marked “carry”
globals if we need them). Prior-era decision *definitions* need not stay
in the shop; owned instances already on the save remain until removed by
normal rules unless content says otherwise.

**Rejected for now:** single monolithic `decisions.json` with an `era`
field on every card (harder to visualize/author per act); TypeScript
era enums; player-facing “pick your era” modes.

### 2.2 ADR — Graph viewer (proposed)

**Decision:** separate tiny static tool under something like
`tools/content-graph/`, not wired into the game shell.

- Reads era JSON via the same Zod parse path (or a thin shared loader).
- Renders nodes (decisions) and edges (`requires`, synergy `ifOwned`,
  era-entry edges).
- Shows criteria text on nodes/edges (cost, requires, era entry).
- Local only: `make graph` → serve on a localhost port (Vite or
  static). No deploy requirement for v1.
- Framework-light: plain HTML/CSS/JS or minimal Vite page; graph layout
  can start as layered DAG (era columns × require tiers), not a heavy
  editor.

Candidate issue **V-1** below.

---

## 3. Milestone intent (P0.2)

Make the **decision graph honest and content-owned**, strip track/tag
first-class concepts, and leave a clean surface for later era content —
without yet shipping the full sci-fi ladder.

**In one sentence:** by the end of P0.2, progression is “what you bought
and can afford *at this scale*,” expressed in JSON eras — with no track
taxonomy — and the graph does not lie about synergies, gambles, or the
release unlock path.

---

## 4. Next steps → candidate P0.2 issues

Cut these as GitHub issues when ready (titles are suggestions). Order is
**simplify first**, then honesty polish already filed, then light prep
for eras (docs/content shape only — not full sci-fi content).

### Must — simplify the journey surface

| ID | Candidate issue | Why |
| --- | --- | --- |
| **S-1** | Remove decision `tags` and challenge `hasTag` as first-class curriculum/track API | Settled: no tags/tracks. Today only `darkfactory` / `human` gates use `hasTag`; replace those gates with content predicates that do not invent a track layer (e.g. `requiresAnyDecision`, `minOwnedMatching`, or explicit decision-id / category gates — pick the smallest generic JSON shape). |
| **S-2** | Retire track vocabulary from docs and authoring guide | VISION updated; still need `CONTENT-AUTHORING.md`, design doc § tracks, triage prompt P1.1 mapping, and any “solo/startup/megacorp” authoring language aligned or marked historical. |
| **S-3** | Audit engine/UI for track/tag leakage and delete dead path | Orphan tag readers, UI “You are a solo dev” if it implies a track, tests that pin `hasTag: "darkfactory"` as a track concept, unused `process`/`solo` tag data once S-1 lands. Goal: smaller surface, journey edges only in content. |
| **S-4** | Replace darkfactory/human challenge gates with JSON-owned predicates | Companion to S-1: ship equivalent (or intentionally simpler) challenge eligibility without tags so automation-heavy and hire-heavy pools still differ because of **owned decisions / headcount / stocks**, not track labels. |

### Should — graph honesty (already filed)

| Issue | Role under new direction |
| --- | --- |
| **#39** | Unlock telegraph: Done bottleneck → test-suite / CI/CD path. Curriculum signpost without tracks. |
| **#32** | Agent harness synergy honesty. Trust on the automation ladder. |
| **#47** | Hire gamble downside telegraph. Early shop stays “boring but honest.” |

### Could — era packaging + authoring tools (after simplify)

| ID | Candidate issue | Why |
| --- | --- | --- |
| **E-1** | Split content into per-era JSON + `eras.json` with one-way **scale** entry criteria | Implements §2.1. First cut: put *all current* cards in `studio`; stub `company` + entry (modest grind and/or breakthrough placeholder) so loader/viewer are real. **Not** a delivery/automation split. Studio must stay short/exitable. |
| **E-2** | Inventory which current decisions fit Studio costs vs belong in Company+ | Retune or move cards whose prices break the ~$10k Studio fantasy; agents/copilot stay eligible in Studio if costs fit. Most depth lands in Company. |
| **V-1** | Local content-graph viewer (`make graph`) | Implements §2.2. Reads era JSON; shows requires / costs / era-entry edges (including OR entry paths). Authoring aid only. |

### Explicitly out of scope for P0.2 issue cut

- Full late-scale / sci-fi decision/challenge wave
- Final names and $ thresholds for eras after the first gate (brainstorm OK)
- Player-optional / “factory without you” structure changes (long-term)
- Headcount flag redesign (parked)
- Reopening P0.1 cockpit work
- Shipping the graph viewer inside the player-facing game UI
- Capability-based era splits (delivery vs automation) — rejected

---

## 5. Eras brainstorm (scale ladder)

**Settled ladder (simple):**

**Studio → Company → Megacorp → …**

| Era | Role in the long session |
| --- | --- |
| **Studio** | Tutorial-scale. ~$10k start fits. Player can leave **fast**. Teaches the delivery loop; hires *and* early agents/copilot OK. |
| **Company** | **Where most time is spent.** Depth, meander, governors, contract climb, breakthrough-or-grind toward Megacorp. |
| **Megacorp** | Institutional scale; satire / heavier systems; gate into later weirdness. |
| **…** | Later rungs TBD (false summit, sci-fi, world-eating at cost). |

**Principle:** eras mark **how big the business is**. They do **not** mark
“you unlocked AI.” Capability mix meanders *inside* each era. Old
“tracks” were parallel plays; these are progression levels.

```mermaid
flowchart LR
  subgraph ST["Studio — short / tutorial"]
    mix[Hires · agents/copilot · process · small contracts]
  end

  subgraph CO["Company — most playtime"]
    main[Depth · scale burn · real stakes]
  end

  subgraph MC["Megacorp"]
    mega[Institutional scale]
  end

  subgraph LATE["Later — TBD"]
    alien[Deep futurism · world-eating]
  end

  ST -->|"OR: modest grind · got funded · went viral · … fast exit OK"| CO
  CO -->|"OR: earned grind · breakthrough · …"| MC
  MC -->|one-way| LATE
```

### Entry paths (open detail, schema shape settled)

- **Studio → Company:** keep the bar low or luck-skippable so Studio
  stays a tutorial, not a second main game. Working ideas: modest budget/
  reputation floor **or** “got funded” / “went viral” / similar.
- **Company → Megacorp:** higher bar; most session length happens before
  this gate. Exact $ / reputation / events TBD (earlier ~$5M sketch may
  fit *here* better than out of Studio).
- Schema: **multiple OR entry predicates** per era so grind and luck both
  work without engine forks.

### Naming

Studio / Company / Megacorp are **settled** for the first three rungs.
Later names stay open. Prefer size language; keep “got funded” /
“went viral” as **events**, not rung labels.

---

## 5.1 Studio zoom (inventory of *today’s* content)

Eras are not split in JSON yet. This section sorts **shipped** decisions,
gates, challenges, and projects into a **provisional Studio cut** vs
“push to Company+,” for brainstorming only — not sacred, not tickets.

Baseline: start budget **$10k**, base burn **$20/day**, first contract
1500 pts @ $17/pt + $2k bonus.

### Decision graph (requires + synergies)

```mermaid
flowchart TB
  subgraph open["No requires — buy anytime"]
    tooling[better-tooling $150]
    copilot[copilot $20+$2/d]
    agent[agent $10+$4/d]
    basic[basic-dev $7/d GAMBLE]
    contractor[contractor $12/d]
    standup[standup $3/d]
    test[test-suite $500]
    retainer[support-retainer +$8/d]
    ddos[ddos-protection $200+$2/d]
    refactor[refactoring-sprint $400]
    rebuild[redesign-rebuild $1200]
  end

  subgraph gated["Requires gates"]
    harness[agent-harness $250+$5/d]
    swarm[agent-swarm $100+$20/d]
    orch[swarm-orchestrator $150+$8/d]
    sla[self-learning-agents $350+$10/d]
    senior[senior-dev $12/d GAMBLE]
    mgr[eng-manager $8/d]
    cicd[ci-cd $750]
  end

  agent --> harness
  harness --> swarm
  harness --> orch
  swarm --> sla
  basic --> senior
  basic --> mgr
  test --> cicd
  mgr -.->|synergy: tighter gamble| basic
  mgr -.->|synergy: tighter gamble| senior
  harness -.->|synergy: less debt on buy| agent
  orch -.->|synergy: less debt on buy| swarm
```

### Provisional Studio vs Company+ (cost / tutorial lens)

| id | Cost | Gates | Studio lean |
| --- | --- | --- | --- |
| **better-tooling** | $150 once | — | **In** — cheap, teaches rate bump |
| **copilot** | $20+$2/d | — | **In** — modern “assistant before CI” |
| **agent** | $10+$4/d | — | **In** — early agent; debt catch |
| **basic-dev** | $7/d gamble | — | **In** — core hire lesson |
| **contractor** | $12/d | — | **Maybe** — safe hire; overlaps senior burn |
| **standup** | $3/d | — | **In** if any hire/agent team exists |
| **test-suite** | $500 | — | **In** — debt + unlocks CI |
| **ci-cd** | $750 | requires test-suite | **In** — main structural teach (#39) |
| **support-retainer** | +$8/d, −5% rates | — | **In** — income vs slowdown |
| **ddos-protection** | $200+$2/d | — | **In** — pairs with ddos challenge |
| **refactoring-sprint** | $400 | — | **Maybe** — debt recovery; OK if debt appears in Studio |
| **agent-harness** | $250+$5/d | requires agent | **Maybe / light** — second step on agent path; honesty bug #32 |
| **eng-manager** | $8/d | requires basic-dev | **Push?** — management layer feels Company |
| **senior-dev** | $12/d | requires basic-dev | **Push?** — or keep one senior as Studio stretch |
| **redesign-rebuild** | $1200 + long slowdown | — | **Push** — heavy for tutorial |
| **agent-swarm** | $100+$20/d | harness | **Push** — burn alone rivals Studio runway |
| **swarm-orchestrator** | $150+$8/d | harness | **Push** with swarm |
| **self-learning-agents** | $350+$10/d | swarm | **Push** — false-summit / Company+ |

Soft teaching gates (not `requires`, but the loop teaches them): hire
without CI → Done piles up; agent without harness → debt; zero humans →
laptop-dies.

### Challenges — what fires in a Studio-shaped run

| Challenge | Gate today | Studio lean |
| --- | --- | --- |
| scope-creep | minDay 15 | **In** |
| prod-incident | minDay 15, debt scales | **In** (light) |
| ddos | minDay 15, lacks ddos-protection | **In** |
| open-source-windfall | minDay 15 | **In** (lucky money) |
| sickness | minHumanDevs ≥ 1 | **In** if hires |
| key-dev-poached | minHumanDevs ≥ 1 | **Maybe** — choice teach; $150 match |
| laptop-dies | maxHumanDevs 0 | **In** for solo/agent-only |
| meeting-creep | hasTag human | **Push?** — Company calendar pain |
| team-conflict | hasTag human | **Maybe** |
| model-deprecation / api-price-hike / runaway-agent-loop / cloud-credits | hasTag darkfactory | **In-light** if Studio keeps agent; or delay until harness/Company |
| security-breach | techDebt ≥ 800 | **Push** — needs real debt pile |

### Projects / reputation (today)

| Project | Gate | Studio lean |
| --- | --- | --- |
| first-contract (start) | — | **In** — the tutorial ship |
| small-crm | afford $2k upfront | **In** or early Company |
| mobile-app / big-migration | 1 completion + rep 5 | **Company** (Trusted vendor) |
| enterprise-replatform | 2 completions + rep 15 | **Company+ / Megacorp-adjacent** |

Reputation milestones “Trusted” (5) / “Established” (15) currently sit
on the same endless ladder — likely **Company** landmarks, not Studio
exits.

### Studio → Company exit (still open)

Not implemented. Working intent: **fast exit**, OR of modest grind and
breakthroughs (funded / viral / …). Do **not** require finishing the
agent swarm ladder or enterprise contracts to leave Studio.

### Open questions for this zoom

1. How small is Studio’s shop — **core 8–10 cards** or most of today’s
   catalog with only swarm/rebuild deferred?
2. Is **CI/CD** a Studio must-teach, or can some players exit Studio
   still Done-bound and learn it in Company?
3. Should **agent-harness** be the Studio agent ceiling (one upgrade
   deep), with swarm+ reserved for Company?
4. Breakthrough exits: which events are Studio-valid without breaking
   the “short tutorial” feel?

---

## 5.2 Studio from scratch (solo-dev-today)

**Status:** redesign brainstorm. Shipped Studio-shaped content above is
**reference only** — not a keep-list. Start from “I am a solo developer
starting today” and rebuild plays + money.

### Critiques of the shipped tree (accepted as design pressure)

1. **Copilot vs agent** — mechanically both are “pay upkeep → multiply
   finish, add debt.” Copilot: ×1.15 finish, ×1.05 debt, $2/d, unique.
   Agent: ×1.20 finish, ×1.20 debt, $4/d, opens harness ladder. The
   lived difference is thin; the ladder is the only real distinction.
   Not good enough for Studio.
2. **Money options** — `support-retainer` (+$8/d, −5% rates) is a weak
   / implausible primary for a solo. Missing subscription product,
   donations/sponsors, ads, marketplace, etc.
3. **Standup costs money** — $3/d for a ritual that is mostly time, not
   cash. Smells wrong for Studio (and often for Company).
4. **Hiring out of the box** — another full-time dev at $7–12/d on a
   $10k / $20 base-burn runway is a late Studio or Company move, not an
   immediate play. First shop should not center on headcount.

### First-principles prompt (keep asking)

If I were a solo starting today:

- What do I buy/set up in week 1?
- How do I expect to make money before I can hire?
- What breaks (laptop, burnout, scope, deps, cloud bill)?
- When does “second human” or “serious agent fleet” become rational?

### Draft Studio plays (sketch — not cards yet)

**Immediate (day-zero / first weeks)**

| Play | Why it’s real | Systems hook (possible) |
| --- | --- | --- |
| Ship the first thing | You’re already on a contract / building an MVP | Existing delivery loop + first-contract |
| Editor / tooling | Real first spend | Small permanent rate bump |
| Coding assistant (one clear AI seat) | Almost everyone tries one early | **One** AI-assist decision — merge/replace copilot+agent ambiguity |
| Git / basic hosting | Table stakes | Maybe free/flavor, or tiny cost + unlocks deploy path |
| Domain / landing page | Needed to sell anything | Tiny cost; unlocks some income paths |
| Time / focus (not standup-as-$/d) | Solo cost is attention | Maybe temporary rate tradeoffs, not payroll |

**Early money (before hire)**

| Play | Why it’s real | Systems hook (possible) |
| --- | --- | --- |
| Client contract (project) | Still primary for many solos | Keep projects; size them to Studio |
| Productized service / retainer | Possible later; not default day one | Optional, gated |
| Subscription / SaaS drip | Modern solo path | New income stock/effect: $/d with ops load |
| Donations / sponsors / “buy me a coffee” | Indie reality | Low $/d, reputation or viral coupling |
| Ads / affiliate | Common, often unfun | $/d with reputation or attention tax |
| Marketplace / template sales | One-shot or slow drip | Burst budget or small income |
| Went viral / launched on HN | Breakthrough | Studio→Company exit OR cash+rep spike |

**Later Studio (still alone or almost)**

| Play | Why it waits | Systems hook (possible) |
| --- | --- | --- |
| Tests → CI | After you’ve felt Done/ship pain | Keep as structural teach |
| DDoS / basic hardening | After you’re public | Keep light |
| Refactor when debt hurts | Reactive | Keep |
| Contractor / part-time help | Cheaper than FTE | Maybe before full hire |
| First hire | Expensive; needs runway + demand | Gate on budget/income/reputation — not open day one |
| Heavier agent / harness | After assistant proves itself | Distinct from “one AI seat”; cost + debt governors |

**Explicitly not Studio-default**

- Eng manager, senior ladder, agent swarm, self-learning, redesign-rebuild
- Standup-as-daily-cash-burn
- Parallel near-duplicate AI cards

### Open design questions (Studio only)

1. ~~**Single AI seat vs ladder**~~ → **Settled (B):** one AI seat in
   Studio = keep **agent**, remove **copilot**. Heavier agent fleet /
   “runs while you sleep” is later-era depth, not a second day-one card.
2. ~~**Income model**~~ → **Settled (A) spine:** Studio money =
   **contracts** + **subscription** + **one-time product purchases**.
   **Users stock: reopened** — see §5.2.1 (was “no users”; now exploring
   a real users stock coupled to reputation and product income).
3. ~~**Hire gate**~~ → **Settled (C):** hire stays **visible** in the
   shop; no hide-until-ready gate. Player judges runway/budget. (May
   still teach via copy / soft cues later — not a hard lock.)
4. **What replaces standup** if coordination isn’t a $ burn for one
   person — burnout? context-switch? “always-on Slack”?
5. **Users system:** stocks, inflows/outflows, coupling to reputation /
   product decisions / challenges — brainstorm in §5.2.1 before locking
   JSON shape.

### 5.2.1 Studio product money + users (exploring)

**Money spine (settled):** contracts + subscription + one-time product
(marketplace fiction OK).

**Users stock (reopened — interesting):** instead of faking growth with
a blind time-ramp, track **users** as a real stock. Subscription and
one-time product value then *read* users (and maybe reputation) rather
than inventing customers offstage.

#### Why it’s compelling (systems-wise)

- New reinforcing loop: ship product → users → income → more build
  capacity → better product / reputation → more users.
- Reputation stops being “only for bigger contracts” — it can also be
  **trust that acquires or retains users**.
- Governors write themselves: outages, bad launches, debt-driven
  incidents, pricing anger → user churn; support load → rate drag.
- Studio→Company can re-interpret the same stock at a new scale without
  a parallel “fake ramp” mechanic.

#### Sketch (not locked)

| Piece | Role |
| --- | --- |
| **Stock: `users`** | Non-negative; **stays 0 until first launch** (settled). |
| **Inflows** | Completing launch / beta project; later marketing; reputation-gated organic growth; viral challenge; product updates (?) |
| **Outflows** | Churn from incidents, neglect, bad support; competitor events |
| **Subscription income** | ≈ `f(users)` per day (content formula: linear, diminishing, tier steps) |
| **One-time product** | Bursts scaled by users (or by *new* users this window) — lumpier than sub |
| **Contracts** | Client work — orthogonal money; may not unlock users by itself |
| **Reputation** | Affects acquisition rate and/or churn; damaged by breaches/incidents |

```mermaid
flowchart LR
  beta[Launch beta ~300 pts] -->|first unlock| users[users stock]
  polish[Later launches / updates] --> users
  rep[reputation] --> users
  users --> sub[subscription $/d]
  users --> ot[one-time product bursts]
  sub --> budget[budget]
  ot --> budget
  contracts[client contracts] --> budget
  contracts --> rep
  incident[incidents / debt] -->|churn| users
  incident -->|rep hit| rep
```

#### Settled forks

1. **When do users appear?** **Settled — option 1:** users stay **0
   until launch**. First meaningful ship is reframed as **“Launch beta
   release”** (working size **~300 points**, down from today’s 1500
   “First Contract”), and completing it **starts user acquisition**.
   Client contracts are a separate money path and do not by themselves
   invent users.
2. **Projects are era-scoped** — revisit the whole project list per era
   (§5.3). Today’s CRM / migration / enterprise ladder is not sacred.

#### Still open

3. **One product or many?** Single generic “your product” for Studio
   vs separate subscription SKU and one-time SKU sharing one user base.
4. **Formula complexity:** `incomePerDay = users * k` and
   `acquisition = g(reputation)` enough for Studio?
5. **Era boundary:** users carry into Company vs soft reset / segment
   change.
6. **Beta details:** starting backlog = 300? payout vs “you’re launching
   your own product” (maybe low/no client payout, reward = users + rep)?
   Relationship between beta launch and enabling subscription /
   one-time product decisions.

**Previous “compound until era, no users” assumption** remains a
fallback only. Prefer users-after-launch.

### 5.2.2 Settled so far (Studio shop spine)

| Keep / add | Drop / defer |
| --- | --- |
| **agent** as the one AI seat | **copilot** (remove) |
| **contracts** + **Launch beta ~300pts** (unlocks users) | support-retainer as primary solo income |
| **subscription** + **one-time product** (priced off **users**) | standup-as-$/d (replace or cut — open) |
| **users** stock (0 until beta launch) | swarm / self-learning / eng-manager as Studio-default |
| **basic-dev** visible anytime (player’s risk) | hide-until-ready hire gate |

Next: §5.3 projects-by-era (Studio first), then tighten beta economics.

---

## 5.3 Projects by era (revisit)

Shipped today (flat, not era-aware):

| id | Size | Upfront | Notes |
| --- | --- | --- | --- |
| first-contract (start) | 1500 | 0 | Client fiction; unlocks nothing special |
| small-crm | 5000 | $2k | Open |
| mobile-app | 9000 | $3k | ≥1 completion, rep 5 |
| big-migration | 20000 | $5k | ≥1 completion, rep 5 |
| enterprise-replatform | 50000 | $12k | ≥2 completions, rep 15 |

**Direction:** projects live in per-era JSON. Two families inside an era:

1. **Own-product work** — builds/ships *your* product (beta, v1, polish).
   Completing these interacts with **users** (and maybe unlocks sub /
   one-time SKUs).
2. **Client contracts** — classic B2B money + reputation; usually **no
   direct users**, unless we later add “open-source fame” style exceptions.

### Studio (zoom — draft)

| Working project | Size (sketch) | Role |
| --- | --- | --- |
| **Launch beta release** | **~300** | **Always the start project.** Finish → users begin accruing. Teaches the loop fast. |
| **Ship v1 / public launch** | ~800–1500? | Grows users harder; may pair with (but not auto-unlock) subscription / one-time product buys. |
| **Tiny client gig** | **~100–500** | Optional cash inflow + **positive reputation**. Competes with beta/v1 via context-switch tax (slower main progress). |

Push out of Studio: small-crm @ 5k, mobile @ 9k, migrations, enterprise —
those are **Company** (or later) shapes.

**Studio design pressures:**

- Game **starts on beta** (~300 pts @ base rates ⇒ short tutorial window;
  tune with speed controls in mind).
- Tiny client gigs are the relief valve when budget is tight — cash + rep,
  at the cost of splitting focus (existing concurrent-project tax).
- Product monetization cards (**subscription**, **one-time product**) are
  **separate buys** after launch — not auto-unlocked by finishing beta.
  Final buy timing/requirements deferred until a mockup is playable.
- Do not require enterprise-shaped contracts to exit Studio.

### Company (light sketch — fill later)

- Mid client work (CRM-shaped, mobile-shaped).
- Product: growth features, paid tier launch, marketplace listing scale-up.
- Reputation gates matter; users already exist from Studio carry (if we
  carry them).

### Megacorp (lighter sketch)

- Enterprise replatform–scale clients; platform bets; maybe users become
  “seats” / market share fiction at huge magnitude.

### Settled (Studio projects)

1. **Day one:** start on **Launch beta** only as the initial in-flight
   project. **Tiny client gigs (100–500 pts)** may be offered/startable
   when the player needs cash; they add **reputation** and slow main
   product progress via concurrency tax.
2. **Sub / one-time product:** **separate buys** for now. Judge unlock
   timing in a mockup — not locked to beta completion.

### Open — own-product cash (expanded)

**Question 3, expanded:** When you finish **Launch beta** / **Ship v1**,
what should hit the **budget** stock?

These are different lessons:

| Model | On completing beta/v1 you get… | Where ongoing cash comes from | Feels like | Risk |
| --- | --- | --- | --- | --- |
| **A. Users-first** | Little or **no** completion payout (maybe tiny runway crumb). Reward = **users** (+ a little rep). | Only after buying **subscription** / **one-time product**, which read `users`. | “I shipped a product; now I have to monetize.” Classic indie. | Player can launch, get users, and still go broke if they never buy a monetization card or take gigs. Harsh but clear dual loop. |
| **B. Hybrid** | Modest one-time bonus (launch buzz / early sales baked in) **plus** users. | Same product cards for the drip/bursts; bonus is a cushion. | “Launch puts a little money in the bank; monetization scales it.” | Softens the teach; might make monetization cards feel optional too long. |
| **C. Client-shaped product** | Fat `payoutPerPoint` + completion bonus like today’s contracts. | Product cards are gravy on top. | Beta plays like a paid gig that also happens to create users. | Blurs the two families; player may ignore subscription forever because shipping projects already prints money. |

**Related knobs (same decision):**

- Does beta cost **upfront** cash (domain, hosting) or is it free to start?
- Do tiny gigs remain the **intended** cash bridge until monetization,
  or should launch itself refill runway?
- If A: UI must make “you have users but no monetization” scream
  (otherwise it feels like a bug).

**Not deciding yet** — pick A/B/C (or a variant) when mocking Studio.
Default lean to discuss: **A or light B**, so client gigs and product
monetization stay distinct loops.

---

## 6. Working definition of done (draft)

P0.2 is **done enough to close** when:

1. **No first-class tags/tracks** in schema, runtime challenge gating, or
   player-facing copy that teaches “you are on track X.”
2. **Challenge pools** that used `hasTag` still make sense via JSON-owned
   predicates (or are intentionally simplified with a milestone comment).
3. **Docs/authoring** no longer instruct authors to use track tags as the
   curriculum map (VISION + this plan + authoring guide agree).
4. **Honesty tickets** #39, #32, #47 closed or explicitly deferred with
   reason on the milestone.
5. **Era packaging path is clear:** either E-1 landed (per-era JSON +
   one-way entry stub) or explicitly deferred with the ADR accepted and
   a follow-up milestone noted — but authors must know the target layout.
6. **Graph viewer:** V-1 landed or deferred with `make graph` stub noted;
   preferred inside P0.2 so era splits are reviewable.
7. Tests + `npm run build` green; engine/UI boundary intact.

Full sci-fi ladder and funding-stopover content are **successors**, not
blockers for closing P0.2.

---

## 7. Relationship to other docs

| Doc | Role |
| --- | --- |
| `docs/VISION.md` | Living direction; medium-term attractor language updated to match this plan |
| `docs/superpowers/specs/2026-08-07-p01-cockpit-watchability-plan.md` | P0.1; Done cue without CI/CD name — #39 is the P0.2 handoff |
| `docs/CONTENT-AUTHORING.md` | Must be updated when S-1/S-2 land |
| `docs/OPEN-DECISIONS.md` | Unrelated open tactics; do not stuff journey eras here |
| `scripts/issue-triage-prompt.md` | Update P0.2 / P1.1 mapping when track vocabulary is retired |

When implementation specs conflict with this plan, update one deliberately
before coding.
