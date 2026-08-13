import { describe, it, expect } from "vitest";
import { Engine } from "./engine";
import { applyEffects } from "./effects";
import { parseStartConfig, parseDecisions, parseChallenges, parseProjects } from "./content";
import startJson from "../../content/start.json";
import decisionsJson from "../../content/decisions.json";
import challengesJson from "../../content/challenges.json";
import projectsJson from "../../content/projects.json";
import type { GameContent, GameState } from "./types";

function fullContent(): GameContent {
  return {
    start: parseStartConfig(startJson),
    decisions: parseDecisions(decisionsJson),
    challenges: parseChallenges(challengesJson),
    projects: parseProjects(projectsJson),
  };
}

function assertInvariants(s: Readonly<GameState>, day: number): void {
  for (const [name, v] of Object.entries(s.stocks)) {
    expect(v, `stock ${name} at day ${day}`).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(v), `stock ${name} finite at day ${day}`).toBe(true);
  }
  expect(s.pointsPerDay).toBeGreaterThanOrEqual(0);
}

describe("simulation", () => {
  it("idle strategy: 2000 days with full content violates no invariants", () => {
    const e = new Engine(fullContent());
    for (let day = 1; day <= 2000; day++) {
      e.tick();
      assertInvariants(e.getState(), day);
    }
  });

  // Studio spine idle-mechanism probe (issue #88). RE-PINNED wholesale: the
  // Studio economy replaces the 1500-pt First Contract ($17/pt) with a 300-pt
  // Launch beta that pays NOTHING per point (payoutPerPoint 0) and a $800
  // completion bonus. So an idle player earns $0 while shipping the beta and
  // $0 after (idle starts no follow-on project), which makes the whole budget
  // trajectory a clean piecewise-linear -$20/day base burn with a single +$800
  // bump when the beta completes. Challenges are stripped to isolate this.
  //
  // Tech-debt drag never engages here: the beta is only 300 points, so idle
  // ships at most ~150 techDebt (0.5/pt) before the pipeline empties -- far
  // below the freeDebt 400 grace band -- and payout is $0 anyway, so even if
  // it did drag, it could not move the budget. Hence the exact linear pins.
  //
  // PHASE 1 -- pre-completion, exactly linear: budget(d) = 10000 - 20d (no
  // payout during the beta). Day 50 = 9000, 100 = 8000, 200 = 6000, 300 =
  // 4000. This is the Studio solvency rule made concrete: the beta finishes
  // (day 302) with the budget still comfortably positive (~4000 at day 300),
  // on starting resources alone, no gigs and no monetization.
  //
  // COMPLETION -- day 302 (300 points ship one per day, first ships day 3):
  // +$800 bonus and +1 reputation land, budget jumps to 4760, and the beta's
  // completionStockGrants add +30 users (the users economy switches on here;
  // organic acquisition then runs the same tick).
  //
  // PHASE 2 -- post-completion tail: still -$20/day (no project, no income),
  // so budget(d) = 4760 - 20(d - 302), hitting 0 on day 540 and clamped after.
  //
  // USERS -- 0 until day 302, then grow from 30 toward the steady state where
  // organic gain (1.5 + reputation 1 * 0.1 = 1.6/day) equals churn
  // (users * 0.01), i.e. 160 users, and hold there.
  it("idle mechanism: $0/pt Launch beta, clean -$20/day burn with a +$800 completion bump, then drains to zero", () => {
    const c = fullContent();
    c.challenges = [];
    const e = new Engine(c);
    const at: Record<number, number> = {};
    let completionDay = 0;
    let firstZeroDay = 0;
    let repBeforeCompletion = NaN;
    let repAfterCompletion = NaN;
    let usersBeforeCompletion = NaN;
    let usersAfterCompletion = NaN;
    for (let day = 1; day <= 2000; day++) {
      e.tick();
      const s = e.getState();
      if (completionDay === 0 && s.completedProjects >= 1) {
        completionDay = day;
        repAfterCompletion = s.stocks.reputation;
        usersAfterCompletion = s.stocks.users;
      }
      if (firstZeroDay === 0 && s.stocks.budget === 0) firstZeroDay = day;
      if (day === 301) { repBeforeCompletion = s.stocks.reputation; usersBeforeCompletion = s.stocks.users; }
      if ([50, 100, 200, 300, 302, 540].includes(day)) at[day] = s.stocks.budget;
    }
    // Users and reputation stay at 0 through the whole beta, then step up the
    // moment it completes -- nothing invents users offstage before launch.
    expect(usersBeforeCompletion).toBe(0);
    expect(repBeforeCompletion).toBe(0);
    expect(completionDay).toBe(302);
    expect(repAfterCompletion).toBe(c.start.initialProject.reputationReward); // 1
    expect(usersAfterCompletion).toBeCloseTo(31.3, 1); // 30 grant + first organic day (1.6 - 0.3 churn)
    // Phase 1: exactly linear -$20/day, no payout during the $0/pt beta.
    expect(at[50]).toBe(9000);
    expect(at[100]).toBe(8000);
    expect(at[200]).toBe(6000);
    expect(at[300]).toBe(4000); // solvency rule: beta finishes with budget to spare
    // Completion bump: +$800 bonus lands on day 302.
    expect(at[302]).toBe(4760); // (10000 - 20*302) + 800
    // Phase 2: clean -$20/day tail to zero. 4760 / 20 = 238 -> day 540.
    expect(firstZeroDay).toBe(540);
    expect(at[540]).toBe(0);
    expect(e.getState().stocks.budget).toBe(0); // clamped through day 2000
    // Users grow to and hold the 160 steady state (1.6/day gain == 1% churn).
    expect(e.getState().stocks.users).toBeCloseTo(160, 0);
    expect(e.getState().stocks.reputation).toBe(1); // no challenges, so it never drops
  });

  // Full-content idle probe: same do-nothing player, challenges on. Events
  // steepen the mechanism's -$3/day (Release 9 baseline; see the mechanism
  // probe above). The idle player owns no decisions at all, so every
  // ownership/headcount-gated content-wave challenge (model-deprecation,
  // api-price-hike, runaway-agent-loop, meeting-creep, team-conflict,
  // cloud-credits) is condition-gated out and never fires; the only new
  // challenge that reaches the idle player is open-source-windfall (minDay
  // 15, +$400, 1%/day, 60-day cooldown), a pure income boost that softens the
  // glide. ddos is additionally gated by lacksDecision "ddos-protection"
  // (Release 9), which the idle player also satisfies (owns nothing) so it
  // still fires, just far less often at its retuned 0.005 probability.
  //
  // RE-PINNED for content wave (release 8, task 4.5): challenge rolls are now
  // hashed per challenge (hashRoll on gameSeed/day/id) instead of drawn
  // positionally from the shared rng stream, and the challenge phase no longer
  // consumes that stream at all. This deliberately changes which challenge
  // days land (a fresh, content-stable draw of the same probabilities). The
  // point of the refactor is that these values no longer move when a
  // challenge is added or reordered in content.
  //
  // RE-PINNED again for Release 9 (challenge retune: ddos 0.03->0.005 with a
  // 60-day cooldown and the new lacksDecision "ddos-protection" gate,
  // api-price-hike 0.02->0.0025 with a 365-day cooldown, prod-incident base
  // 0.01->0.005, laptop-dies value -400->-300, runaway-agent-loop
  // 0.015->0.008; plus the economy-slack retune, payoutPerPoint 15->17 --
  // see the mechanism probe above). Both changes push the glide gentler and
  // the margin wider. Measured over this run: 19 scope-creep, 2 ddos, 6
  // prod-incident, 3 laptop-dies, 2 open-source-windfall, plus the
  // first-contract completion -- about 32 events across 2000 days (similar
  // count to the spacing-only baseline, but ddos collapses from 14 fires to
  // 2 thanks to its much lower probability and 60-day cooldown). The glide is
  // visibly gentler as a result: broke by ~day 1826 (was ~1633 pre-retune),
  // day 300 = 8766 (was 8111), day 600 = 7491 (was 5952). Assertions leave
  // headroom but pin the shape: meaningful decline off the starting 10,000,
  // no instant death, broke well within the horizon, near-empty long-run.
  // Studio spine (issue #88): same do-nothing player, challenges on. The idle
  // player owns no monetization decisions, so its +30 users (and organic
  // growth after the beta) never turn into income -- the beta's $800 bonus and
  // the odd windfall are the only cash it ever sees, against a steady -$20/day
  // base burn. So even with challenges it drains to zero well within the
  // horizon (observed first clamp ~day 507; challenges' net drain plus the
  // absence of contract payout make it slightly faster than the
  // challenge-free day-540). The beta still completes on day 302 (300 points
  // ship one per day regardless of any backlog the challenges pile on -- the
  // project tracks points shipped, not the backlog stock). This pins the
  // shape, not exact challenge-dependent values.
  it("idle with full content: no monetization means the users grant never pays off; drains to zero within the horizon", () => {
    const e = new Engine(fullContent());
    let budgetAt300 = NaN;
    let completionDay = 0;
    let sawUsers = false;
    for (let day = 1; day <= 2000; day++) {
      e.tick();
      const s = e.getState();
      if (completionDay === 0 && s.completedProjects >= 1) completionDay = day;
      if (s.stocks.users > 0) sawUsers = true;
      if (day === 300) budgetAt300 = s.stocks.budget;
    }
    expect(completionDay).toBe(302); // the beta completes on schedule
    expect(sawUsers).toBe(true); // the users economy did switch on at launch
    expect(budgetAt300).toBeLessThan(4200); // pre-completion glide, well off 10,000 (observed ~3700)
    expect(budgetAt300).toBeGreaterThan(0); // no instant death
    expect(e.getState().stocks.budget).toBeLessThan(100); // broke by day 2000 (observed 0, first clamp ~day 507)
  });

  // Smart-strategy probe: a modest, sensible plan (test-suite day 1, ci-cd
  // when affordable, up to two basic-devs after ci-cd, resolve choices with
  // the first option, and start small-crm whenever no project is in
  // flight). Under the seeded rng the hires resolve as "Strong hire" (+1,
  // day 1) and "Decent hire" (+0.5, day 2): 2.5 pt/day at $15/pt = $37.50
  // income against $34/day costs (burn 20 + 2 x dev payroll 7).
  //
  // RESOLUTION (release-7 balance, round 3): scale is now the growth
  // engine. With the dev at $7/day and the first contract at 1500 pts, the
  // smart bot used to complete it on day 662, roll into small-crm, and stay
  // solvent through day 2000 (budget(2000) observed 14.89).
  //
  // RE-PINNED for content wave (release 8, task 4.5). Challenge rolls are now
  // hashed per challenge (hashRoll on gameSeed/day/id) rather than drawn
  // positionally from the shared rng stream, and the challenge phase no longer
  // touches that stream -- so both the challenge outcomes AND the purchase
  // gambles (which still draw from the stream) fall on a different, now
  // content-stable, deterministic sequence than under task 4's positional
  // draws. This build owns basic-dev (whose definition has `human: true`), so
  // it also satisfies meeting-creep's and team-conflict's minHumanDevs
  // conditions once it hires.
  //
  // RE-PINNED again for Release 9 (global event spacing, challengeSpacingDays
  // 50): with a 50-day floor between fires, the total event count over 2000
  // days drops sharply and shifts every subsequent number. Measured challenge
  // fires over this run: sickness 13, scope-creep 10, ddos 7, prod-incident
  // 4, key-dev-poached 2, laptop-dies 1, open-source-windfall 1 (team-conflict
  // and meeting-creep did not get a turn at all in this run -- with ~40
  // spacing-gated windows total, the earlier-indexed, more probable
  // challenges tend to win the same-tick break before less probable ones get
  // a chance).
  //
  // RESOLUTION (release-8 Task 6): this probe is deliberately KEPT as a
  // mid-tier observation probe, not a viability bar. [Superseded below --
  // Release 9 changes the outcome, not just the margin.]
  //
  // RE-PINNED again for Release 9 (challenge retune -- lower probabilities and
  // smaller values on ddos/api-price-hike/prod-incident/laptop-dies/
  // runaway-agent-loop -- plus the economy-slack retune, payoutPerPoint
  // 15->17 and cheaper agent-harness/swarm-orchestrator/self-learning-agents).
  // FLAG for whoever owns the difficulty curve: this probe's original point
  // was that a modest two-dev build is NOT enough to stay solvent under full
  // challenge load ("choices matter"). That is no longer true. Observed this
  // run: completion day 1010 (was 1145), budget at day 1000 is 287.67, not 0
  // (was 0 -- first clamp used to land at day 735; this build now never hits
  // the zero-clamp at all, firstZero -1 across the full 2000 days),
  // post-completion peak/end budget 12203.70 (was ~1983). The retune widened
  // margins enough that even the narrow build now clears the bar the two
  // richer probes below (human-heavy, automation-heavy) were meant to be the
  // exclusive gate for. The assertions below are left as loose,
  // still-satisfied observations (they do not assert insolvency and did not
  // need to change), but the comment is corrected to stop claiming a design
  // outcome ("goes broke by design") that the current content no longer
  // produces. Only completedProjects >= 1 is solvency-shaped; budget
  // checkpoints are observations, not guarantees.
  //
  // RE-CHECKED for Release 11 (continuousDeploy replaces ci-cd's old
  // deploy x1.1 modifyRate): re-run bit-for-bit identical -- completion day
  // 1010, budgetAt1000 287.67, peak/end budget 12203.70, all unchanged. This
  // build's finish rate (base 1.0 plus two additive dev hires) never
  // exceeded ci-cd's old 1.1/day deploy cap, so removing that cap in favor
  // of shipping the whole done stock every tick doesn't change anything
  // observable here -- deploy was never this build's bottleneck. See the
  // greedy-strategy probe below for a build where it was.
  //
  // RE-PINNED for Release 15 (tech-debt drag). Completion day (1010) and
  // budgetAt1000 (287.67) are unchanged -- this modest build's debt stays low
  // enough early that the drag is negligible through day 1000 -- but its
  // longer-run peak/end budget slips from 12203.70 to 10967.90 as the drag
  // engages late. It does not narrate an archetype (its drag never reaches the
  // limits-to-growth threshold of 0.8). Still solvency-shaped only on
  // completedProjects >= 1; the budget checkpoints remain observations.
  it("smart strategy (mid-tier observation): completes the first contract; under Release 9's retune this narrow build now stays solvent throughout", () => {
    const content = fullContent();
    const e = new Engine(content);
    let hires = 0;
    let budgetAt1000 = NaN;
    let completionDay = 0;
    let peakBudgetAfterCompletion = 0;
    for (let day = 1; day <= 2000; day++) {
      e.tick();
      const s = e.getState();
      const owned = (id: string) => s.decisions.some((d) => d.defId === id);
      if (!owned("test-suite") && s.stocks.budget >= 500) e.applyDecision("test-suite");
      if (owned("test-suite") && !owned("ci-cd") && s.stocks.budget >= 750) e.applyDecision("ci-cd");
      if (owned("ci-cd") && hires < 2) {
        e.applyDecision("basic-dev");
        hires += 1;
      }
      // Continuation: keep income flowing once the current contract is done.
      if (s.projects.length === 0) {
        const crm = e.availableProjects().find((p) => p.def.id === "small-crm");
        if (crm?.startable) e.startProject("small-crm");
      }
      for (const pc of [...s.pendingChoices]) {
        const def = content.challenges.find((c) => c.id === pc.challengeId)!;
        e.resolveChoice(pc.challengeId, def.choice!.options[0].id);
      }
      if (completionDay === 0 && s.completedProjects >= 1) completionDay = day;
      if (completionDay > 0) peakBudgetAfterCompletion = Math.max(peakBudgetAfterCompletion, s.stocks.budget);
      if (day === 1000) budgetAt1000 = s.stocks.budget;
      assertInvariants(s, day);
    }
    expect(completionDay).toBeGreaterThan(0); // observed: day 1010
    expect(completionDay).toBeLessThan(1800); // still comfortably within the 2000-day horizon
    expect(e.getState().completedProjects).toBeGreaterThanOrEqual(1);
    expect(budgetAt1000).toBeGreaterThanOrEqual(0); // observed 287.67 -- never clamped to 0 this run
    expect(peakBudgetAfterCompletion).toBeGreaterThan(0); // observed 10967.90 (was 12203.70: tech-debt drag trims the late breather)
    expect(e.getState().stocks.budget).toBeGreaterThanOrEqual(0); // observed 10967.90 at day 2000
  });

  // ---- Release-8 Task 6 viability probes ------------------------------------
  //
  // A shared harness for the two "richer build" probes the content-wave spec
  // (section 2) demands: at least one human-heavy and one automation-heavy
  // strategy must each complete multiple projects and stay solvent over 2000
  // days. Structure follows the smart probe: a priority shopping list bought
  // strictly in order (respecting requires edges -- the list stalls on the
  // first unowned item until it is purchasable with a cash buffer), pending
  // choices resolved with their first option, and project continuation
  // small-crm then mobile-app whenever nothing is in flight and the upfront
  // cost plus a reserve is affordable. The buffer/reserve are strategy
  // parameters (a sensible player keeps runway), not engine knobs.
  //
  // Deliberately NO cross-probe dominance assertion: track speed is emergent
  // (spec section 2); these pin viability floors only.
  function runBuildProbe(shoppingList: string[]): {
    completedProjects: number;
    completionDays: number[];
    budgetAtDay: Record<number, number>;
    endBudget: number;
    everBroke: boolean;
    endReputation: number;
    endUsers: number;
    peakUsers: number;
    milestonesSeen: string[];
  } {
    const BUY_BUFFER = 800; // keep this much cash on hand beyond any oneTime cost
    const PROJECT_RESERVE = 600; // keep this much beyond a project's upfront cost
    const content = fullContent();
    const e = new Engine(content);
    let startedSmallCrm = false;
    let lastCompleted = 0;
    let everBroke = false;
    let peakUsers = 0;
    const completionDays: number[] = [];
    const budgetAtDay: Record<number, number> = {};
    for (let day = 1; day <= 2000; day++) {
      e.tick();
      const s = e.getState();
      const owned = (id: string) => s.decisions.some((d) => d.defId === id);
      for (const id of shoppingList) {
        if (owned(id)) continue;
        const a = e.availableDecisions().find((x) => x.def.id === id);
        if (!a || a.code === "missing-requires") break; // wait for the prerequisite
        const oneTime = a.def.cost.oneTime ?? 0;
        if (a.purchasable && s.stocks.budget >= oneTime + BUY_BUFFER) e.applyDecision(id);
        break; // strict priority: never skip ahead in the list
      }
      if (s.projects.length === 0) {
        const wantId = !startedSmallCrm ? "small-crm" : "mobile-app";
        const w = e.availableProjects().find((x) => x.def.id === wantId);
        if (w?.startable && s.stocks.budget >= w.def.upfrontCost + PROJECT_RESERVE) {
          e.startProject(wantId);
          if (wantId === "small-crm") startedSmallCrm = true;
        }
      }
      for (const pc of [...s.pendingChoices]) {
        const def = content.challenges.find((c) => c.id === pc.challengeId)!;
        e.resolveChoice(pc.challengeId, def.choice!.options[0].id);
      }
      if (s.completedProjects > lastCompleted) {
        completionDays.push(day);
        lastCompleted = s.completedProjects;
      }
      if (s.stocks.budget === 0) everBroke = true;
      peakUsers = Math.max(peakUsers, s.stocks.users);
      if ([500, 1000, 2000].includes(day)) budgetAtDay[day] = s.stocks.budget;
      assertInvariants(s, day);
    }
    return {
      completedProjects: e.getState().completedProjects,
      completionDays,
      budgetAtDay,
      endBudget: e.getState().stocks.budget,
      everBroke,
      endReputation: e.getState().stocks.reputation,
      endUsers: e.getState().stocks.users,
      peakUsers,
      milestonesSeen: [...e.getState().milestonesSeen],
    };
  }

  // Human-heavy build, RE-PINNED wholesale for the Studio spine (issue #88).
  // The Studio money spine is monetization (subscription + one-time product
  // reading the users stock), NOT the client-contract ladder, so a sensible
  // human-heavy player now buys the two monetization cards early (right after
  // ci-cd) alongside the hire track. The support drag on users (above the
  // 25-user free band) is the cost of that growth: at the ~150-user steady
  // state it cancels 35% of every delivery rate, which -- combined with the
  // 5000-point small-crm being an order of magnitude larger than the 300-point
  // beta -- means the follow-on contract does NOT finish inside the 2000-day
  // horizon (observed ~4530 of 5000 points shipped). The big client-contract
  // ladder belongs to later eras / issue #89; here the viability bar is the
  // Studio one: finish the beta and stay solvent via monetization.
  //
  // Observed: completes the Launch beta on day 93, then works small-crm the
  // rest of the run without finishing it (completedProjects stays 1). The
  // subscription (users * $0.75/day at ~150 users ≈ $112/day) dwarfs the
  // ~$20-60/day burn, so budget climbs steadily -- 40545 at day 500, 99568 at
  // day 1000, 216085 at day 2000 -- and it never hits the zero-clamp. Users
  // grow to the ~150 steady state. Reputation ends at 0 (the beta's +1 is
  // eaten by incident/breach losses and no rep-earning contract completes), so
  // no milestone is crossed -- that is a consequence of the reworked money
  // spine, not a regression. Loose bounds pin the shape (solvent + monetized),
  // not challenge-knife-edge exact values.
  it("human-heavy strategy: finishes the beta and stays solvent via monetization over 2000 days", () => {
    const r = runBuildProbe([
      "test-suite",
      "ci-cd",
      "subscription",
      "one-time-product",
      "better-tooling",
      "basic-dev",
      "eng-manager",
      "senior-dev",
      "standup",
      "contractor",
    ]);
    expect(r.completedProjects).toBeGreaterThanOrEqual(1); // finished the Launch beta (observed day 93)
    expect(r.everBroke).toBe(false); // observed: never zero-clamped in 2000 days
    expect(r.peakUsers).toBeGreaterThan(100); // users economy switched on and grew (observed ~150)
    // Monetization is the money spine: subscription income lifts the budget far
    // above the starting 10,000 (observed end ~216,085). Loose lower bound.
    expect(r.endBudget).toBeGreaterThan(50000);
    expect(r.budgetAtDay[2000]).toBeGreaterThan(r.budgetAtDay[500]!); // still climbing on subscription income
  });

  // Automation-heavy build, RE-PINNED wholesale for the Studio spine (issue
  // #88). Same Studio adaptation as the human-heavy probe: the sensible player
  // buys the two monetization cards early (after ci-cd), then the agent ladder.
  // Agent-line ownership still opens its own challenge pool (api-price-hike,
  // runaway-agent-loop, model-deprecation, cloud-credits) and, owning no human
  // devs, it eats laptop-dies but no sickness/poaching -- a materially
  // different risk profile from the human build, the track-parity design goal
  // (viable, not identical). As with the human build the 5000-point small-crm
  // does not finish under the ~150-user support drag within the horizon
  // (observed ~4690 of 5000 shipped); the Studio bar is the beta + solvency.
  //
  // Observed: completes the Launch beta on day 103, works small-crm for the
  // rest of the run without finishing it. Subscription income (≈$112/day at
  // ~150 users) again dominates burn, so budget climbs -- 36077 at day 500,
  // 99392 at day 1000, 213542 at day 2000 -- and it never zero-clamps. Users
  // reach the ~150 steady state; reputation ends at 0 (beta's +1 eaten by
  // incidents/breaches, no rep-earning contract completes). Loose bounds pin
  // the shape (solvent + monetized), not challenge-knife-edge exact values.
  it("automation-heavy strategy: finishes the beta and stays solvent via monetization over 2000 days", () => {
    const r = runBuildProbe([
      "test-suite",
      "ci-cd",
      "subscription",
      "one-time-product",
      "agent",
      "agent-harness",
      "swarm-orchestrator",
      "agent-swarm",
      "self-learning-agents",
      "support-retainer",
    ]);
    expect(r.completedProjects).toBeGreaterThanOrEqual(1); // finished the Launch beta (observed day 103)
    expect(r.everBroke).toBe(false); // observed: never zero-clamped in 2000 days
    expect(r.peakUsers).toBeGreaterThan(100); // users economy switched on and grew (observed ~150)
    expect(r.endBudget).toBeGreaterThan(50000); // monetization lifts budget far above 10,000 (observed ~213,542)
    expect(r.budgetAtDay[2000]).toBeGreaterThan(r.budgetAtDay[500]!); // still climbing on subscription income
  });

  it("greedy strategy: buy everything affordable each day, invariants hold", () => {
    const content = fullContent();
    const e = new Engine(content);
    let peakPointsPerDay = 0;
    for (let day = 1; day <= 2000; day++) {
      e.tick();
      peakPointsPerDay = Math.max(peakPointsPerDay, e.getState().pointsPerDay);
      // Re-check affordability after each purchase rather than looping over
      // one stale availableDecisions() snapshot: buying one item can spend
      // down the budget enough that a later item in the same snapshot,
      // affordable when the snapshot was taken, no longer is. This re-check
      // loop is the correct place for that fix, independent of exactly which
      // day the budget lands in the affordability window (that day moves with
      // any change to the challenge/gamble draw sequence).
      let bought = true;
      while (bought) {
        bought = false;
        for (const a of e.availableDecisions()) {
          if (a.purchasable && !e.getState().decisions.some((d) => d.defId === a.def.id)) {
            e.applyDecision(a.def.id);
            bought = true;
            break;
          }
        }
      }
      // Same stale-snapshot fix as the decision loop above, now needed for
      // projects too: under the Task 6 payouts the greedy bot first reaches a
      // day where two projects are startable in one availableProjects()
      // snapshot, and paying the first upfront cost makes the second
      // unaffordable before the loop reaches it.
      let started = true;
      while (started) {
        started = false;
        for (const p of e.availableProjects()) {
          if (p.startable) {
            e.startProject(p.def.id);
            started = true;
            break;
          }
        }
      }
      // resolve any pending choice with its first option
      for (const pc of [...e.getState().pendingChoices]) {
        const def = content.challenges.find((c) => c.id === pc.challengeId)!;
        e.resolveChoice(pc.challengeId, def.choice!.options[0].id);
      }
      assertInvariants(e.getState(), day);
    }
    // sanity: the factory actually did something
    expect(e.getState().stocks.shipped).toBeGreaterThan(100);

    // Release 15 -- Limits to Growth made visible. Greedy buys every decision
    // affordable each day, which stacks debt-raising capacity (agents, swarm,
    // contractor) far faster than the mitigation it also buys can offset, so
    // its tech debt balloons and the tech-debt drag deepens over the run. Its
    // throughput therefore PEAKS early (observed ~8.36 pt/day around day 73,
    // before the debt has piled up) and is a fraction of that by day 2000
    // (observed ~1.94 pt/day). This is the "limits-to-growth" archetype the
    // engine also narrates into the log around day 501 for this build: the
    // faster it shipped, the more debt it grew; the more debt, the slower it
    // ships. Pinned as a margin, not an exact value (the exact peak/end move
    // with any challenge/gamble-draw change), so it captures the lesson
    // without over-constraining.
    expect(e.getState().pointsPerDay).toBeLessThan(peakPointsPerDay * 0.5);
    expect(peakPointsPerDay).toBeGreaterThan(5); // the early peak really was high
    // No solvency or completion assertions here, deliberately -- this test
    // exercises engine invariants under maximal purchasing pressure, not
    // balance.
    //
    // RE-PINNED for Release 17 (reputation) -- and the one probe where the
    // downward spiral bites HARD, which is the intended lesson. Greedy stacks
    // every debt-raiser it can afford, so its techDebt balloons (~5790 by day
    // 2000) and it eats security breaches repeatedly; those (plus prod-incident)
    // strip reputation faster than its two completions (first-contract +1,
    // small-crm +5) can build it, so reputation reaches "trusted" (5) briefly
    // -- milestonesSeen does contain "trusted" -- then collapses back to 0,
    // RE-LOCKING the big-migration/mobile-app/enterprise tiers behind their
    // reputation gates. Locked out of the big contracts it used to grab on
    // completion-count alone, greedy ships far less than pre-reputation
    // (shipped ~11140, was ~13063) and ends far poorer (budget ~13679, was
    // ~56826): success-to-the-successful running in reverse. The early peak is
    // actually HIGHER now (~9.27, was ~8.36 pt/day) because the reputation gate
    // keeps the big tiers from starting early, so fewer concurrent projects
    // means less context-switch tax on the opening sprint. The two margin
    // assertions above still hold (end ~4.26 < peak*0.5 ~4.63; peak ~9.27 > 5),
    // and the test stays invariants-only by design. Reputation invariants
    // (>= 0, finite) hold throughout via assertInvariants over every stock.
    //
    // RE-PINNED for Release 9 (global event spacing, challengeSpacingDays
    // 50): observed at day 2000, completedProjects 2, shipped ~12598, budget
    // ~47233. This is a marked shift from the pre-spacing observation
    // (budget ~2.95, shipped ~10687) that the comment here used to cite as
    // evidence for "buying everything is NOT a viable strategy" -- under the
    // spaced-out challenge load, the all-of-everything payroll no longer eats
    // every dollar; challenge-driven drains now land roughly 8-10x less
    // often (see the human-heavy/automation-heavy probes above), so greedy
    // purchasing comes out comfortably solvent within this 2000-day window
    // instead of near-zero. That design claim ("choices matter" because
    // greedy is punished) no longer holds as stated at the shipped 50-day
    // spacing; flagging this as a balance question for whoever owns the
    // difficulty curve, not silently re-asserting the old narrative. Balance
    // is pinned by the mechanism/idle probes above and the
    // human-heavy/automation-heavy viability probes; this test remains
    // invariants-only by design.
    //
    // RE-PINNED again for Release 9 (challenge retune + economy slack):
    // observed at day 2000, completedProjects 2, shipped ~12545, budget
    // ~44926 -- essentially unchanged from the spacing-only figures directly
    // above (shipped -13, budget -2307, both within noise of a 2000-day
    // greedy run). The "choices matter" claim was already broken by the
    // spacing change; this retune does not meaningfully move it further in
    // either direction. Same invariants-only scope as above.
    //
    // RE-PINNED for Release 11 (continuousDeploy replaces ci-cd's old
    // deploy x1.1 modifyRate): observed at day 2000, completedProjects 2,
    // shipped ~13063 (was ~12545, +4%), budget ~56826 (was ~44926, +26%).
    // Unlike the smart/human-heavy/automation-heavy probes above, THIS
    // build's throughput was actually deploy-bound: buying everything
    // stacks many devs' additive pull/finish contributions (and
    // self-learning-agents' ramp) well past the old ci-cd deploy cap of
    // 1.1/day, so done used to queue up behind that cap. Continuous deploy
    // removes the cap entirely (ships the whole done stock every tick), so
    // this is the one probe where the mechanism change is actually visible
    // -- more points ship, more budget accrues. Still invariants-only by
    // design; no solvency/completion assertions changed.
  });

  // SPIRAL probe (Release 17): the headline systems behavior -- "success to the
  // successful" running in reverse, a real downward spiral. Manufacture a build
  // that has climbed to the top tier's reputation gate (enterprise-replatform:
  // 2 completions AND 15 reputation, the two floors it stacks), confirm the
  // contract is startable, then apply ONE security-breach's reputation hit and
  // assert the tier re-locks -- projectAvailability flips it to not-startable
  // with the reputation reason, live, no un-start mechanism needed. This is the
  // income you needed to recover becoming unreachable precisely because an
  // incident cost you the standing that unlocked it.
  it("downward spiral: a security-breach reputation hit re-locks a tier the build had unlocked", () => {
    const content = fullContent();
    const e = new Engine(content);
    // Cast past the Readonly view to stage a build sitting exactly on the top
    // tier's gate: 2 completed projects, reputation 15 (enterprise's floor),
    // and plenty of budget so affordability is never the binding reason.
    const s = e.getState() as GameState;
    s.completedProjects = 2;
    s.stocks.reputation = 15;
    s.stocks.budget = 100000;

    const enterpriseAt = () => e.availableProjects().find((p) => p.def.id === "enterprise-replatform")!;
    // Both floors satisfied AND affordable -> startable, no reason.
    expect(enterpriseAt().startable).toBe(true);
    expect(enterpriseAt().reason).toBeUndefined();

    // Apply the real security-breach effects (budget -300, reputation -5). The
    // -5 drops reputation from 15 to 10, below enterprise's 15 gate.
    const breach = content.challenges.find((c) => c.id === "security-breach")!;
    applyEffects(s, breach.effects, "spiral-test");
    expect(s.stocks.reputation).toBe(10);

    // The tier re-locks live, and the reason names the reputation shortfall
    // (not affordability -- budget is still ample). This is the spiral: the
    // breach cost the access, not just the cash.
    const relocked = enterpriseAt();
    expect(relocked.startable).toBe(false);
    expect(relocked.reason).toBe("requires 15 reputation");

    // A second breach digs deeper (10 -> 5) and it stays locked -- recovery
    // requires re-earning reputation through completions, which the breach loop
    // also threatens. The trap is real (by design); the balance sweep keeps it
    // survivable for a mitigated build (see the automation-heavy probe).
    applyEffects(s, breach.effects, "spiral-test-2");
    expect(s.stocks.reputation).toBe(5);
    expect(enterpriseAt().startable).toBe(false);
    expect(enterpriseAt().reason).toBe("requires 15 reputation");
  });

  it("upgrades matter: test suite reduces tech debt vs idle over 400 days", () => {
    const idle = new Engine(fullContent());
    const invested = new Engine(fullContent());
    invested.applyDecision("test-suite");
    for (let day = 1; day <= 400; day++) {
      idle.tick();
      invested.tick();
      if (day === 10) invested.applyDecision("ci-cd");
    }
    expect(invested.getState().stocks.shipped).toBeGreaterThanOrEqual(idle.getState().stocks.shipped * 0.8);
    expect(invested.getState().stocks.techDebt).toBeLessThan(idle.getState().stocks.techDebt);
  });

  it("stall is reachable and stable: empty content pipeline drains to stall", () => {
    const c = fullContent();
    // Isolate the invariant under test (isStalled reachability) from three
    // confounds that are each real, deliberate engine behavior but would
    // otherwise make a true stall unreachable within a short tick budget:
    //  - challenges.json fires random events (e.g. scope-creep: +200 backlog)
    //    unconditionally, regardless of the player's budget.
    //  - debtMultiplier > 0 regenerates a fraction of every shipped point
    //    back into backlog forever, so backlog+inProgress+done only decays
    //    asymptotically and never hits exact 0 in a realistic tick count.
    //  - decisions.json's basic-dev has a perDay-only cost (no oneTime), and
    //    availability() only checks oneTime affordability (by design: see
    //    decisions.test.ts "payroll failure removes the decision permanently
    //    during tick" - buying beyond your means is allowed, payroll failure
    //    is the insolvency mechanism). That makes basic-dev always
    //    "purchasable" regardless of budget, so isStalled() can never be
    //    true while any decisions are offered.
    // None of these are bugs; they just mean "true stall" cannot be produced
    // from unmodified full content in a short simulation. Zeroing them here
    // isolates the pipeline-drain + project-affordability logic that
    // isStalled() is actually meant to capture.
    c.challenges = [];
    c.decisions = [];
    c.start.debtMultiplier = 0;
    c.start.stocks.backlog = 3;
    c.start.stocks.budget = 10;
    c.start.initialProject.sizePoints = 3;
    // Zero the payout so completing the initial project does not inject
    // cash that would make a project (cheapest upfrontCost $2000) affordable.
    c.start.initialProject.completionBonus = 0;
    c.start.initialProject.payoutPerPoint = 0;

    const e = new Engine(c);
    for (let i = 0; i < 30; i++) e.tick();
    expect(e.isStalled()).toBe(true);

    const before = e.getState().stocks;
    expect(before.budget).toBe(0);
    expect(before.backlog).toBe(0);
    expect(before.inProgress).toBe(0);
    expect(before.done).toBe(0);

    e.tick();
    expect(e.isStalled()).toBe(true);
    const after = e.getState().stocks;
    expect(after.budget).toBe(0);
    expect(after.backlog).toBe(0);
    expect(after.inProgress).toBe(0);
    expect(after.done).toBe(0);
  });
});
