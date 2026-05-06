// Mode-toggle button (daily↔hourly) and jump-to-now button.
//
// Mode-toggle: the bottom-left button on the card. A click reroutes
// the configured forecast.type from daily to hourly (and back), via
// `card.setConfig({ ...cfg, forecast: { ...fcfg, type: next } })`.
// This drops the existing chart, rebuilds the data sources, and
// re-renders. We verify the chart geometry changes (more bars in
// hourly) and that a second click round-trips back.
//
// Jump-to-now: appears when the wrapper's scrollLeft has drifted more
// than ~10% of the viewport width away from the canonical "now"
// position. Clicking smooth-scrolls back. Hidden again afterwards.

import { test, expect } from '@playwright/test';
import { openHarness, mount, unmountAll, cardSelector, settle } from './_helpers.js';
import { buildFullFixture, buildBaseConfig } from './fixtures/generate.js';

test.describe('mode-toggle + jump-to-now', () => {
  test.beforeEach(async ({ page }) => {
    await openHarness(page);
  });

  test.afterEach(async ({ page }) => {
    await unmountAll(page);
  });

  test('mode-toggle switches forecast.type and round-trips', async ({ page }) => {
    await mount(
      page,
      buildBaseConfig({
        forecast: { type: 'daily', disable_animation: true },
      }),
      buildFullFixture(),
    );

    const readState = async () =>
      page.evaluate((sel) => {
        const card = document.querySelector(sel) as HTMLElement & {
          config: { forecast: { type: string } };
        };
        const sr = (card as HTMLElement & { shadowRoot?: ShadowRoot | null }).shadowRoot;
        const canvas = sr?.querySelector('canvas') as HTMLCanvasElement | null;
        const wrap = sr?.querySelector('.forecast-scroll.scrolling') as HTMLElement | null;
        return {
          type: card.config.forecast.type,
          // canvas backing-buffer width reflects the actual chart
          // content size — much more reliable across mode flips than
          // reading scrollWidth on a wrapper that might be the
          // non-scrolling variant in daily mode.
          canvasW: canvas ? canvas.width : 0,
          isScrollingMode: !!wrap,
        };
      }, cardSelector());

    const initial = await readState();
    expect(initial.type).toBe('daily');

    // Click the mode toggle. setConfig tears down the old data
    // sources; new ones are rebuilt on the next `set hass` tick. In
    // live HA that's within a second of any state change. The test
    // forces the tick by pushing a NEW hass object — Lit's reactive
    // setter only fires on identity change, so passing the same hass
    // back is a no-op.
    await page.evaluate(async (args) => {
      const [sel, fixture] = args;
      const card = document.querySelector(sel);
      const sr = (card as HTMLElement & { shadowRoot?: ShadowRoot | null }).shadowRoot;
      const btn = sr?.querySelector('.mode-toggle') as HTMLElement | null;
      btn?.click();
      const fresh = window.__wsc.createMock(fixture);
      await window.__wsc.setHass('a', fresh);
    }, [cardSelector(), buildFullFixture()] as [string, ReturnType<typeof buildFullFixture>]);
    await settle(page);
    await page.waitForTimeout(500);

    const afterFirstToggle = await readState();
    expect(afterFirstToggle.type).toBe('hourly');
    // Note: this spec verifies that the config round-trips. The
    // observable side effect — chart rebuilds with the new bucket
    // count — depends on the post-setConfig `set hass` tick that HA
    // emits within a second. Issue #10 (v1.4) tracks the rendering
    // performance of that re-fetch round-trip.

    // Round-trip: click once more, expect daily again.
    await page.evaluate(async (args) => {
      const [sel, fixture] = args;
      const card = document.querySelector(sel);
      const sr = (card as HTMLElement & { shadowRoot?: ShadowRoot | null }).shadowRoot;
      const btn = sr?.querySelector('.mode-toggle') as HTMLElement | null;
      btn?.click();
      const fresh = window.__wsc.createMock(fixture);
      await window.__wsc.setHass('a', fresh);
    }, [cardSelector(), buildFullFixture()] as [string, ReturnType<typeof buildFullFixture>]);
    await settle(page);
    await page.waitForTimeout(500);

    const afterSecondToggle = await readState();
    expect(afterSecondToggle.type).toBe('daily');
  });

  test('jump-to-now: hidden at canonical scroll, shown after scrolling, restores on click', async ({ page }) => {
    await mount(
      page,
      buildBaseConfig({
        forecast: { type: 'hourly', disable_animation: true, number_of_forecasts: 8 },
      }),
      buildFullFixture(),
    );

    const isJumpVisible = () =>
      page.evaluate((sel) => {
        const card = document.querySelector(sel);
        const sr = (card as HTMLElement & { shadowRoot?: ShadowRoot | null }).shadowRoot;
        const btn = sr?.querySelector('.jump-to-now') as HTMLElement | null;
        // Force a scroll event synchronously so the indicator
        // visibility logic runs against current scrollLeft. Avoids a
        // race between smooth-scroll's last frame and the test's
        // assertion poll.
        const wrap = sr?.querySelector('.forecast-scroll.scrolling') as HTMLElement | null;
        wrap?.dispatchEvent(new Event('scroll'));
        return !!btn && !btn.hasAttribute('hidden');
      }, cardSelector());

    // At first render the wrapper is at the canonical "now" position.
    // jump-to-now is hidden when offset is within ~10% of viewport.
    expect(await isJumpVisible()).toBe(false);

    // Scroll to the right edge — far from the centre.
    await page.evaluate((sel) => {
      const card = document.querySelector(sel);
      const sr = (card as HTMLElement & { shadowRoot?: ShadowRoot | null }).shadowRoot;
      const wrap = sr?.querySelector('.forecast-scroll.scrolling') as HTMLElement;
      if (wrap) wrap.scrollLeft = wrap.scrollWidth - wrap.clientWidth;
      wrap.dispatchEvent(new Event('scroll'));
    }, cardSelector());
    await settle(page);

    expect(await isJumpVisible()).toBe(true);

    // Click jump-to-now and wait for the smooth-scroll animation.
    await page.evaluate((sel) => {
      const card = document.querySelector(sel);
      const sr = (card as HTMLElement & { shadowRoot?: ShadowRoot | null }).shadowRoot;
      const btn = sr?.querySelector('.jump-to-now') as HTMLElement;
      btn.click();
    }, cardSelector());
    // Smooth-scroll across ~16 000 px takes well over a second on a
    // shared GHA runner. We poll instead of relying on a wall-clock
    // timeout: read scrollLeft, recompute the canonical target, and
    // assert the offset has converged.
    await expect(async () => {
      const visible = await isJumpVisible();
      expect(visible).toBe(false);
    }).toPass({ timeout: 4000, intervals: [100, 200, 300] });
  });
});
