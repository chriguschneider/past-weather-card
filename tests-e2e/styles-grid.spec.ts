// Visual baselines for the README's "Three modes / two styles" grid.
//
// 3 modes × 2 forecast.style variants = 6 snapshots, all daily mode at
// the default 7-day horizon. The README's styles-grid table is
// composed by referencing these PNGs in a 2×3 markdown table — one
// row per style, one column per mode. That keeps individual snapshot
// diffs reviewable (a style1 regression shows up only in style1 cells)
// while delivering the same visual impact as the previously-static
// styles-grid.png.
//
// Companion to render-modes.spec.ts (which carries 36 baselines for
// the full forecast-type × theme × sunshine matrix using the default
// style2). Splitting the style dimension out keeps render-modes.spec
// from doubling its baseline count.

import { test, expect } from '@playwright/test';
import { openHarness, mount, unmountAll, cardSelector } from './_helpers.js';
import { buildFullFixture, buildBaseConfig } from './fixtures/generate.js';

type Mode = 'combination' | 'station' | 'forecast';
type Style = 'style1' | 'style2';

interface ModeFlags {
  show_station: boolean;
  show_forecast: boolean;
}

const MODES: Record<Mode, ModeFlags> = {
  combination: { show_station: true, show_forecast: true },
  station:     { show_station: true, show_forecast: false },
  forecast:    { show_station: false, show_forecast: true },
};

const STYLES: Style[] = ['style1', 'style2'];

test.describe('styles grid', () => {
  test.beforeEach(async ({ page }) => {
    await openHarness(page);
  });

  test.afterEach(async ({ page }) => {
    await unmountAll(page);
  });

  for (const style of STYLES) {
    for (const mode of Object.keys(MODES) as Mode[]) {
      const name = `${mode}-${style}`;
      test(name, async ({ page }) => {
        await mount(
          page,
          buildBaseConfig({
            ...MODES[mode],
            forecast: {
              type: 'daily',
              style,
              disable_animation: true,
            },
          }),
          buildFullFixture(),
        );
        await expect(page.locator(cardSelector())).toHaveScreenshot(`${name}.png`);
      });
    }
  }
});
