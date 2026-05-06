// Pointer-event spec: drag-to-scroll, indicator chevrons, and the
// tap_action contract (configured action fires on tap, but a drag /
// swipe gesture suppresses the trailing tap so a horizontal scroll
// doesn't accidentally trigger more-info).
//
// Coverage by file:
//   - drag detection: scroll-ux.ts onPointerDown/Move/End
//   - tap suppression: action-handler.ts checks `card._dragMoved`
//   - indicator click: scroll-ux.ts onLeftClick / onRightClick

import { test, expect } from '@playwright/test';
import { openHarness, mount, unmountAll, cardSelector, settle } from './_helpers.js';
import { buildFullFixture, buildBaseConfig, WEATHER_ENTITY } from './fixtures/generate.js';

// Hourly mode so the chart is wide enough to actually scroll. Daily
// fits in one viewport.
const HOURLY_CONFIG = (overrides: Record<string, unknown> = {}) =>
  buildBaseConfig({
    show_station: true,
    show_forecast: true,
    forecast: { type: 'hourly', disable_animation: true, number_of_forecasts: 8 },
    ...overrides,
  });

test.describe('scroll + actions', () => {
  test.beforeEach(async ({ page }) => {
    await openHarness(page);
  });

  test.afterEach(async ({ page }) => {
    await unmountAll(page);
  });

  test('drag-to-scroll moves the wrapper scrollLeft', async ({ page }) => {
    await mount(page, HOURLY_CONFIG(), buildFullFixture());

    // Read the starting scrollLeft so the assertion is robust against
    // future changes to `computeInitialScrollLeft` (which seeds the
    // wrapper to ~now-position, not to 0).
    const startScrollLeft = await page.evaluate((sel) => {
      const card = document.querySelector(sel);
      const sr = (card as HTMLElement & { shadowRoot?: ShadowRoot | null }).shadowRoot;
      const wrap = sr?.querySelector('.forecast-scroll.scrolling') as HTMLElement;
      return wrap?.scrollLeft ?? 0;
    }, cardSelector());

    // Locate the scroll wrapper in viewport coordinates so we can
    // synthesise pointer events at the right pixel positions.
    const box = await page.evaluate((sel) => {
      const card = document.querySelector(sel);
      const sr = (card as HTMLElement & { shadowRoot?: ShadowRoot | null }).shadowRoot;
      const wrap = sr?.querySelector('.forecast-scroll.scrolling') as HTMLElement | null;
      if (!wrap) return null;
      const r = wrap.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    }, cardSelector());
    if (!box) throw new Error('scroll wrapper not found');

    // Drag from centre to the left by ~half the wrapper width. Mouse
    // pointer type so the scroll-ux module's mouse-only `scrollLeft`
    // manipulation kicks in (touch falls through to native scroll).
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    // Sub-threshold first move (5 px DRAG_THRESHOLD) then continue
    // past it — mirrors a real drag.
    await page.mouse.move(cx - 8, cy, { steps: 4 });
    await page.mouse.move(cx - box.w / 2, cy, { steps: 8 });
    await page.mouse.up();
    await settle(page);

    const endScrollLeft = await page.evaluate((sel) => {
      const card = document.querySelector(sel);
      const sr = (card as HTMLElement & { shadowRoot?: ShadowRoot | null }).shadowRoot;
      const wrap = sr?.querySelector('.forecast-scroll.scrolling') as HTMLElement;
      return wrap?.scrollLeft ?? 0;
    }, cardSelector());

    // Drag-to-scroll inverts pointer movement: dragging left → scrollLeft
    // increases. Allow some tolerance for the threshold + step rounding.
    expect(endScrollLeft).toBeGreaterThan(startScrollLeft + 100);
  });

  test('drag suppresses tap_action; click without drag fires it', async ({ page }) => {
    await mount(
      page,
      HOURLY_CONFIG({
        tap_action: {
          action: 'perform-action',
          perform_action: 'logbook.log',
          data: { name: 'wsc_e2e', message: 'tap fired' },
        },
      }),
      buildFullFixture(),
    );

    // Same drag pattern as the previous test — should NOT count as a tap.
    const box = await page.evaluate((sel) => {
      const card = document.querySelector(sel);
      const sr = (card as HTMLElement & { shadowRoot?: ShadowRoot | null }).shadowRoot;
      const wrap = sr?.querySelector('.forecast-scroll.scrolling') as HTMLElement | null;
      if (!wrap) return null;
      const r = wrap.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    }, cardSelector());
    if (!box) throw new Error('scroll wrapper not found');

    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx - box.w / 3, cy, { steps: 8 });
    await page.mouse.up();
    // Wait past the DBL_MS (250 ms) tap delay so a queued single tap
    // would have fired by now.
    await page.waitForTimeout(400);

    const callsAfterDrag = await page.evaluate((sel) => {
      const card = document.querySelector(sel) as HTMLElement & { _hass: { __serviceCalls: unknown[] } };
      return card._hass.__serviceCalls.length;
    }, cardSelector());
    expect(callsAfterDrag).toBe(0);

    // Now a clean tap (no movement) — should fire perform-action.
    // Tap on the .main panel because the chart overlay swallows
    // pointerup with stopPropagation on its indicator buttons.
    const mainBox = await page.evaluate((sel) => {
      const card = document.querySelector(sel);
      const sr = (card as HTMLElement & { shadowRoot?: ShadowRoot | null }).shadowRoot;
      const main = sr?.querySelector('.main') as HTMLElement | null;
      if (!main) return null;
      const r = main.getBoundingClientRect();
      return { x: r.x, y: r.y, w: r.width, h: r.height };
    }, cardSelector());
    if (!mainBox) throw new Error('main panel not found');

    await page.mouse.click(mainBox.x + mainBox.w / 2, mainBox.y + mainBox.h / 2);
    await page.waitForTimeout(400);

    const callsAfterTap = await page.evaluate((sel) => {
      const card = document.querySelector(sel) as HTMLElement & { _hass: { __serviceCalls: Array<{ domain: string; service: string }> } };
      return card._hass.__serviceCalls;
    }, cardSelector());
    expect(callsAfterTap.length).toBeGreaterThanOrEqual(1);
    expect(callsAfterTap[0].domain).toBe('logbook');
    expect(callsAfterTap[0].service).toBe('log');
  });

  test('left-indicator chevron scrolls the wrapper one viewport step', async ({ page }) => {
    await mount(page, HOURLY_CONFIG(), buildFullFixture());

    // Move scroll well to the right first so the left chevron is
    // visible and has room to scroll back.
    await page.evaluate((sel) => {
      const card = document.querySelector(sel);
      const sr = (card as HTMLElement & { shadowRoot?: ShadowRoot | null }).shadowRoot;
      const wrap = sr?.querySelector('.forecast-scroll.scrolling') as HTMLElement;
      if (wrap) wrap.scrollLeft = wrap.scrollWidth - wrap.clientWidth;
    }, cardSelector());
    await settle(page);

    const before = await page.evaluate((sel) => {
      const card = document.querySelector(sel);
      const sr = (card as HTMLElement & { shadowRoot?: ShadowRoot | null }).shadowRoot;
      return (sr?.querySelector('.forecast-scroll.scrolling') as HTMLElement).scrollLeft;
    }, cardSelector());

    // Click the left chevron via JS-dispatched event (pointer
    // synthesis through the shadow DOM is fiddlier than just calling
    // .click on the button — and click is what scroll-ux listens for).
    await page.evaluate((sel) => {
      const card = document.querySelector(sel);
      const sr = (card as HTMLElement & { shadowRoot?: ShadowRoot | null }).shadowRoot;
      const btn = sr?.querySelector('.scroll-indicator-left') as HTMLElement;
      btn?.click();
    }, cardSelector());
    // scrollBy with `behavior: smooth` schedules the scroll over a
    // few hundred ms — wait the full window before asserting.
    await page.waitForTimeout(600);

    const after = await page.evaluate((sel) => {
      const card = document.querySelector(sel);
      const sr = (card as HTMLElement & { shadowRoot?: ShadowRoot | null }).shadowRoot;
      return (sr?.querySelector('.forecast-scroll.scrolling') as HTMLElement).scrollLeft;
    }, cardSelector());
    expect(after).toBeLessThan(before - 100);
  });

  // Silence the unused-var lint.
  void WEATHER_ENTITY;
});
