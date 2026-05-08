# 0003: E2E visual-regression baselines pinned to the GHA Ubuntu runner

**Status:** Accepted

**Date:** 2026-05-08

## Context

The card has a Playwright visual-regression suite under `tests-e2e/` that compares rendered card output against PNG snapshots committed under `tests-e2e/snapshots/render-modes.spec.ts/`. The comparison runs in CI against `pixelDiff` thresholds in `playwright.config.ts`.

Visual-regression diffs are sensitive to **subpixel rendering**, which differs between platforms:

- The GHA `ubuntu-latest` runner uses Mesa's software rasterizer in a specific kernel/font configuration.
- WSL2 (a common local dev environment for this repo) virtualizes the GPU and renders text with subtly different font hinting.
- macOS and native Linux render differently again.

A baseline generated locally on WSL and compared against a screenshot generated on GHA shows ~1–4 % diffs on text-heavy regions, even when the actual UI is byte-for-byte identical. That diff is too large for a useful tolerance: anything looser than ~1 % is too coarse to catch real regressions like a 1-px text shift or a colour change in the chart legend.

Two paths out:

- **Loose tolerance.** Set `pixelDiff` to ~2 % so WSL-generated baselines pass on GHA. Misses real regressions.
- **Tight tolerance + canonical environment.** Set tolerance to 0.2 % and require all baselines to come from the same environment as the assertion run.

## Decision

E2E visual baselines are **regenerated exclusively on the GHA `ubuntu-latest` runner**. The Playwright tolerance sits at 0.2 %.

The `update-baselines.yml` workflow is the canonical baseline-generation path. It is manually triggered (`gh workflow run update-baselines.yml --ref <branch>`), runs Playwright with `--update-snapshots` after deleting the existing PNGs, and pushes a `chore: update e2e baselines from CI` commit back to the branch.

WSL is supported as a "does the chart still render at all" smoke test during local iteration but **its baseline output must never be committed**. WSL baselines drifted from GHA cause PR review to fail with a noisy diff that the contributor cannot reproduce locally.

The workflow:

1. Hard-deletes existing PNG baselines so Playwright writes every file fresh. (Without the delete, `--update-snapshots` skips files that already pass under the loose update-pass logic.)
2. `git pull --rebase` before push so master can advance during the ~2-minute run without a race on push.

## Consequences

**Pros**

- 0.2 % tolerance is tight enough to flag 1-px text shifts and minor colour drift — the kind of regressions that matter.
- The baseline-generation environment is part of the test contract, not a per-contributor concern. No "works on my machine" debugging.
- Baselines are reproducible by anyone with `gh workflow run` access — no privileged dev machine required.

**Cons**

- A baseline regen takes ~2 minutes (workflow dispatch round-trip) versus seconds for a local update. Contributors must remember to dispatch the workflow rather than run `--update-snapshots` locally.
- Committing WSL baselines is a foot-gun that will silently bite: locally the suite passes; on PR it fails with a diff the contributor cannot reproduce. The mitigation is documentation (this ADR + workflow header) rather than a hard guard.
- Pinning to GHA `ubuntu-latest` means a future runner upgrade (Ubuntu 24.04 → 26.04, font-package update) shifts all baselines at once. Recovery is "regenerate on the new image and review the wholesale diff."

**Tradeoffs**

- A loose tolerance (~2 %) was rejected because it permits real regressions to slip through.
- A platform-matrix baseline set (one per OS) was rejected because the multiplication of snapshot files makes review unmanageable and adds nothing — the production target is a single browser environment per render.
- Containerizing the baseline generation locally (e.g. via Docker) was considered but adds toolchain complexity for the rare case of regen; the dispatched workflow is simpler.

## Related

- [`../../.github/workflows/update-baselines.yml`](../../.github/workflows/update-baselines.yml) — canonical regen path
- [`../../tests-e2e/snapshots/`](../../tests-e2e/) — committed baselines
- [`../../playwright.config.ts`](../../playwright.config.ts) — tolerance config
