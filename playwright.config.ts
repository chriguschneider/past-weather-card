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
  //   - Anti-aliasing on chart line strokes drifts a sub-pixel between
  //     headed/headless and — more impactfully — between Windows and
  //     Linux Chromium font rendering. The 1 % observed on a Windows-
  //     generated baseline → Linux GHA runner round-trip is dominated
  //     by glyph hinting on the chart's tick + temperature labels;
  //     setting the threshold at 2.5 % absorbs that without masking
  //     real regressions like a missing dataset (those typically diff
  //     5 %+ in our card layout).
  //   - threshold 0.2 is the per-pixel colour-distance default; we
  //     keep it.
  //
  // Long-term path: regenerate baselines from a Linux container so
  // the comparison stays platform-symmetric and the tolerance can
  // tighten back to 0.2 %. Tracked as a follow-up.
  expect: {
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.025,
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
