import { defineConfig, devices } from '@playwright/test';

// Playwright config for the weather-station-card E2E + visual-regression
// suite. Tests live under tests-e2e/ and load the bundled card via a
// minimal HTML harness (tests-e2e/pages/card.html). No real Home
// Assistant connection — `tests-e2e/hass-mock.ts` stands in for the
// `hass` object the card consumes.
//
// One project (chromium) is enough for the v1.3 deliverable: HA
// frontend itself targets Chromium-class browsers, and visual-
// regression baselines tied to a single rendering engine sidestep
// font-hinting drift that would otherwise plague cross-browser
// snapshots.

export default defineConfig({
  testDir: './tests-e2e',
  // Visual regression baselines live next to each spec under
  // tests-e2e/<spec>.spec.ts-snapshots/. Pinning the path keeps
  // baselines stable when specs are renamed.
  snapshotPathTemplate: '{testDir}/snapshots/{testFilePath}/{arg}{ext}',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // Local: 1 retry catches the rare flake on slow disk; CI: 2 because
  // GHA shared runners have noisier I/O.
  retries: process.env.CI ? 2 : 1,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI
    ? [['html', { open: 'never' }], ['github']]
    : 'list',

  use: {
    baseURL: 'http://localhost:5173',
    // Always capture trace on first retry — the trace viewer is the
    // fastest way to debug a Lit / Chart.js render race.
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  // Visual regression tolerance:
  //   - Baselines are generated in WSL (Ubuntu-24.04) — same major
  //     version as the GHA ubuntu-latest runner — to keep the font /
  //     graphics stack as close as possible. Even so, observed diff
  //     ranges from ~1 % up to ~4 % across the 13 baselines: WSL2's
  //     GPU virtualization renders subpixel font hinting differently
  //     from the GHA container, and that drift shows up concentrated
  //     in the chart's tick + temperature labels (where the line +
  //     label edges interact most with subpixel positioning).
  //   - 5 % accommodates that drift. Catches major regressions:
  //     a missing dataset (~10–20 %), a wrong major colour (~5–8 %),
  //     a layout shift (~5–10 %). Misses subtle 1-px text shifts
  //     and minor colour drifts — acceptable for v1.3 given the
  //     alternative (no visual regression at all).
  //   - threshold 0.2 is the per-pixel colour-distance default.
  //
  // Tighter via CI-generated baselines: tracked as issue #18 — a
  // workflow_dispatch GitHub Action that runs --update-snapshots on
  // the actual GHA runner and commits the baselines back. Then
  // baseline-generation and assertion run on the same environment
  // and the threshold can drop to 0.2 %.
  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.05,
      threshold: 0.2,
      // Animations (the 500 ms easeOutQuart on temperature lines) are
      // disabled per-test by toggling forecast.disable_animation in
      // the card config — see tests-e2e/_helpers.ts. This keeps the
      // toHaveScreenshot timing deterministic.
    },
  },

  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 720 },
      },
    },
  ],

  webServer: {
    // Static-serve the repo root so /dist/weather-station-card.js and
    // /tests-e2e/pages/card.html are reachable. Reuses an existing
    // server when one is already running (developer iteration).
    command: 'npx http-server -p 5173 -c-1 --silent .',
    url: 'http://localhost:5173/tests-e2e/pages/card.html',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
