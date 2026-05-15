# 0011: Track `package-lock.json` for reproducible builds

**Status:** Accepted

**Date:** 2026-05-15

## Context

ADR-0001 commits `dist/weather-station-card.js` and CI verifies the file byte-matches a fresh `npm run build`. That contract has an unstated prerequisite: the build must be **reproducible** — given the same source, every environment (a contributor's machine, GHA's `build.yml`, the WSL helper recipe in `CLAUDE.md`) must produce the same bytes.

`package-lock.json` had been gitignored since the start of the repo (`.gitignore` line 2). With no lockfile in the tree, every `npm install` resolved dependency versions fresh from `package.json`'s semver `^`-ranges. The committed dist could therefore byte-match one CI run and not the next, depending on which transitive patch versions npm happened to resolve. The `Verify committed bundle matches source` step caught this only when it bit, so the underlying flakiness stayed invisible most of the time.

The flakiness surfaced concretely during the consolidation of PRs #156–#161 in the 2026-05 perf session: every PR's CI build failed with a 2-line dist diff against a fresh GHA build. Worse, `update-baselines.yml`'s `npm run rollup` step rebuilt dist into a different shape than the committed one and left the file dirty, breaking its `git pull --rebase` push-back step. Both were the same root cause: builds aren't reproducible without a lockfile.

Alternatives considered:

- **Pin every dep to an exact version in `package.json`** (no carets). Brittle: every patch upgrade needs a manual `package.json` edit; transitive deps still float (`package.json` only pins direct deps).
- **Use `npm ci` without committing the lockfile.** `npm ci` *requires* a lockfile — it's a non-starter without committing one.
- **Loosen the dist-verify check to a tolerance** (e.g. ignore N-byte diffs). Defeats the point of byte-match verification; lets real regressions slip.

## Decision

`package-lock.json` is committed to the repository. The `.gitignore` entry that excluded it was removed as part of the #162 consolidation commit. The lockfile is the single source of truth for the dependency tree that produces the committed `dist/`.

`npm install --no-audit --no-fund` (used by `build.yml` and `update-baselines.yml`) reconciles against the committed lockfile and updates it only when `package.json`'s ranges genuinely require it. Contributors who change dependencies commit the resulting lockfile change in the same PR.

`npm ci` is a stricter alternative that errors on any lockfile / `package.json` drift. Adopting it in CI is a follow-up worth considering once a few PRs have run under the new committed-lockfile regime — out of scope for this ADR.

## Consequences

**Pros**

- ADR-0001's "verify dist byte-matches source" check is now actually reliable. The same source produces the same dist on a contributor's machine, in WSL, and on GHA.
- `update-baselines.yml`'s `npm run rollup` step now produces a dist that matches the committed one → no dirty file → its `git pull --rebase` push-back works.
- Future supply-chain audits (`npm audit`, dep review) operate on the exact tree that's actually shipped.

**Cons**

- One more file to keep in sync. Contributors who add or upgrade a dep must commit the resulting `package-lock.json` change alongside the `package.json` change — easy to forget. CI's dist-verify catches it indirectly (a forgotten lockfile change usually means a dist drift), but a clearer "lockfile out of sync" error would be nicer.
- The lockfile is large (~6000 lines). PR diffs grow accordingly when deps move.

**Tradeoffs**

- Pinning exact versions in `package.json` was rejected because it doesn't cover transitive deps and forces manual bumps for every patch.
- Switching CI to `npm ci` was deferred — it would be the cleaner enforcement, but adopting it requires every contributor to keep the lockfile fresh from day one. The current `npm install` flow tolerates one-off mismatches gracefully and is the right step now.

## Related

- [`./0001-dist-committed-for-hacs.md`](./0001-dist-committed-for-hacs.md) — the committed-dist + verify-byte-match contract this ADR makes reproducible.
- [`../../.gitignore`](../../.gitignore) — line that previously excluded `package-lock.json`.
- [`../../.github/workflows/build.yml`](../../.github/workflows/build.yml) — `Verify committed bundle matches source` step.
- [`../../.github/workflows/update-baselines.yml`](../../.github/workflows/update-baselines.yml) — relies on `npm run rollup` producing the committed dist.
- [PR #162](https://github.com/chriguschneider/weather-station-card/pull/162) — the 2026-05 perf-session consolidation commit that introduced the lockfile.
