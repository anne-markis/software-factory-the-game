# Open Decisions

Deferred design choices with their candidate solutions. Each entry names
the problem, the options considered, and the current leaning. Nothing
here is committed work.

## 1. Continuous deploy is subtle for focused builds

Recorded 2026-07-18 (Release 11). Deploy is rarely the bottleneck for
focused builds (dev contributions boost all three rates), so removing
the Done queue rarely changes their throughput; only broad builds felt
it (+26% for the buy-everything probe).

Options considered:

- Make dev/contractor contributions boost only pull and finish, so
  hiring makes Done pile up and CI/CD becomes the scaling unlock.
  Mostly content; probe retune required. Leaning: preferred headline
  for a future balance release, paired with the next option.
- Unshipped-inventory risk: work sitting in Done accrues debt or
  scales incident probability; CI/CD removes a risk source. Small
  engine hook, values in content.
- Batch releases without CI/CD (deploy fires every N days). Larger
  flow-model change; complicates idle-drain arithmetic.
- Visual-only queue surfacing. Cheapest, weakest.

## 2. Synergy-granted continuousDeploy would not activate

Recorded 2026-07-18 (Release 11). continuousDeployActive checks base
effects only; synergy selection is not recorded on the instance. No
shipped content hits this; documented in code and the authoring guide.

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
