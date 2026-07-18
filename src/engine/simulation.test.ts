import { describe, it, expect } from "vitest";
import { Engine } from "./engine";
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

  // Release-7 idle-drain mechanism probe. The structural requirement: doing
  // nothing must lose money on NET, not merely be exposed to challenge
  // events. With baseBurnPerDay 20 and the first contract at $17/pt (Release
  // 9 economy-slack retune, was $15/pt) on the 1 pt/day idle throughput,
  // steady idle cashflow is 17 - 20 = -$3/day (was -$5/day). Challenges are
  // stripped here to pin that mechanism in isolation (the full-content
  // trajectory is probed separately below).
  //
  // RE-PINNED for Release 9 (payoutPerPoint 15 -> 17). Exact arithmetic (all
  // integer flows, so toBe is safe): the first point ships on day 3
  // (unaffected by the payout change), so while the 1500-pt contract is in
  // flight (2 <= d < 1502):
  //   budget(d) = 10000 - 20d + 17(d - 2) = 9966 - 3d
  // Day 1000: 6966. Day 1500: 5466. The 1500th point ships on day 1502:
  // 5463 (day 1501: 9966 - 3*1501) + 17 payout + 2000 completion bonus - 20
  // burn = 7460. After that the contract is gone, payouts stop, and the
  // drain steepens to the full -$20/day: budget(d) = 7460 - 20(d - 1502), so
  // day 1700 = 3500, day 1874 = 20 (the last day before the clamp), and day
  // 1875 is the first zero-clamp (7460 / 20 = 373 exactly); it stays 0
  // through day 2000. The much wider margin (clamp day 1875 vs. the
  // pre-retune 1725) is the direct effect of trimming the idle burn from
  // -$5/day to -$3/day. The backlog never runs dry in this window (1500
  // start, net drain 0.5/day after debt regen, unaffected by the payout
  // change).
  it("idle mechanism: -$3/day glide, completion bonus blip at day 1502, then -$20/day to zero", () => {
    const c = fullContent();
    c.challenges = [];
    const e = new Engine(c);
    const at: Record<number, number> = {};
    for (let day = 1; day <= 2000; day++) {
      e.tick();
      if ([1000, 1500, 1502, 1700, 1874].includes(day)) at[day] = e.getState().stocks.budget;
    }
    expect(at[1000]).toBe(6966); // 9966 - 3 * 1000
    expect(at[1500]).toBe(5466); // 9966 - 3 * 1500
    expect(at[1502]).toBe(7460); // completion: 5463 + 17 + 2000 - 20
    expect(at[1700]).toBe(3500); // 7460 - 20 * 198
    expect(at[1874]).toBe(20); // 7460 - 20 * 372
    expect(e.getState().stocks.budget).toBe(0); // clamped from day 1875 on
  });

  // Full-content idle probe: same do-nothing player, challenges on. Events
  // steepen the mechanism's -$3/day (Release 9 baseline; see the mechanism
  // probe above). The idle player owns no decisions at all, so every
  // hasTag-gated content-wave challenge (model-deprecation, api-price-hike,
  // runaway-agent-loop, meeting-creep, team-conflict, cloud-credits) is
  // condition-gated out and never fires; the only new challenge that reaches
  // the idle player is open-source-windfall (minDay 15, +$400, 1%/day,
  // 60-day cooldown), a pure income boost that softens the glide. ddos is
  // additionally gated by lacksDecision "ddos-protection" (Release 9), which
  // the idle player also satisfies (owns nothing) so it still fires, just far
  // less often at its retuned 0.005 probability.
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
  it("idle with full content: challenges steepen the glide; broke by ~day 1826", () => {
    const e = new Engine(fullContent());
    let budgetAt300 = NaN;
    let budgetAt600 = NaN;
    for (let day = 1; day <= 2000; day++) {
      e.tick();
      if (day === 300) budgetAt300 = e.getState().stocks.budget;
      if (day === 600) budgetAt600 = e.getState().stocks.budget;
    }
    expect(budgetAt300).toBeLessThan(9200); // observed 8766: well off the starting 10,000
    expect(budgetAt600).toBeGreaterThan(0); // observed 7491: breathing room, no instant death
    expect(e.getState().stocks.budget).toBeLessThan(100); // observed 0 at day 2000 (first clamp day 1826)
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
  // draws. This build owns basic-dev (tagged "human"), so it also satisfies
  // meeting-creep's and team-conflict's hasTag conditions once it hires.
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
    expect(peakBudgetAfterCompletion).toBeGreaterThan(0); // observed 12203.70: a much wider breather post-retune
    expect(e.getState().stocks.budget).toBeGreaterThanOrEqual(0); // observed 12203.70 at day 2000
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
  } {
    const BUY_BUFFER = 800; // keep this much cash on hand beyond any oneTime cost
    const PROJECT_RESERVE = 600; // keep this much beyond a project's upfront cost
    const content = fullContent();
    const e = new Engine(content);
    let startedSmallCrm = false;
    let lastCompleted = 0;
    let everBroke = false;
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
      if ([500, 1000, 2000].includes(day)) budgetAtDay[day] = s.stocks.budget;
      assertInvariants(s, day);
    }
    return {
      completedProjects: e.getState().completedProjects,
      completionDays,
      budgetAtDay,
      endBudget: e.getState().stocks.budget,
      everBroke,
    };
  }

  // Human-heavy build. Observed trajectory under the tuned content: completes
  // first-contract on day 412 and small-crm on day 1804, is partway through
  // mobile-app at day 2000; budget 5254 at day 500, 5963 at day 1000, 4332 at
  // day 2000; never hits the zero-clamp. Challenge exposure is the human set
  // (sickness 110, meeting-creep 5, team-conflict 5, poached 4) plus the
  // universal ones; the human tag never triggers the darkfactory pool.
  //
  // RE-PINNED for Release 9 (global event spacing, challengeSpacingDays 50).
  // Fewer, less frequent challenges mean a materially wider margin: completes
  // first-contract on day 387 and small-crm on day 1624 (both slightly
  // earlier -- fewer drains let cash accumulate toward the next purchase
  // sooner); budget 9817 at day 500, 21702 at day 1000, 43375 at day 2000
  // (roughly 8-10x the pre-spacing margin); still never hits the zero-clamp.
  // Measured fires: sickness 19, scope-creep 6, prod-incident 4, meeting-creep
  // 4, ddos 3, team-conflict 2, key-dev-poached 2, open-source-windfall 1.
  //
  // RE-PINNED again for Release 9 (challenge retune + economy slack:
  // payoutPerPoint 15->17, ddos/api-price-hike/prod-incident/laptop-dies/
  // runaway-agent-loop all less frequent and/or cheaper -- see
  // content/challenges.json). The margin widens again, further: completes
  // first-contract on day 387 (unchanged) and small-crm on day 1625
  // (essentially unchanged -- the human track's speed is governed by hires,
  // not challenge drag); budget 12917.04 at day 500, 24802.35 at day 1000,
  // 47313.99 at day 2000 (roughly 8-10% wider than the spacing-only figures
  // above, on top of that 8-10x jump). Measured fires: sickness 23,
  // scope-creep 6, meeting-creep 4, prod-incident 2, key-dev-poached 1,
  // team-conflict 1, open-source-windfall 1 -- ddos and laptop-dies did not
  // get a turn in this run (ddos's own probability dropped to 0.005; the
  // human build carries devs the whole time so laptop-dies, gated on zero
  // human devs, was never eligible). Still never hits the zero-clamp, with
  // headroom to spare.
  it("human-heavy strategy: completes multiple projects and stays solvent over 2000 days", () => {
    const r = runBuildProbe([
      "test-suite",
      "ci-cd",
      "better-tooling",
      "basic-dev",
      "eng-manager",
      "senior-dev",
      "standup",
      "contractor",
    ]);
    expect(r.completedProjects).toBeGreaterThanOrEqual(2);
    expect(r.endBudget).toBeGreaterThan(0); // observed 47313.99 -- comfortable margin, wider still after the retune
    expect(r.everBroke).toBe(false); // observed: never zero-clamped in 2000 days
    expect(r.completionDays.length).toBeGreaterThanOrEqual(2); // observed days 387, 1625
  });

  // Automation-heavy build. Observed trajectory under the tuned content:
  // completes first-contract on day 396 and small-crm on day 1643, is partway
  // through mobile-app at day 2000; budget 2198 at day 500, 4219 at day 1000,
  // 3441 at day 2000; never hits the zero-clamp. The darkfactory tag opens its
  // own challenge pool (api-price-hike 17, runaway-agent-loop 13,
  // model-deprecation 8, cloud-credits 9) and, owning no human devs, it eats
  // laptop-dies (14) but no sickness/poaching -- a materially different risk
  // profile from the human build at a similar destination, which is the
  // track-parity design goal (viable, not identical).
  //
  // RE-PINNED for Release 9 (global event spacing, challengeSpacingDays 50).
  // Same widening effect as the human-heavy build: completes first-contract
  // on day 394 and small-crm on day 1615 (essentially unchanged from
  // pre-spacing); budget 8623 at day 500, 20465 at day 1000, 45548 at day
  // 2000 (again roughly an order of magnitude more margin); still never hits
  // the zero-clamp. Measured fires: api-price-hike 7, scope-creep 7, ddos 6,
  // model-deprecation 4, runaway-agent-loop 4, prod-incident 4, laptop-dies
  // 3, cloud-credits 2, open-source-windfall 2 -- the darkfactory pool and
  // laptop-dies (no human devs) still dominate, sickness/poaching still
  // absent, so the risk-profile contrast with the human-heavy build (the
  // track-parity design goal) survives the spacing change.
  //
  // RE-PINNED again for Release 9 (challenge retune + economy slack:
  // payoutPerPoint 15->17, cheaper agent-harness 400->250, swarm-orchestrator
  // 250->150, self-learning-agents 500->350, on top of the challenge
  // probability/value cuts). Completes first-contract on day 394 (unchanged)
  // and small-crm on day 1616 (essentially unchanged -- cheaper darkfactory
  // decisions front-load spending sooner but the shopping-list gating on
  // requires/budget dominates timing more than one day's difference); budget
  // 13073.50 at day 500, 26185.37 at day 1000, 52016.90 at day 2000 (wider
  // still than the spacing-only figures above). Measured fires:
  // model-deprecation 3, cloud-credits 3, open-source-windfall 3, scope-creep
  // 12, laptop-dies 2, ddos 1, prod-incident 10, runaway-agent-loop 2 --
  // notably prod-incident fires far more here than in the human-heavy build
  // (2 there vs. 10 here) because this build's tech debt is much higher
  // (agents/swarm compound debt faster than test-suite alone offsets), and
  // prod-incident's probScaling adds probability per 500 debt carried; that
  // debt-exposure contrast is a real, intentional difference between the two
  // tracks, not an artifact. Still never hits the zero-clamp.
  it("automation-heavy strategy: completes multiple projects and stays solvent over 2000 days", () => {
    const r = runBuildProbe([
      "test-suite",
      "ci-cd",
      "agent",
      "agent-harness",
      "swarm-orchestrator",
      "agent-swarm",
      "self-learning-agents",
      "support-retainer",
    ]);
    expect(r.completedProjects).toBeGreaterThanOrEqual(2);
    expect(r.endBudget).toBeGreaterThan(0); // observed 52016.90 -- comfortable margin, wider still after the retune
    expect(r.everBroke).toBe(false); // observed: never zero-clamped in 2000 days
    expect(r.completionDays.length).toBeGreaterThanOrEqual(2); // observed days 394, 1616
  });

  it("greedy strategy: buy everything affordable each day, invariants hold", () => {
    const content = fullContent();
    const e = new Engine(content);
    for (let day = 1; day <= 2000; day++) {
      e.tick();
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
    // No solvency or completion assertions here, deliberately -- this test
    // exercises engine invariants under maximal purchasing pressure, not
    // balance.
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
