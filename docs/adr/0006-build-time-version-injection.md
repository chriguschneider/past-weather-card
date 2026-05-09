# 0006: Build-time `__CARD_VERSION__` injection via Rollup

**Status:** Accepted

**Date:** 2026-05-09

## Context

The card prints a console banner on load (`%c WEATHER-STATION-CARD %c v1.9.0`)
so users — and the maintainer during local dev — can confirm at a
glance which build is running. This is especially useful when HA's
service worker or browser cache serves a stale bundle and the rendered
card looks wrong: the banner version vs. the expected version makes the
mismatch obvious.

Through v1.9.0, the version was a hardcoded string literal
(`const CARD_VERSION = '1.9.0';`) that had to be bumped manually at
release time alongside `package.json` and `CHANGELOG.md`. A comment
above the constant flagged this, but a forgotten bump was real and
silent — the bundle would ship with `package.json` saying `1.9.1` and
the console banner still claiming `1.9.0`. CI didn't catch the
mismatch.

Alternatives considered:

- **Status quo — manual sync.** Cheap, but bug-prone. The release flow
  has many checklist items; an extra one is easy to miss and the
  failure mode is silent.
- **Vitest test that asserts `CARD_VERSION === pkg.version`.** Loud
  failure on drift, but still requires a manual bump in two places —
  it just fails the build instead of silently shipping a stale banner.
- **Add `@rollup/plugin-replace` as a dependency.** The standard way
  to inject build-time constants. Works, but adds a dep to the build
  graph for one trivial substitution. Per [docs/QUALITY-GATES.md](../QUALITY-GATES.md#dependabot),
  major-version bumps need manual changelog review; even a minor dep
  add is non-trivial.
- **Inline Rollup transform plugin (no new dep).** A small object with
  `name` + `transform` that scans `main.ts` for the placeholder and
  replaces it. Self-contained, no surface-area increase.

## Decision

`rollup.config.mjs` reads `package.json` at config-load time and
applies an inline transform plugin `injectCardVersion` that replaces
the literal `'__CARD_VERSION__'` in `src/main.ts` with
`JSON.stringify(pkg.version)` at bundle time:

```js
const pkg = JSON.parse(readFileSync('./package.json', 'utf8'));

const injectCardVersion = {
  name: 'inject-card-version',
  transform(code, id) {
    if (!id.endsWith('main.ts')) return null;
    const replaced = code.replaceAll("'__CARD_VERSION__'", JSON.stringify(pkg.version));
    return replaced === code ? null : { code: replaced, map: null };
  },
};
```

`src/main.ts` declares the constant as the placeholder string:

```ts
const CARD_VERSION = '__CARD_VERSION__';
```

The plugin runs before TypeScript transpilation in the plugin chain so
no downstream pass sees the placeholder. Idempotent — only touches
`main.ts`, only matches the exact placeholder literal.

## Consequences

**Pros**

- `package.json` is the **single source of truth** for the version
  string. Bumping the version touches one file and propagates
  automatically to the bundle's console banner.
- No new dependency — the plugin is ~10 lines inline in
  `rollup.config.mjs`. No supply-chain surface added.
- Test suite is unaffected: tests run against the unsubstituted source,
  the `'__CARD_VERSION__'` placeholder is just a string literal in
  jsdom. No test inspects the banner.
- CI sync gate (the existing `dist/weather-station-card.js` matches
  source check) catches any drift if someone forgets to rebuild — the
  injected version is part of the bundle, so a forgotten rebuild after
  a `package.json` bump fails CI loudly.

**Cons**

- The unsubstituted source is technically broken at runtime if loaded
  directly without the Rollup pass (e.g. via `tsc` output). The console
  banner would say `WEATHER-STATION-CARD v__CARD_VERSION__`. In
  practice the card is only ever loaded as the bundled output, so this
  doesn't matter — but a contributor running `tsc` for type-checking
  doesn't get a runnable card.
- One extra plugin in the Rollup chain. Negligible build-time cost
  (~milliseconds for one regex replace on one file).

**Tradeoffs**

- A Vitest assertion of `CARD_VERSION === pkg.version` would have
  caught drift but still required two manual bumps. The Rollup plugin
  removes the manual step entirely — strictly better.
- `@rollup/plugin-replace` would have done the same job with slightly
  more configurability (regex options, source-map handling). Rejected
  for the dep-surface reason above; the inline plugin is small enough
  that the abstraction cost isn't paid back.

## Related

- [`../../rollup.config.mjs`](../../rollup.config.mjs) — `injectCardVersion` plugin
- [`../../src/main.ts`](../../src/main.ts) — `CARD_VERSION` constant
- [`./0001-dist-committed-for-hacs.md`](./0001-dist-committed-for-hacs.md) — why the bundled `dist/` is the only thing users actually load
