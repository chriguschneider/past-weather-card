# 0004: TypeScript — strict for leaf modules, `any` allowed at the HA boundary

**Status:** Accepted

**Date:** 2026-05-08

## Context

The card was migrated from JavaScript to TypeScript in v1.2 and runs under `tsc --strict` since v1.8 (#33). "Strict everywhere" is the obvious goal, but the integration boundary against Home Assistant resists it cheaply.

`src/main.ts` is the LitElement integration boundary — ~1500 LOC of `set hass` / `setConfig` / render glue, plus ~30 instance fields that hold HA-shaped state (forecasts, weather, current sensor readings, scroll-ux teardowns, animation controllers, …). The HA frontend exposes a `HomeAssistant` type, but importing it pulls in a chain of frontend dependencies the card otherwise doesn't use:

- Lovelace card-config types
- HA's localization machinery
- Theming and connection-state types

Adopting `HomeAssistant` directly would add ~6 transitive `@types/*` imports for a ~1500-LOC class. Mocking those types where they're missing in the public API would add a parallel maintenance burden. Threading `HassLike` through every render path would touch ~50 fields and most call sites.

Two paths:

- **Strict everywhere.** Adopt the full HA frontend type imports. ~6 new deps; non-trivial test-mock surface; no runtime improvement.
- **Strict on leaves, relaxed at the boundary.** Define a minimal `HassLike` interface in `data-source.ts`. Leaf modules (data-source, chart/*, sunshine-source, openmeteo-source, scroll-ux, action-handler, editor/*) type-check cleanly; main.ts uses `HassMain extends HassLike` plus `any`-typed fields for HA-shaped slots whose frontend types aren't documented.

## Decision

**Leaf modules** — everything in `src/` *except* `main.ts` — are fully strict-typed. They export typed APIs; downstream contributors get types when they import from this card.

**`src/main.ts`** is the relaxed integration boundary:

- Class extends `HassLike` (defined in `data-source.ts`) for the `hass` field.
- `_dataSource: MeasuredDataSource | null` and `_forecastSource: ForecastDataSource | null` are typed.
- The synthesised `weather` / `temperature` / editor-callback-payload fields use `any`, with `eslint-disable` lines limited to those exact slots.
- No `@ts-nocheck` on the file as a whole — that was removed in v1.8 (#33).

ESLint encodes the relaxations explicitly in `eslint.config.mjs` (the rules disabled there — `no-explicit-any`, `no-unsafe-*`, `restrict-template-expressions`, `restrict-plus-operands`, `no-misused-promises`, `unbound-method` — exist because typed-rule false-positives on `any`-flavoured HA objects would generate noise that doesn't surface real bugs).

`@ts-nocheck`, `@ts-ignore`, and `@ts-expect-error` require a justification of at least 10 characters (`'allow-with-description'`).

## Consequences

**Pros**

- The card has zero `@types/home-assistant-frontend` (or equivalent) dependency, which would otherwise pull a long chain of UI-only types.
- Leaf-module exports are strictly typed, so anyone importing helpers from this card gets full type information.
- The boundary is named (`HassLike` / `HassMain`) and enforced — adding a new HA-shaped field forces a deliberate placement decision.
- ESLint relaxations are explicit and rule-by-rule, not global. A future tightening can promote one rule at a time.

**Cons**

- `main.ts` keeps ~30 `any`-typed fields; refactors to it cannot rely on type-checking for HA-shaped slots.
- The "strict everywhere except main.ts" rule is a convention, not a structural guarantee. A new contributor could land an `any` in a leaf module and would need to be caught in review.
- Two rule sets to remember: leaf modules vs. integration boundary.

**Tradeoffs**

- Adopting `@types/home-assistant-frontend` was rejected as ~6 transitive deps for ~1500 LOC of glue — the value-per-dep ratio is low and the maintenance cost is real.
- Tightening main.ts incrementally is tracked as future follow-up rather than blocking v1.8. Each `any` removed is its own decision about whether the corresponding HA frontend type is worth importing.
- A `@ts-nocheck` blanket on main.ts (the v1.7-and-earlier state) was rejected because it disables type-checking for the strictly-typed slots too, including `_dataSource` and `_forecastSource`.

## Related

- [`../../src/main.ts`](../../src/main.ts) — file header documents the boundary
- [`../../src/data-source.ts`](../../src/data-source.ts) — `HassLike` definition
- [`../../eslint.config.mjs`](../../eslint.config.mjs) — rule relaxations
- [Issue #33](https://github.com/chriguschneider/weather-station-card/issues/33) — strict pass on main.ts
