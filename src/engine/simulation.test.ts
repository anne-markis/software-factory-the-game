import { describe, it, expect } from "vitest";
import { Engine } from "./engine";
import { applyEffects } from "./effects";
import { effectiveRate } from "./modifiers";
import { loadShippedContent } from "./loadShippedContent";
import { surplusGrewWhileInFlight, surplusWork, workLedgerIssues } from "./work";
import type { Effect, GameContent, GameState } from "./types";

function fullContent(): GameContent {
  return loadShippedContent();
}

const STUDIO_FOLLOW_ON = [
  "ship-v1",
  "ship-v2",
  "ship-v3",
  "ship-v4",
  "ship-v5",
  "gig-bugfix",
  "gig-landing-page",
  "gig-plugin",
];

function startNextStudioWork(e: Engine, reserve = 0): void {
  const s = e.getState();
  if (s.projects.length > 0) return;
  for (const id of STUDIO_FOLLOW_ON) {
    const w = e.availableProjects().find((p) => p.def.id === id);
    if (w?.startable && s.stocks.budget >= w.def.upfrontCost + reserve) {
      e.startProject(id);
      return;
    }
  }
}

type WorkSnap = Pick<GameState, "stocks" | "projects" | "completedProjects">;

function snapshotWork(s: Readonly<GameState>): WorkSnap {
  return {
    stocks: { ...s.stocks },
    projects: s.projects.map((p) => ({ ...p })),
    completedProjects: s.completedProjects,
  };
}

function assertInvariants(s: Readonly<GameState>, day: number, prev?: WorkSnap): void {
  for (const [name, v] of Object.entries(s.stocks)) {
    expect(v, `stock ${name} at day ${day}`).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(v), `stock ${name} finite at day ${day}`).toBe(true);
  }
  expect(s.pointsPerDay).toBeGreaterThanOrEqual(0);
  expect(workLedgerIssues(s), `work ledger at day ${day}`).toEqual([]);
  if (prev && surplusGrewWhileInFlight(prev, s)) {
    expect.fail(
      `day ${day}: surplus grew while a project was in flight (${surplusWork(prev)} → ${surplusWork(s)}); pipeline inflow was not attached to remaining`,
    );
  }
}

function ledgerWatcher(): (s: Readonly<GameState>, day: number) => void {
  let prev: WorkSnap | undefined;
  return (s, day) => {
    assertInvariants(s, day, prev);
    prev = snapshotWork(s);
  };
}

