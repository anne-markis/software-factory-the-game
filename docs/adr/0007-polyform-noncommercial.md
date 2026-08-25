# ADR 0007: PolyForm Noncommercial license

- **Status:** Accepted
- **Date:** 2026-08-14

## Context

The repo shipped with no `LICENSE`, no SPDX field, and no copyright notice.
Visitors could not tell whether reuse was allowed. We want noncommercial
reuse with clear attribution to the GitHub original, and commercial use only
via a separate deal — not OSI “open source” (MIT/Apache).

## Decision

License the repository under **PolyForm Noncommercial 1.0.0**
(`PolyForm-Noncommercial-1.0.0`). Copyright holder: **Anne Graham**.

Required notice (must travel with redistributions):

`Required Notice: Copyright Anne Graham — Software Factory (https://github.com/anne-markis/software-factory-the-game)`

Commercial licensing: open a GitHub issue on this repo tagged `licensing`.
Contributions are accepted under the same terms (inbound = outbound).

## Consequences

GitHub will not treat this as a permissive OSS license. Noncommercial forks,
modifications, and republication are allowed if they keep the license and
Required Notice. Relicensing later (e.g. to MIT) needs an explicit decision
and is harder once third parties have relied on these terms.

## Considered options

- **MIT / Apache-2.0** — rejected: allows commercial use without payment.
- **CC BY-NC** — rejected: poor fit for software; CC discourages it for code.
- **Custom short LICENSE** — rejected: reinventing terms when PolyForm already
  encodes noncommercial + notice.
