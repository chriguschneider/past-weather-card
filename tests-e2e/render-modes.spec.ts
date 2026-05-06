// Visual regression: every render-mode permutation the card supports.
//
// 3 forecast types × 3 modes × 2 sunshine variants = 18 tests:
//   forecast types: daily, today (24h zoom), hourly
//   modes: combination, station-only, forecast-only
//   sunshine: off, on
//
// Each scenario gets a screenshot baseline. A regression in dataset
// assembly, separator framing, sunshine row placement, sparse-label
// rendering, or styling will fail the matching baseline check at CI
// time. Baselines are committed under tests-e2e/snapshots/ and
// generated on the GHA runner via update-baselines.yml (#18) so the
// 0.2 % maxDiffPixelRatio threshold holds.
//
// Animation is disabled via `forecast.disable_animation: true` in the
// base config so the screenshot timing is deterministic.

import { test, expect } from '@playwright/test';
import { openHarness, mount, unmountAll, cardSelector } from './_helpers.js';
import { buildFullFixture, buildBaseConfig } from './fixtures/generate.js';

type Mode = 'combination' | 'station' | 'forecast';
type ForecastType = 'daily' | 'today' | 'hourly';

interface ModeFlags {
  show_station: boolean;
  show_forecast: boolean;
}

const MODES: Record<Mode, ModeFlags> = {
  combination: { show_station: true, show_forecast: true },
  station:     { show_station: true, show_forecast: false },
  forecast:    { show_station: false, show_forecast: true },
};

const FORECAST_TYPES: ForecastType[] = ['daily', 'today', 'hourly'];

test.describe('render modes', () => {
  test.beforeEach(async ({ page }) => {
    await openHarness(page);
  });

  test.afterEach(async ({ page }) => {
    await unmountAll(page);
  });

  // 3 × 3 × 2 = 18 systematic baselines.
  for (const mode of Object.keys(MODES) as Mode[]) {
    for (const forecastType of FORECAST_TYPES) {
      for (const sunshine of [false, true]) {
        const sunshineSuffix = sunshine ? '-sunshine' : '';
        const name = `${forecastType}-${mode}${sunshineSuffix}`;
        test(name, async ({ page }) => {
          // 'today' fixture needs only 24-hour horizon — anything
          // larger gets sliced by the chart but inflates fixture
          // load time. Other modes use the default 7-day / 168-hour
          // fixture.
          const fixture = forecastType === 'today'
            ? buildFullFixture({ days: 1, hours: 24, forecastHours: 24 })
            : buildFullFixture();

          await mount(
            page,
            buildBaseConfig({
              ...MODES[mode],
              ...(forecastType === 'today' ? { days: 1, forecast_days: 1 } : {}),
              forecast: {
                type: forecastType,
                disable_animation: true,
                show_sunshine: sunshine,
              },
            }),
            fixture,
          );
          await expect(page.locator(cardSelector())).toHaveScreenshot(
            `${name}.png`,
          );
        });
      }
    }
  }
});
