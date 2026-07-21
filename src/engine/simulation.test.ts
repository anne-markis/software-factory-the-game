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

  // Release-7 idle-drain mechanism probe. The structural requirement: doing
  // nothing must lose money on NET, not merely be exposed to challenge
  // events. With baseBurnPerDay 20 and the first contract at $17/pt (Release
  // 9 economy-slack retune) on the 1 pt/day idle throughput, steady idle
  // cashflow is 17 - 20 = -$3/day. Challenges are stripped here to pin that
  // mechanism in isolation (the full-content trajectory is probed below).
  //
  // RE-PINNED for Release 15 (tech-debt drag, debtDrag = freeDebt 400,
  // dragPerPoint 0.00015, maxDrag 0.4). The probe is NO LONGER closed-form
  // linear once drag engages, so it now pins the clean pre-drag region
  // exactly and the drag/tail region against observed checkpoints, with the
  // mechanism explained (per CONTENT-AUTHORING section 8: closed-form where
  // the arithmetic stays clean, observed-with-comment where drag makes it
  // unwieldy).
  //
  // PHASE 1 -- pre-drag, still exactly linear. The idle player ships exactly
  // 1 pt/day and grows techDebt 0.5/day (debtMultiplier 0.5). techDebt only
  // crosses freeDebt (400) at ~day 803, so while 2 <= d <~ 803 the old
  // formula holds exactly (integer flows, toBe is safe):
  //   budget(d) = 10000 - 20d + 17(d - 2) = 9966 - 3d
  // Day 500: 8466. Day 800: 7566. (Day 803 is still 7557 -- the drag on that
  // first day past the grace band is ~0.00015, far too small to move an
  // integer payout yet.)
  //
  // PHASE 2 -- drag engaged. Once techDebt > 400 the drag multiplier drops
  // below 1 and idle ships < 1 pt/day, so every subsequent day earns slightly
  // less payout than the -$3/day line would predict; the glide steepens. This
  // region is a feedback loop (less shipping -> less debt growth -> less
  // drag), so it is pinned against observed values, not a closed form. Day
  // 1000 is 6941.26 (BELOW the no-drag line's 6966 -- that gap is the drag
  // biting) and day 1500 is 5161.18 (below the no-drag 5466 -- a wider gap as
  // the drag deepens). The 1500-pt contract, which used to complete on day
  // 1502 at a clean 1 pt/day, now completes ~20 days later (day 1522) because
  // the last stretch ships slower than 1/day.
  //
  // PHASE 3 -- post-completion tail. Idle starts no new project, so after the
  // contract completes (budget ~7060 at day 1522, including the $2000 bonus)
  // there is no payout at all and the drain is the clean full -$20/day again,
  // independent of drag: budget(d) = 7060 - 20(d - 1522). Day 1700 = 3500,
  // day 1874 = 20 (last day before the clamp), day 1875 is the first zero and
  // it stays 0 through day 2000.
  it("idle mechanism: -$3/day pre-drag glide, tech-debt drag steepens it, then -$20/day tail to zero", () => {
    const c = fullContent();
    c.challenges = [];
    const e = new Engine(c);
    const at: Record<number, number> = {};
    let completionDay = 0;
    // Reputation pins (Release 17): with challenges stripped there is no
    // reputation loss anywhere, so reputation is a pure step function -- 0 until
    // the initial contract completes, then exactly its reputationReward forever
    // (idle starts no new project, so nothing else earns). Capture it either
    // side of the completion day to pin that the ONLY reputation event here is
    // the initialProject reward landing at completion.
    let repBeforeCompletion = NaN;
    let repAfterCompletion = NaN;
    for (let day = 1; day <= 2000; day++) {
      e.tick();
      const s = e.getState();
      if (completionDay === 0 && s.completedProjects >= 1) {
        completionDay = day;
        repAfterCompletion = s.stocks.reputation;
      }
      if (day === 1521) repBeforeCompletion = s.stocks.reputation; // one day before completion
      if ([500, 800, 1000, 1500, 1700, 1874].includes(day)) at[day] = s.stocks.budget;
    }
    // Reputation stays 0 through the whole pre-completion glide, then steps to
    // exactly initialProject.reputationReward (1) the moment the contract
    // completes and holds there -- no drift from the new field.
    expect(repBeforeCompletion).toBe(0);
    expect(repAfterCompletion).toBe(c.start.initialProject.reputationReward); // 1
    expect(e.getState().stocks.reputation).toBe(1); // unchanged from completion (day 1522) through day 2000
    // Phase 1: exactly linear before the drag engages.
    expect(at[500]).toBe(8466); // 9966 - 3 * 500
    expect(at[800]).toBe(7566); // 9966 - 3 * 800
    // Phase 2: drag has engaged; budget is below the no-drag line and falling
    // further behind it. These are observed values (feedback loop, no closed
    // form) but the < assertions pin the mechanism, not just the number.
    expect(at[1000]).toBeCloseTo(6941.26, 1);
    expect(at[1000]).toBeLessThan(6966); // strictly below the no-drag -$3/day line
    expect(at[1500]).toBeCloseTo(5161.18, 1);
    expect(at[1500]).toBeLessThan(5466); // the gap widens as the drag deepens
    // Drag delayed the first-contract completion past the old day-1502.
    expect(completionDay).toBe(1522);
    // Phase 3: clean -$20/day tail from ~7060 at completion.
    expect(at[1700]).toBeCloseTo(3500, 0); // 7060 - 20 * 178
    expect(at[1874]).toBeCloseTo(20, 0); // 7060 - 20 * 352
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
    milestonesSeen: string[];
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
      endReputation: e.getState().stocks.reputation,
      milestonesSeen: [...e.getState().milestonesSeen],
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
  //
  // RE-CHECKED for Release 11 (continuousDeploy replaces ci-cd's old deploy
  // x1.1 modifyRate): re-run bit-for-bit identical -- completion days 387
  // and 1625, budget 12917.04/24802.35/47313.99 at day 500/1000/2000, still
  // never zero-clamped. This build's human-hire rate stacking never pushed
  // finish rate above the old 1.1/day deploy cap either, so the structural
  // change is invisible to this probe.
  //
  // RE-PINNED for Release 15 (tech-debt drag + deploy-bottleneck rework: hires
  // now boost pull+finish only, not deploy). This build owns test-suite (halves
  // debt growth) and does no agent work, but contractor's +10% debt and the
  // sheer volume it ships still push techDebt to ~1985 by day 2000, so the
  // drag bites -- but mildly: the multiplier bottoms out at ~0.76 (24% of
  // capacity cancelled at worst), and the "limits-to-growth" archetype narrates
  // around day 1713. The system pushing back visibly narrows the margin
  // (end budget 29275.94, was 47313.99) and pushes small-crm's completion out
  // to day 1774 (was 1625), but the build stays comfortably viable: completes
  // 2 projects (days 387, 1774), budget 12812/22148/29275 at day 500/1000/2000,
  // never zero-clamped. The deploy-rework is invisible here (this build's finish
  // rate was never deploy-bound; continuous deploy via ci-cd ships Done anyway).
  //
  // RE-PINNED for Release 17 (reputation). The build earns reputation on
  // completion (first-contract +1, small-crm +5) and loses it to incidents
  // (prod-incident -2, security-breach -5). Its techDebt (~1985) crosses
  // security-breach's minTechDebt 800 gate only late, so it takes exactly ONE
  // breach, at day 1746 -- shaving end budget by that breach's $300 (29275.94
  // -> 28975.94) and nothing else; day 500/1000 budgets are bit-identical to
  // Release 15 (12812.28 / 22148.66) and both completion days are unchanged
  // (387, 1774). Incident reputation losses eat the +1 from first-contract, so
  // reputation lands at exactly small-crm's +5 by day 2000 -- precisely the
  // "trusted" milestone threshold. The reputation gate does NOT wall this build
  // off any contract it reached pre-reputation: it completes small-crm (ungated)
  // and rolls into mobile-app (gate 5) with reputation exactly 5.
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
    expect(r.endBudget).toBeGreaterThan(0); // observed 28975.94 -- one $300 breach below the pre-reputation 29275.94
    expect(r.everBroke).toBe(false); // observed: never zero-clamped in 2000 days
    expect(r.completionDays.length).toBeGreaterThanOrEqual(2); // observed days 387, 1774
    // The reinforcing loop is exercised: completing lower contracts earns
    // reputation (observed end 5). Assert only that reputation was earned at
    // all; the exact end value is knife-edge on incident timing relative to the
    // last completion, so the sticky milestone below is the robust loop proof.
    expect(r.endReputation).toBeGreaterThanOrEqual(1);
    expect(r.milestonesSeen).toContain("trusted"); // crossed the first milestone by day 2000
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
  //
  // RE-CHECKED for Release 11 (continuousDeploy replaces ci-cd's old deploy
  // x1.1 modifyRate): re-run bit-for-bit identical -- completion days 394
  // and 1616, budget 13073.50/26185.37/52016.90 at day 500/1000/2000, still
  // never zero-clamped. Like the human-heavy build, this track's finish
  // rate (agent/swarm additive contributions, self-learning-agents' ramp
  // capped at 1.4/day) never actually exceeded the old 1.1/day deploy cap,
  // so the structural change is invisible to this probe too.
  //
  // RE-PINNED for Release 15 (tech-debt drag). This build ships the most and
  // carries the most debt-raising capacity (agent + agent-swarm), so even with
  // its full mitigation stack (test-suite, agent-harness, swarm-orchestrator)
  // its techDebt reaches ~2489 by day 2000 -- the highest of any viable probe
  // -- and the drag multiplier bottoms out near 0.69 (31% cancelled), with the
  // "limits-to-growth" archetype narrating earlier, around day 1308. As with
  // the human build this narrows the margin (end budget 26562.84, was 52016.90)
  // and delays small-crm to day 1856 (was 1616), but the mitigation keeps the
  // drag off its 0.6 floor and the build stays solvent: completes 2 projects
  // (days 395, 1856), budget 12698/21770/26562 at day 500/1000/2000, never
  // zero-clamped.
  //
  // RE-PINNED for Release 17 (reputation). This build carries the highest
  // techDebt of any viable probe (~2490), so it is the most breach-exposed: it
  // takes FOUR security breaches (days 607, 1124, 1633, 1845), each -$300 and
  // -5 reputation. Those four $300 hits (plus their earlier timing dragging on
  // compounding) pull end budget from 26562.84 to 25187.30 and day-1000 budget
  // from 21770 to 21470.89; day 500 (12698.68) and both completion days (395,
  // 1856) are unchanged (debt only reaches the 800 breach gate after day 500).
  // Despite the breach reputation bleed, completing first-contract (+1) and
  // small-crm (+5) lands reputation at exactly 5 by day 2000 -- the "trusted"
  // milestone -- so the reinforcing loop is exercised and the build is not
  // walled off the mobile-app tier (gate 5) it rolls into. This is the spiral
  // held at a survivable amplitude for a well-mitigated build: real cost, no
  // collapse (contrast the greedy build below, where it does bite hard).
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
    expect(r.endBudget).toBeGreaterThan(0); // observed 25187.30 -- four $300 breaches below the pre-reputation 26562.84
    expect(r.everBroke).toBe(false); // observed: never zero-clamped in 2000 days
    expect(r.completionDays.length).toBeGreaterThanOrEqual(2); // observed days 395, 1856
    // Reinforcing loop exercised even under the heaviest breach load
    // (observed end 5). Knife-edge on breach timing, so assert only that
    // reputation was earned; the sticky milestone below is the robust proof.
    expect(r.endReputation).toBeGreaterThanOrEqual(1);
    expect(r.milestonesSeen).toContain("trusted"); // crossed the first milestone by day 2000
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
