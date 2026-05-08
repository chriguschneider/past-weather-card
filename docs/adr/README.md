# Architecture Decision Records

This directory captures the **why** behind non-obvious architectural choices in
this card. Code shows *what* the implementation does; ADRs explain *why* a
particular path was chosen and what alternatives were rejected.

## When to write one

Write an ADR when a decision is:

- **Hard to reverse** — package upgrades, bundler swaps, public-API shape, data-source contracts.
- **Surprising without context** — choices a future reader (or future Claude) would otherwise undo by accident.
- **Cross-cutting** — touches multiple modules and can't be explained inside a single file's header comment.

Skip the ADR for routine bug fixes, refactors that don't change a contract, or
decisions whose rationale already lives in the commit message.

## How to add one

1. Copy [`template.md`](./template.md) to a new file.
2. Number it with the next free four-digit prefix and a `kebab-case` slug:
   `0001-some-decision.md`, `0002-another-one.md`, …
3. Fill in **Status**, **Date** (YYYY-MM-DD), **Context**, **Decision**, **Consequences**, **Related**.
4. Land it via the normal PR flow — ADRs are versioned with the code they describe.

## Status lifecycle

- **Proposed** — under discussion; not yet acted on.
- **Accepted** — in force; the codebase reflects this decision.
- **Deprecated** — no longer applies, but kept for historical context.
- **Superseded by NNNN** — replaced by a later ADR; link forward.

ADRs are append-only — once accepted, don't rewrite history. If a decision
changes, write a new ADR that supersedes the old one and update the old one's
status line.

## Index

- [0001 — Commit `dist/weather-station-card.js` alongside source](./0001-dist-committed-for-hacs.md) (Accepted)
- [0002 — Sunshine duration: tiered data-source policy](./0002-sunshine-duration-tier-policy.md) (Accepted)
- [0003 — E2E visual-regression baselines pinned to the GHA Ubuntu runner](./0003-e2e-baselines-pinned-to-gha.md) (Accepted)
- [0004 — TypeScript: strict for leaf modules, `any` allowed at the HA boundary](./0004-typescript-strict-with-boundary-relaxations.md) (Accepted)