describe("simulation", () => {
  it("idle strategy: 2000 days with full content violates no invariants", () => {
    const e = new Engine(fullContent());
    const check = ledgerWatcher();
    for (let day = 1; day <= 2000; day++) {
      e.tick();
      check(e.getState(), day);
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
    const check = ledgerWatcher();
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
      check(s, day);
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

  // Full-content idle probe: same do-nothing player, challenges on.
  //
  // RE-PINNED for the lean Studio pool (issue #89). The pool is now three
  // events, two of which (model-deprecation, runaway-agent-loop) are gated on
  // owning something from the agent ladder -- so the idle player, which owns
  // nothing, only ever sees scope-creep, and only after the beta ships
  // (minCompletedProjects 1). After the beta there is no in-flight project, so
  // scope creep is unattributed surplus (ADR 0009) and cannot change the beta's
  // completion day. The idle trajectory is nearly the challenge-free one: the
  // beta still completes on day 302 and the +$800 bonus is still the only
  // income the run ever sees.
  //
  // RE-PINNED for content wave (release 8, task 4.5): challenge rolls are now
  // hashed per challenge (hashRoll on gameSeed/day/id) instead of drawn
  // positionally from the shared rng stream, and the challenge phase no longer
  // consumes that stream at all. This deliberately changes which challenge
  // days land (a fresh, content-stable draw of the same probabilities). The
  // point of the refactor is that these values no longer move when a
  // challenge is added or reordered in content.
  //
  // Studio spine (issue #88): the idle player owns no monetization decisions,
  // so its +30 users (and organic growth after the beta) never turn into
  // income -- the beta's $800 bonus is the only cash the run ever sees against
  // a steady -$20/day base burn, and it drains to zero well within the horizon.
  // The Release 9 challenge-retune measurements that used to live here (fire
  // counts for ddos/prod-incident/laptop-dies/open-source-windfall) are gone
  // with those challenges; the assertions below pin the shape, not exact
  // challenge-dependent values.
  it("idle with full content: no monetization means the users grant never pays off; drains to zero within the horizon", () => {
    const e = new Engine(fullContent());
    const check = ledgerWatcher();
    let budgetAt300 = NaN;
    let completionDay = 0;
    let sawUsers = false;
    for (let day = 1; day <= 2000; day++) {
      e.tick();
      const s = e.getState();
      check(s, day);
      if (completionDay === 0 && s.completedProjects >= 1) completionDay = day;
      if (s.stocks.users > 0) sawUsers = true;
      if (day === 300) budgetAt300 = s.stocks.budget;
    }
    expect(completionDay).toBe(302); // the beta completes on schedule
    expect(sawUsers).toBe(true); // the users economy did switch on at launch
    expect(budgetAt300).toBeLessThan(4200); // pre-completion glide, well off 10,000 (observed 4000: no cash event reaches an idle Studio)
    expect(budgetAt300).toBeGreaterThan(0); // no instant death
    expect(e.getState().stocks.budget).toBeLessThan(100); // broke by day 2000 (observed 0, first clamp ~day 540)
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
  //
  // RE-PINNED for the lean Studio shop (issue #89), and the "choices matter"
  // point this probe originally made is back: this build buys delivery
  // (test-suite, ci-cd) and two hires but NO monetization, and monetization is
  // the Studio money spine. Observed now: the Launch beta completes on day 205
  // (each hire's gamble lifts pull and finish by the same amount, so this build
  // ships 2.5 pt/day and beats idle's day 302), then it works small-crm at
  // $20/pt -- but the two hires' payroll plus base burn outrun that trickle and
  // it hits the zero clamp on day 279 and stays there (budgetAt1000 0, end 0,
  // post-completion peak 601, ~1508 points shipped over the run). Scope creep is
  // the only event it ever sees; nothing else in the lean pool is eligible for a
  // build with no agents. Unchanged by the pull headroom this issue added, since
  // finish is this build's binding stage either way. The existing assertions are
  // loose enough to hold unchanged (they never asserted solvency); this stays an
  // observation probe, and the viability bars are the two probes below.
  it("smart strategy (mid-tier observation): completes the beta, then runs dry without monetization", () => {
    const content = fullContent();
    const e = new Engine(content);
    const check = ledgerWatcher();
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
      // Continuation: version ladder first, then a tiny gig as cash relief.
      startNextStudioWork(e);
      for (const pc of [...s.pendingChoices]) {
        const def = content.challenges.find((c) => c.id === pc.challengeId)!;
        e.resolveChoice(pc.challengeId, def.choice!.options[0].id);
      }
      if (completionDay === 0 && s.completedProjects >= 1) completionDay = day;
      if (completionDay > 0) peakBudgetAfterCompletion = Math.max(peakBudgetAfterCompletion, s.stocks.budget);
      if (day === 1000) budgetAt1000 = s.stocks.budget;
      check(s, day);
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
  //
  // Issue #89: the list is count-aware. `agent` is stackable now, so a repeated
  // id means "own that many copies" -- the nth occurrence is only satisfied
  // once n instances are owned. Non-repeated ids behave exactly as before.
  function runBuildProbe(shoppingList: string[], opts: { onlyAfterLaunch?: boolean } = {}): {
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
    const check = ledgerWatcher();
    let lastCompleted = 0;
    let everBroke = false;
    let peakUsers = 0;
    const completionDays: number[] = [];
    const budgetAtDay: Record<number, number> = {};
    for (let day = 1; day <= 2000; day++) {
      e.tick();
      const s = e.getState();
      const ownedCount = (id: string) => s.decisions.filter((d) => d.defId === id).length;
      const wanted = new Map<string, number>();
      // onlyAfterLaunch: hold every purchase until the Launch beta ships. A
      // strategy parameter, not an engine knob -- pre-launch there is no
      // revenue at all (the beta pays $0/pt), so a player who spends into
      // upkeep before launch is spending down a fixed starting purse.
      const list = opts.onlyAfterLaunch && s.completedProjects < 1 ? [] : shoppingList;
      for (const id of list) {
        wanted.set(id, (wanted.get(id) ?? 0) + 1);
        if (ownedCount(id) >= wanted.get(id)!) continue;
        const a = e.availableDecisions().find((x) => x.def.id === id);
        if (!a || a.code === "missing-requires") break; // wait for the prerequisite
        const oneTime = a.def.cost.oneTime ?? 0;
        if (a.purchasable && s.stocks.budget >= oneTime + BUY_BUFFER) e.applyDecision(id);
        break; // strict priority: never skip ahead in the list
      }
      startNextStudioWork(e, PROJECT_RESERVE);
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
      check(s, day);
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
  // RE-PINNED for the lean Studio shop (issue #89): the org ladder
  // (eng-manager, senior-dev, standup, contractor) left Studio, so "human
  // heavy" is now better-tooling plus two basic-dev hires -- the only cards that
  // lift several rates at once (better-tooling all three, each hire pull and
  // finish together), which is why this build ships fastest of the three.
  //
  // Observed: completes the Launch beta on day 149, then works small-crm the
  // rest of the run without finishing it (completedProjects stays 1, ~2823 of
  // 5000 points shipped). The subscription (users * $0.75/day at the ~160-user
  // steady state ≈ $120/day) dwarfs the ~$34-54/day burn, so budget climbs
  // steadily -- 37269 at day 500, 100435 at day 1000, 229276 at day 2000 --
  // and it never hits the zero-clamp. Reputation ends at 1 (the beta's grant;
  // the lean pool has no reputation hit left, and no rep-earning contract
  // completes), so no milestone is crossed. Loose bounds pin the shape
  // (solvent + monetized), not challenge-knife-edge exact values.
  it("human-heavy strategy: finishes the beta and stays solvent via monetization over 2000 days", () => {
    const r = runBuildProbe([
      "test-suite",
      "ci-cd",
      "subscription",
      "one-time-product",
      "better-tooling",
      "basic-dev",
      "basic-dev",
    ]);
    expect(r.completedProjects).toBeGreaterThanOrEqual(1); // finished the Launch beta (observed day 149)
    expect(r.everBroke).toBe(false); // observed: never zero-clamped in 2000 days
    expect(r.peakUsers).toBeGreaterThan(100); // users economy switched on and grew (observed ~160)
    // Monetization is the money spine: subscription income lifts the budget far
    // above the starting 10,000 (observed end ~229,276). Loose lower bound.
    expect(r.endBudget).toBeGreaterThan(50000);
    expect(r.budgetAtDay[2000]).toBeGreaterThan(r.budgetAtDay[500]!); // still climbing on subscription income
  });

  // Automation-heavy build, RE-PINNED for the lean Studio shop (issue #89).
  // The shopping list is now the Studio agent ladder -- 2 agents, harness,
  // orchestration (which the ≥2-agent count gate opens), then 2 more agents --
  // plus the two monetization cards and the delivery pair.
  //
  // WHY IT IS LAUNCH-GATED (onlyAfterLaunch): the ladder is affordable from day
  // 1 and does speed the beta up, but paying for it out of the starting purse is
  // what breaks. The Launch beta pays $0/pt, so pre-launch income is exactly $0
  // against a $20/day base burn, and the ladder's upkeep (4 agents x $4 +
  // harness $5 + orchestration $12 = $33/day) nearly triples it. Measured on the
  // un-gated list: the beta lands early (day 175, against 302 patient) but the
  // budget hits the zero clamp on day 133 first, and payroll failure strips the
  // agents, the harness and orchestration over days 133-134. It recovers after
  // launch and re-buys them, so it is a real (if bruising) strategy rather than a
  // dead end -- but it does hit the clamp, which is what this viability bar is
  // about, so the probe plays the patient version.
  //
  // Holding purchases until the beta ships (day 302 on starting resources alone,
  // which is the Studio solvency rule) and buying the ladder out of subscription
  // income keeps it clear of the clamp: budget 12415 at day 500, 65095 at day
  // 1000, 171501 at day 2000, users at the ~160 steady state, all 10 cards owned
  // at the end.
  //
  // As in the human-heavy probe the 5000-point small-crm does not finish inside
  // the horizon (observed ~2519 points shipped in total): the Studio bar is the
  // beta plus solvency, and the big client ladder is a later era. Loose bounds
  // pin the shape (solvent + monetized), not exact values.
  it("automation-heavy strategy: finishes the beta and stays solvent via monetization over 2000 days", () => {
    const r = runBuildProbe(
      [
        "subscription",
        "one-time-product",
        "agent",
        "agent",
        "agent-harness",
        "agent-orchestration",
        "agent",
        "agent",
        "test-suite",
        "ci-cd",
      ],
      { onlyAfterLaunch: true },
    );
    expect(r.completedProjects).toBeGreaterThanOrEqual(1); // finished the Launch beta (observed day 302)
    expect(r.everBroke).toBe(false); // observed: never zero-clamped in 2000 days
    expect(r.peakUsers).toBeGreaterThan(100); // users economy switched on and grew (observed ~160)
    expect(r.endBudget).toBeGreaterThan(50000); // monetization lifts budget far above 10,000 (observed ~171,501)
    expect(r.budgetAtDay[2000]).toBeGreaterThan(r.budgetAtDay[500]!); // still climbing on subscription income
  });

  // The agent ladder's payoff, measured in two halves (issue #89). The locked
  // agent knobs (#86) are all finish-side -- each agent adds +0.2 finish, the
  // harness multiplies finish x1.25, orchestration x1.45 -- and throughput in
  // tick.ts is the minimum across the three stages. So what the ladder buys
  // depends entirely on which stage is binding, and the shop only makes sense if
  // finish-side capacity can eventually reach the shipped stock.
  //
  // Base rates are pull 2, finish 1, deploy 1 (the pull headroom this issue
  // added). Nothing in the lean shop lifts pull except better-tooling (+0.1) and
  // the hire (whose gamble adds the same amount to pull and finish), so pull's
  // extra point is what the ladder eats into. Deploy is the wall behind it, and
  // the way past that wall is structural rather than a rate: test-suite -> ci-cd
  // switches on continuous deploy, which drops the Done stage entirely.
  //
  // Two builds, both isolated from challenges so no event luck enters a
  // two-build comparison, both run for 120 days -- inside the beta (no
  // debt->backlog regen yet) and well before the ladder's upkeep runs it dry, so
  // these compare throughput rather than survival.
  const ladderWindow = 120;
  function ladderBuild(opts: { ladder: boolean; continuousDeploy: boolean }): Engine {
    const content = fullContent();
    content.challenges = [];
    const e = new Engine(content);
    if (opts.continuousDeploy) {
      e.applyDecision("test-suite");
      e.applyDecision("ci-cd");
    }
    if (opts.ladder) {
      for (let i = 0; i < 4; i++) e.applyDecision("agent");
      e.applyDecision("agent-harness");
      e.applyDecision("agent-orchestration");
    }
    return e;
  }

  // Half one: before ci-cd, the ladder ships no more than an idle factory --
  // deploy's 1.0/day is the wall. That is not a lie in the shop as long as the
  // player can SEE what they bought, and they can: the pile moves. Idle piles up
  // In Progress (finish is the constraint); the ladder drains In Progress and
  // piles up Done instead (deploy is now the constraint). The loop diagram reads
  // a growing box as the bottleneck, so this is the game pointing at the
  // test-suite -> ci-cd branch as the next thing to buy.
  it("without continuous deploy, the agent ladder moves the bottleneck from finish to deploy rather than shipping more", () => {
    const idle = ladderBuild({ ladder: false, continuousDeploy: false });
    const ladder = ladderBuild({ ladder: true, continuousDeploy: false });

    // Finish capacity is more than tripled, and now exceeds every other stage.
    expect(effectiveRate(ladder.getState(), "finish")).toBeCloseTo(3.2625, 4);
    expect(effectiveRate(ladder.getState(), "pull")).toBe(2);
    expect(effectiveRate(ladder.getState(), "deploy")).toBe(1);
    expect(effectiveRate(idle.getState(), "finish")).toBe(1);

    for (let day = 1; day <= ladderWindow; day++) {
      idle.tick();
      ladder.tick();
    }
    const i = idle.getState();
    const l = ladder.getState();
    expect(l.stocks.shipped).toBe(i.stocks.shipped); // observed: 118 both -- deploy-bound
    expect(l.stocks.budget).toBeLessThan(i.stocks.budget); // 2950 vs 7600: the upkeep is real
    // The teaching: the pile the player is staring at moves downstream.
    expect(i.stocks.inProgress).toBeGreaterThan(100); // 121: finish cannot keep up with pull
    expect(i.stocks.done).toBeLessThan(2); // 1: deploy clears everything finish hands it
    expect(l.stocks.inProgress).toBeLessThan(3); // 2: the agents absorb all of pull
    expect(l.stocks.done).toBeGreaterThan(100); // 120: finished work waiting on a deploy
    // And the debt half of the ladder lands regardless of the bottleneck.
    expect(l.stocks.techDebt).toBeLessThan(i.stocks.techDebt); // 41 vs 59
  });

  // Half two: with continuous deploy bought, the Done stage is gone and
  // throughput is min(pull, finish) -- so the ladder finally spends its finish
  // capacity, up to pull's 2.0/day ceiling. Roughly double an idle factory's
  // output over the same window: the ladder is not a trap, it is the second half
  // of a two-part purchase.
  it("with ci-cd owned, the full agent ladder ships about twice what an idle factory does", () => {
    const idle = ladderBuild({ ladder: false, continuousDeploy: true });
    const ladder = ladderBuild({ ladder: true, continuousDeploy: true });
    for (let day = 1; day <= ladderWindow; day++) {
      idle.tick();
      ladder.tick();
    }
    const i = idle.getState();
    const l = ladder.getState();
    expect(l.stocks.shipped).toBeGreaterThan(i.stocks.shipped * 1.9); // observed 230.5 vs 116
    expect(l.pointsPerDay).toBeCloseTo(2, 5); // pull's ceiling, not finish's 3.26
    expect(i.pointsPerDay).toBeCloseTo(1, 5); // finish's, unimproved
    // Debt cuts both ways once the capacity is real: the ladder's multiplier is
    // far lower per point (0.35 vs 0.5), but it ships twice the points, so the
    // stock still grows faster in absolute terms -- the Limits to Growth loop
    // arrives sooner for the fast factory, which is the intended lesson.
    expect(l.stocks.techDebt).toBeGreaterThan(i.stocks.techDebt); // 40 vs 29
  });

  // Issue #89 acceptance: a SHORT Studio session on the lean shop has to hold
  // together end to end. This plays the sensible one -- monetize first, ship the
  // Launch beta on starting resources, then buy the agent ladder out of
  // subscription income -- and pins what a player sees along the way:
  //
  //   d1-d2   subscription + one-time-product (one-time cost, no upkeep, and
  //           worth nothing yet at 0 users -- the setup a Studio player makes
  //           before there is anything to sell)
  //   d302    Launch beta completes: +$800, +1 reputation, +30 users, and the
  //           users economy (and with it the subscription) switches on
  //   d302-05 the agent ladder, one card a day, in the order the gates imply:
  //           agent, agent, then the harness, then orchestration -- which is
  //           only offered once the second agent lands (requiresCounts 2x)
  //   end     solvent the whole way after launch (budget bottoms out at ~3129
  //           and ends ~11925 at day 500) with all six cards still owned
  //
  // The pre-launch-spend version of this session is the one that hurts, and it
  // is measured in the automation-heavy probe above rather than duplicated here.
  it("short Studio session: monetize, ship the beta, then unlock the agent ladder in gate order", () => {
    const content = fullContent();
    const e = new Engine(content);
    const check = ledgerWatcher();
    const monetization = ["subscription", "one-time-product"];
    const ladder = ["agent", "agent", "agent-harness", "agent-orchestration"];
    const buys: string[] = [];
    let completedDay = 0;
    let minBudgetAfterLaunch = Infinity;
    let orchestrationOfferedWithOneAgent = false;
    for (let day = 1; day <= 500; day++) {
      e.tick();
      const s = e.getState();
      if (completedDay === 0 && s.completedProjects >= 1) completedDay = day;
      const ownedCount = (id: string) => s.decisions.filter((d) => d.defId === id).length;
      // The count gate must never open early: one agent is not two.
      if (ownedCount("agent") === 1) {
        const orch = e.availableDecisions().find((a) => a.def.id === "agent-orchestration")!;
        if (orch.purchasable) orchestrationOfferedWithOneAgent = true;
      }
      const wanted = new Map<string, number>();
      for (const id of s.completedProjects >= 1 ? [...monetization, ...ladder] : monetization) {
        wanted.set(id, (wanted.get(id) ?? 0) + 1);
        if (ownedCount(id) >= wanted.get(id)!) continue;
        const a = e.availableDecisions().find((x) => x.def.id === id)!;
        if (a.purchasable && s.stocks.budget >= (a.def.cost.oneTime ?? 0) + 800) {
          e.applyDecision(id);
          buys.push(`d${day}:${id}`);
        }
        break; // strict priority: one purchase a day, never skip ahead
      }
      for (const pc of [...s.pendingChoices]) {
        const def = content.challenges.find((c) => c.id === pc.challengeId)!;
        e.resolveChoice(pc.challengeId, def.choice!.options[0].id);
      }
      if (completedDay > 0) minBudgetAfterLaunch = Math.min(minBudgetAfterLaunch, s.stocks.budget);
      check(s, day);
    }
    expect(buys).toEqual([
      "d1:subscription",
      "d2:one-time-product",
      "d302:agent",
      "d303:agent",
      "d304:agent-harness",
      "d305:agent-orchestration",
    ]);
    expect(orchestrationOfferedWithOneAgent).toBe(false);
    expect(completedDay).toBe(302); // the Studio beta spine (issue #88) is untouched by the shop retune
    const s = e.getState();
    expect(s.decisions.filter((d) => d.defId === "agent")).toHaveLength(2); // stackable, and both survived payroll
    expect(minBudgetAfterLaunch).toBeGreaterThan(1000); // never near the zero clamp (observed ~3129)
    expect(s.stocks.budget).toBeGreaterThan(10000); // subscription outruns the ladder's upkeep (observed ~11,925)
    // Only the lean pool can fire, and scope-creep waits for the launch
    // (minCompletedProjects 1) rather than a calendar day.
    for (const id of Object.keys(s.challengeLastFired)) {
      expect(["scope-creep", "model-deprecation", "runaway-agent-loop"]).toContain(id);
    }
    expect(s.challengeLastFired["scope-creep"] ?? Infinity).toBeGreaterThan(completedDay);
  });

  it("greedy strategy: buy everything affordable each day, invariants hold", () => {
    const content = fullContent();
    const e = new Engine(content);
    const check = ledgerWatcher();
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
      check(e.getState(), day);
    }
    // sanity: the factory actually did something
    expect(e.getState().stocks.shipped).toBeGreaterThan(100);

    // RE-PINNED for the lean Studio shop (issue #89). This probe's loop buys
    // at most ONE instance of each def, and the lean shop is nine cards, of
    // which exactly one (the single agent it allows itself) raises debt while
    // three cut it (test-suite, agent-harness, and -- unreachable here, since
    // the count gate wants two agents -- orchestration). So greedy's debt no
    // longer balloons: 794 techDebt at day 2000, not far past the 400 free
    // band, and no archetype narrates at all (archetypesSeen is empty). The old
    // Release 15 assertions -- an early peak above 5 pt/day collapsing to under
    // half of it -- described a shop with agent-swarm (x1.8 all rates),
    // self-learning ramps and three hire tiers, none of which is in Studio:
    // measured peak is now 2.80 pt/day (day 130) and end 1.76 pt/day, and the
    // decline is the users support drag as much as debt.
    //
    // Rather than re-pin a lesson this content does not teach, the throughput
    // assertions are reduced to what greedy still demonstrates here: capacity
    // above the base 1 pt/day, and a decline from its own peak by day 2000.
    // The limits-to-growth lesson lives in the archetype unit tests.
    expect(peakPointsPerDay).toBeGreaterThan(1.5); // observed 2.80 (day 130)
    expect(e.getState().pointsPerDay).toBeLessThan(peakPointsPerDay); // observed 1.76 at day 2000
    // No solvency or completion assertions here, deliberately -- this test
    // exercises engine invariants under maximal purchasing pressure, not
    // balance. (Observed: 1 completion, shipped ~3782, budget ~246,058 --
    // subscription income at the ~160-user steady state dwarfs the lean shop's
    // upkeep, so buying everything is comfortably solvent in Studio.)
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
  //
  // RE-PINNED for the lean Studio pool (issue #89): security-breach, the
  // challenge that used to supply the reputation hit, is out of Studio, so the
  // hit is applied as a literal effects pair here. The mechanism under test is
  // projectAvailability's live reputation gate, not any one challenge, and the
  // -5/-300 shape is the one a later era's breach card is expected to carry.
  it("downward spiral: a reputation hit re-locks a tier the build had unlocked", () => {
    const content = loadShippedContent("company");
    const e = new Engine(content);
    // Stage a Company build sitting on the first reputation-gated client
    // (big-migration: 1 completion AND 5 reputation). Plenty of budget so
    // affordability is never the binding reason.
    const s = e.getState() as GameState;
    s.completedProjects = 1;
    s.completedProjectIds = ["launch-beta"];
    s.stocks.reputation = 5;
    s.stocks.budget = 100000;

    const migrationAt = () => e.availableProjects().find((p) => p.def.id === "big-migration")!;
    expect(migrationAt().startable).toBe(true);
    expect(migrationAt().reason).toBeUndefined();

    const breachEffects: Effect[] = [
      { type: "addToStock", stock: "budget", value: -300 },
      { type: "addToStock", stock: "reputation", value: -5 },
    ];
    applyEffects(s, breachEffects, "spiral-test");
    expect(s.stocks.reputation).toBe(0);

    const relocked = migrationAt();
    expect(relocked.startable).toBe(false);
    expect(relocked.reason).toBe("requires 5 reputation");

    applyEffects(s, breachEffects, "spiral-test-2");
    expect(s.stocks.reputation).toBe(0);
    expect(migrationAt().startable).toBe(false);
    expect(migrationAt().reason).toBe("requires 5 reputation");
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
    //  - challenges.json fires random events (e.g. scope-creep: +75 backlog)
    //    regardless of the player's budget.
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
    c.projects = []; // $0 tiny gigs would otherwise keep a relief valve open
    c.start.debtMultiplier = 0;
    c.start.stocks.backlog = 3;
    c.start.stocks.budget = 10;
    c.start.initialProject.sizePoints = 3;
    // Zero the payout so completing the initial project does not inject cash.
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
