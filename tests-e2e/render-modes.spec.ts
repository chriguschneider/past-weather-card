// Visual regression: every render-mode permutation the card supports.
//
// 3 modes        × 2 forecast types × 2 sunshine variants = 12 tests
// (combination, station-only, forecast-only) × (daily, hourly) × (off, on)
//
// Plus a 24-hour daily-zoom variant — when the user picks days=1 the
// chart shows a single-day window. This tickles the "viewport fits all
// bars, no scroll" branch which the 7-day fixtures don't reach.
//
// Each scenario gets a screenshot baseline. A regression in dataset
// assembly, separator framing, sunshine row placement, or styling
// will fail the matching baseline check at CI time. Baselines are
// committed under tests-e2e/snapshots/.
//
// Animation is disabled via `forecast.disable_animation: true` in the
// base config so the screenshot timing is deterministic.

import { test, expect } from '@playwright/test';
import { openHarness, mount, unmountAll, cardSelector } from './_helpers.js';
import { buildFullFixture, buildBaseConfig } from './fixtures/generate.js';

type Mode = 'combination' | 'station' | 'forecast';
type ForecastType = 'daily' | 'hourly';

interface ModeFlags {
  show_station: boolean;
  show_forecast: boolean;
}

const MODES: Record<Mode, ModeFlags> = {
  combination: { show_station: true, show_forecast: true },
  station:     { show_station: true, show_forecast: false },
  forecast:    { show_station: false, show_forecast: true },
};

test.describe('render modes', () => {
  test.beforeEach(async ({ page }) => {
    await openHarness(page);
  });

  test.afterEach(async ({ page }) => {
    await unmountAll(page);
  });

  // 3 × 2 × 2 = 12 systematic baselines.
  for (const mode of Object.keys(MODES) as Mode[]) {
    for (const forecastType of ['daily', 'hourly'] as ForecastType[]) {
      for (const sunshine of [false, true]) {
        const sunshineSuffix = sunshine ? '-sunshine' : '';
        const name = `${forecastType}-${mode}${sunshineSuffix}`;
        test(name, async ({ page }) => {
          await mount(
            page,
            buildBaseConfig({
              ...MODES[mode],
              forecast: {
                type: forecastType,
                disable_animation: true,
                show_sunshine: sunshine,
              },
            }),
            buildFullFixture(),
          );
          await expect(page.locator(cardSelector())).toHaveScreenshot(
            `${name}.png`,
          );
        });
      }
    }
  }

  // 24-hour zoom: days=1, hourly. Viewport = 24 bars (matches
  // forecast.number_of_forecasts default of 24 at this zoom level).
  // Exercises the "fits all bars, no scroll" code path.
  test('hourly-combination-24h', async ({ page }) => {
    await mount(
      page,
      buildBaseConfig({
        days: 1,
        forecast_days: 1,
        show_station: true,
        show_forecast: true,
        forecast: {
          type: 'hourly',
          disable_animation: true,
          number_of_forecasts: 24,
        },
      }),
      buildFullFixture(),
    );
    await expect(page.locator(cardSelector())).toHaveScreenshot(
      'hourly-combination-24h.png',
    );
  });
});
