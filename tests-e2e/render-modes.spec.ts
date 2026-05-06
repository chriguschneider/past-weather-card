// Visual regression: each of the six render modes the card supports.
//
//   daily × {station, forecast, combination}
//   hourly × {station, forecast, combination}
//
// Each scenario gets a screenshot baseline. A regression in dataset
// assembly, separator framing, or styling will fail the matching
// baseline check at CI time. Baselines are committed under
// tests-e2e/snapshots/.
//
// Animation is disabled via `forecast.disable_animation: true` in the
// base config so the screenshot timing is deterministic.

import { test, expect } from '@playwright/test';
import { openHarness, mount, unmountAll, cardSelector } from './_helpers.js';
import { buildFullFixture, buildBaseConfig } from './fixtures/generate.js';

test.describe('render modes', () => {
  test.beforeEach(async ({ page }) => {
    await openHarness(page);
  });

  test.afterEach(async ({ page }) => {
    await unmountAll(page);
  });

  for (const forecastType of ['daily', 'hourly'] as const) {
    test(`${forecastType} — station only`, async ({ page }) => {
      await mount(
        page,
        buildBaseConfig({
          show_station: true,
          show_forecast: false,
          forecast: { type: forecastType, disable_animation: true },
        }),
        buildFullFixture(),
      );
      await expect(page.locator(cardSelector())).toHaveScreenshot(
        `${forecastType}-station.png`,
      );
    });

    test(`${forecastType} — forecast only`, async ({ page }) => {
      await mount(
        page,
        buildBaseConfig({
          show_station: false,
          show_forecast: true,
          forecast: { type: forecastType, disable_animation: true },
        }),
        buildFullFixture(),
      );
      await expect(page.locator(cardSelector())).toHaveScreenshot(
        `${forecastType}-forecast.png`,
      );
    });

    test(`${forecastType} — combination`, async ({ page }) => {
      await mount(
        page,
        buildBaseConfig({
          show_station: true,
          show_forecast: true,
          forecast: { type: forecastType, disable_animation: true },
        }),
        buildFullFixture(),
      );
      await expect(page.locator(cardSelector())).toHaveScreenshot(
        `${forecastType}-combination.png`,
      );
    });
  }

  test('daily — sunshine row enabled', async ({ page }) => {
    await mount(
      page,
      buildBaseConfig({
        show_station: true,
        show_forecast: true,
        forecast: {
          type: 'daily',
          disable_animation: true,
          show_sunshine: true,
        },
      }),
      buildFullFixture(),
    );
    await expect(page.locator(cardSelector())).toHaveScreenshot(
      'daily-sunshine.png',
    );
  });
});
