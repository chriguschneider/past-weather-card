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
    // Hostile theme: defines every "warning"-shaped token to orange.
    // Tokens we deliberately use for their semantic colour (info,
    // sensor-precipitation, sensor-temperature) get plausible HA
    // defaults so we don't accidentally pin to the rgba fallback.
    originalGetComputedStyle = globalThis.getComputedStyle;
    const themeTokens = {
      '--warning-color': 'rgb(245, 124, 0)',          // orange
      '--label-badge-yellow': 'rgb(244, 180, 0)',     // amber
      '--state-sun-color': 'rgb(255, 193, 7)',        // amber
      '--info-color': 'rgb(68, 115, 158)',            // dark blue
      '--state-sensor-precipitation-color': 'rgb(132, 209, 253)', // light blue
      '--state-sensor-temperature-color': 'rgb(255, 152, 0)',     // orange
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

  it('sunshine_color is NOT wired to --warning-color (orange in HA themes)', () => {
    expect(DEFAULTS_FORECAST.sunshine_color).not.toMatch(/--warning-color/);
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
});
