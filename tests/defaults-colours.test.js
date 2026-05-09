// @vitest-environment jsdom
// Regression guard for the v1.x bug where DEFAULTS_FORECAST.sunshine_color
// was wired to var(--warning-color, ...) — a token that resolves to
// orange / red in standard HA themes, never falling through to the
// intended yellow literal. The Playwright e2e baselines couldn't
// catch it because Chromium has no HA theme; the bug only surfaced
// on a real install.
//
// These tests pin each forecast colour default to a colour family
// (yellow / blue / orange / dark-blue) and re-check the resolution
// under a hostile theme that defines every "warning"-shaped token to
// orange. If a future PR re-wires sunshine_color to var(--warning-color),
// or precipitation_color to a red token, etc., this fails.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DEFAULTS_FORECAST } from '../src/defaults.js';
import { resolveCssVar } from '../src/utils/resolve-css-var.js';

function rgbaTuple(value) {
  // Accepts 'rgba(r, g, b, a)' / 'rgb(r, g, b)' / '#rrggbb'. Returns
  // [r, g, b] in 0-255 — alpha intentionally dropped (colour family
  // checks don't depend on opacity).
  const trimmed = String(value).trim();
  const rgbaMatch = trimmed.match(/^rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)/);
  if (rgbaMatch) {
    return [Number(rgbaMatch[1]), Number(rgbaMatch[2]), Number(rgbaMatch[3])];
  }
  const hexMatch = trimmed.match(/^#([0-9a-f]{6})$/i);
  if (hexMatch) {
    const n = parseInt(hexMatch[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  throw new Error(`unparseable colour: ${value}`);
}

function isYellowFamily([r, g, b]) {
  return r > 200 && g > 150 && b < 100;
}
function isBlueFamily([r, g, b]) {
  return b > 150 && r < 200 && b >= g;
}
function isOrangeFamily([r, g, b]) {
  return r > 200 && g > 100 && g < 200 && b < 100;
}

describe('forecast colour defaults — regression guard', () => {
  let originalGetComputedStyle;

  beforeEach(() => {
    // Hostile theme: every plausibly-misused token resolves to a
    // colour that would be obviously wrong for the concept it might
    // be wired to (yellow → orange / red, low-temp blue → green, etc.).
    // If any default re-introduces a var(--token, ...) wrapper that
    // hits one of these tokens, the colour-family checks below catch
    // it.
    originalGetComputedStyle = globalThis.getComputedStyle;
    const themeTokens = {
      '--warning-color': 'rgb(245, 124, 0)',          // orange (the #121 trap)
      '--label-badge-yellow': 'rgb(244, 180, 0)',     // amber
      '--state-sun-color': 'rgb(255, 193, 7)',        // amber
      '--info-color': 'rgb(46, 204, 113)',            // green — would mis-tint cold temp
      '--error-color': 'rgb(244, 67, 54)',            // red
    };
    globalThis.getComputedStyle = () => ({
      getPropertyValue: (name) => themeTokens[name] || '',
    });
  });

  afterEach(() => {
    globalThis.getComputedStyle = originalGetComputedStyle;
  });

  it('sunshine_color resolves to yellow under a hostile theme', () => {
    const resolved = resolveCssVar(DEFAULTS_FORECAST.sunshine_color, 'rgba(255, 215, 0, 1.0)');
    expect(isYellowFamily(rgbaTuple(resolved))).toBe(true);
  });

  it('precipitation_color resolves to a blue family colour', () => {
    const resolved = resolveCssVar(DEFAULTS_FORECAST.precipitation_color, 'rgba(132, 209, 253, 1.0)');
    expect(isBlueFamily(rgbaTuple(resolved))).toBe(true);
  });

  it('temperature1_color (high) resolves to an orange family colour', () => {
    const resolved = resolveCssVar(DEFAULTS_FORECAST.temperature1_color, 'rgba(255, 152, 0, 1.0)');
    expect(isOrangeFamily(rgbaTuple(resolved))).toBe(true);
  });

  it('temperature2_color (low) resolves to a blue family colour', () => {
    const resolved = resolveCssVar(DEFAULTS_FORECAST.temperature2_color, 'rgba(68, 115, 158, 1.0)');
    expect(isBlueFamily(rgbaTuple(resolved))).toBe(true);
  });

  // No concept-colour default may wrap a known-problem token. Adding
  // a future colour-default that does (e.g. wiring --info-color back
  // for temperature2) gets caught here even before the colour-family
  // assertions notice.
  it.each([
    ['sunshine_color',     '--warning-color'],
    ['sunshine_color',     '--label-badge-yellow'],
    ['temperature2_color', '--info-color'],
    ['precipitation_color', '--state-sensor-precipitation-color'],
    ['temperature1_color', '--state-sensor-temperature-color'],
  ])('%s does not wrap %s (semantic mismatch or non-existent token)', (key, token) => {
    expect(DEFAULTS_FORECAST[key]).not.toMatch(token);
  });
});
