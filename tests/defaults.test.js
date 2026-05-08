// @vitest-environment jsdom
// Static drift detector for the configuration defaults.
//
// The card's DEFAULTS object (src/defaults.ts) is the single source of
// truth for `setConfig({})` and `getStubConfig()`. A future PR that
// adds a key to one path without adding it to DEFAULTS — or vice versa
// — silently re-introduces the v1.x drift class that #83 closed. This
// file makes that drift mechanically detectable.
//
// Two checks:
//   1. getStubConfig output keys ⊆ DEFAULTS keys (modulo `sensors` which
//      is auto-detected).
//   2. setConfig({sensors: {temperature: 'sensor.t'}}) produces a config
//      whose keys are a superset of DEFAULTS keys (DEFAULTS spread sets
//      the floor; the user merge can only add keys).

import { describe, it, expect } from 'vitest';
import '../src/main.js';
import { DEFAULTS } from '../src/defaults.js';

const Card = customElements.get('weather-station-card');

function topLevelKeys(obj) {
  return Object.keys(obj).sort();
}

function omit(obj, keys) {
  const skip = new Set(keys);
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (!skip.has(k)) out[k] = v;
  }
  return out;
}

describe('config defaults — drift guard', () => {
  it('getStubConfig output keys are a subset of DEFAULTS keys', () => {
    const stub = Card.getStubConfig({ states: {} }, [], []);
    const stubWithoutSensors = omit(stub, ['sensors']);
    const stubKeys = topLevelKeys(stubWithoutSensors);
    const defaultKeys = topLevelKeys(omit(DEFAULTS, ['sensors']));
    // Every stub key must exist in DEFAULTS — no orphan stub-only keys.
    for (const key of stubKeys) {
      expect(defaultKeys).toContain(key);
    }
  });

  it('setConfig({}) produces every DEFAULTS top-level key', () => {
    // Combination is now the default (#83 follow-up), so we provide a
    // minimal sensor + weather_entity to satisfy the mode-aware
    // validation. The shape check is the point — not whether the
    // validation passes.
    const card = document.createElement('weather-station-card');
    card.setConfig({
      sensors: { temperature: 'sensor.t' },
      weather_entity: 'weather.test',
    });
    const cfg = card.config;
    const defaultKeys = topLevelKeys(omit(DEFAULTS, ['sensors']));
    const cfgKeys = topLevelKeys(cfg);
    for (const key of defaultKeys) {
      expect(cfgKeys).toContain(key);
    }
  });

  it('setConfig preserves nested forecast / units keys from DEFAULTS', () => {
    const card = document.createElement('weather-station-card');
    card.setConfig({
      sensors: { temperature: 'sensor.t' },
      weather_entity: 'weather.test',
    });
    const cfg = card.config;
    const forecastDefaultKeys = Object.keys(DEFAULTS.forecast).sort();
    for (const key of forecastDefaultKeys) {
      expect(cfg.forecast).toHaveProperty(key);
    }
    const unitsDefaultKeys = Object.keys(DEFAULTS.units).sort();
    for (const key of unitsDefaultKeys) {
      expect(cfg.units).toHaveProperty(key);
    }
  });
});
