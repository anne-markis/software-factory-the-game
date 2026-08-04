# Open Decisions

Deferred design choices with their candidate solutions. Each entry names
the problem, the options considered, and the current leaning. Nothing
here is committed work.

## 1. Continuous deploy is subtle for focused builds -- RESOLVED

Recorded 2026-07-18 (Release 11). Deploy is rarely the bottleneck for
focused builds (dev contributions boost all three rates), so removing
the Done queue rarely changes their throughput; only broad builds felt
it (+26% for the buy-everything probe).

Resolved 2026-07-20 (Release 15) with the first option: dev, senior-dev,
and contractor rate contributions now boost only pull and finish, not
deploy. Without ci-cd a strong human build outruns its own deploy stage,
Done piles up, and shipping stays pinned at the base deploy rate; ci-cd
(continuous deploy) is the scaling unlock that lets shipping track finish
again. better-tooling deliberately keeps its all-rates boost (tooling
plausibly speeds releases too), and the support-retainer / poached /
meeting-creep slowdowns keep their all-rates reach (a slowdown hits
everything). Pinned by content.test.ts and a tick-level probe in
tick.test.ts; the strategy probes were retuned alongside the Release 15
tech-debt drag.

Still-open follow-up (not taken in Release 15): the unshipped-inventory
risk option below. Work sitting in Done today accrues no penalty, so a
build that lets Done pile up (strong hires, no ci-cd) is slower but not
otherwise punished. Making Done accrue debt or scale incident
probability would give the bottleneck a second cost and make ci-cd a
risk-remover as well as a throughput unlock. Deferred.

Options considered:

- Make dev/contractor contributions boost only pull and finish, so
  hiring makes Done pile up and CI/CD becomes the scaling unlock.
  Mostly content; probe retune required. CHOSEN (Release 15).
- Unshipped-inventory risk: work sitting in Done accrues debt or
  scales incident probability; CI/CD removes a risk source. Small
  engine hook, values in content. STILL OPEN (follow-up above).
- Batch releases without CI/CD (deploy fires every N days). Larger
  flow-model change; complicates idle-drain arithmetic.
- Visual-only queue surfacing. Cheapest, weakest.

## 2. Synergy-granted continuousDeploy would not activate

Recorded 2026-07-18 (Release 11). continuousDeployActive checks base
effects only, deliberately: activation is a definition-level property,
not a purchase-time numeric swap. No shipped content hits this;
documented in code and the authoring guide. Updated 2026-08-04 (issue
#14): the applied synergy provider IS now recorded on the instance as
DecisionInstance.appliedSynergyIfOwned, so the second option below is
available should this ever need to change -- continuousDeployActive
still ignores it on purpose.

Options considered:

- Validation guard: validateContentGraph rejects continuousDeploy
  inside synergy effects lists. Leaning: do this first, low cost.
- Record the applied synergy on the DecisionInstance at purchase and
  derive activation from the recorded choice. General, small save
  migration.
- Marker-modifier redesign: structural effects push a marker modifier
  at purchase; activation reads state. Cleanest long term; worth doing
  when a second structural effect or a real synergy use case exists.

## 3. Per-stage inner loops for every SDLC stage

Recorded 2026-07-18. The Progress loop panel decomposes In Progress
only. The loops-of-loops framing eventually wants Backlog, Done (while
it exists), and Shipped to each expose an inner loop with its own
contributors. Deferred until the In Progress inner-loop presentation
proves itself.
