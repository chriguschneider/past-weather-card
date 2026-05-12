// Unit tests for the precipitation-rate derivation. Pure data → number;
// no DOM, no localStorage, no timers.
//
// Rate formula under test:
//   anchor = buffer[buffer.length - targetN]   (or [0] if buffer < targetN)
//   rate   = (latest.v - anchor.v) / (now - anchor.t)
//
// The `now` parameter makes the rate decay as wall-clock advances
// without new ticks — verified by the "decay" describe block below.

import { describe, it, expect } from 'vitest';
import {
  appendSample,
  pruneOlderThan,
  computeRate,
  findUsableSlice,
  loadBuffer,
  saveBuffer,
  precipIcon,
  DEFAULT_MAX_AGE_MS,
} from '../src/precip-rate.js';

// Tiny in-memory localStorage stand-in — mirrors
// `tests/openmeteo-source.test.js` (`makeStorage`) so future readers
// have one mental model for storage-backed test fixtures.
function makeStorage(seed = {}) {
  const data = { ...seed };
  return {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => { data[k] = String(v); },
    _data: data,
  };
}

const T0 = 1_700_000_000_000;
const min = (n) => n * 60_000;

describe('appendSample', () => {
  it('returns a new array with the sample appended', () => {
    const before = [{ t: T0, v: 100 }];
    const after = appendSample(before, { t: T0 + 1000, v: 100.1 });
    expect(after).not.toBe(before);
    expect(after).toEqual([
      { t: T0, v: 100 },
      { t: T0 + 1000, v: 100.1 },
    ]);
  });

  it('drops samples with non-finite t or v (HA unavailable/unknown)', () => {
    const before = [{ t: T0, v: 100 }];
    expect(appendSample(before, { t: NaN, v: 100 })).toBe(before);
    expect(appendSample(before, { t: T0 + 1000, v: NaN })).toBe(before);
    expect(appendSample(before, { t: T0 + 1000, v: Infinity })).toBe(before);
  });

  it('dedupes a same-(t,v) re-render', () => {
    const before = [{ t: T0, v: 100 }];
    const after = appendSample(before, { t: T0, v: 100 });
    expect(after).toBe(before);
  });

  it('keeps samples with same t but different v (rare but real)', () => {
    const before = [{ t: T0, v: 100 }];
    const after = appendSample(before, { t: T0, v: 100.1 });
    expect(after).toHaveLength(2);
  });
});

describe('pruneOlderThan', () => {
  it('drops entries older than maxAgeMs relative to `now`', () => {
    const buffer = [
      { t: T0 - min(20), v: 50 },
      { t: T0 - min(10), v: 51 },
      { t: T0 - min(5),  v: 52 },
      { t: T0,            v: 53 },
    ];
    const out = pruneOlderThan(buffer, min(15), T0);
    expect(out).toHaveLength(3);
    expect(out[0].v).toBe(51);
  });

  it('returns the same array reference when nothing was pruned', () => {
    const buffer = [{ t: T0, v: 100 }];
    expect(pruneOlderThan(buffer, min(15), T0)).toBe(buffer);
  });

  it('handles an empty buffer', () => {
    expect(pruneOlderThan([], min(15), T0)).toEqual([]);
  });

  it('uses DEFAULT_MAX_AGE_MS (15 min) when called with that constant', () => {
    expect(DEFAULT_MAX_AGE_MS).toBe(900_000);
  });
});

describe('computeRate — empty and single-sample buffers', () => {
  it('returns rate 0 for an empty buffer', () => {
    expect(computeRate([], T0)).toEqual({ rate: 0, sampleCount: 0 });
  });

  it('returns floor 0.1 for a single fresh sample (sensor just ticked)', () => {
    // Cold-start the moment a tip lands and `set hass` runs: we know
    // SOMETHING happened, can't quantify yet. The floor stops the cell
    // from misleadingly reading `0.0 mm/h` immediately after a fresh
    // sensor change.
    const buffer = [{ t: T0 - min(1), v: 100 }];
    expect(computeRate(buffer, T0).rate).toBe(0.1);
  });

  it('returns rate 0 for a single stale sample', () => {
    // Last sensor change > freshThresholdMs ago — no reason to assume
    // it's still raining.
    const buffer = [{ t: T0 - min(5), v: 100 }];
    expect(computeRate(buffer, T0).rate).toBe(0);
  });
});

describe('computeRate — last-N window with now-driven Δt', () => {
  it('computes rate from the trailing 3 samples', () => {
    // 0.2 mm fell between T0-min(2) and T0; with `now = T0`,
    // Δt = 2 min, rate = 6 mm/h.
    const buffer = [
      { t: T0 - min(2), v: 100.0 },
      { t: T0 - min(1), v: 100.1 },
      { t: T0,           v: 100.2 },
    ];
    expect(computeRate(buffer, T0).rate).toBeCloseTo(6, 2);
  });

  it('uses only the trailing 3 of a longer buffer (older samples ignored)', () => {
    // 5 samples in buffer; anchor = trailing-3rd = T0-min(2).
    // Earlier samples don't bias the rate.
    const buffer = [
      { t: T0 - min(10), v: 99.0 },  // ignored
      { t: T0 - min(4),  v: 99.5 },  // ignored
      { t: T0 - min(2),  v: 100.0 }, // anchor
      { t: T0 - min(1),  v: 100.1 },
      { t: T0,            v: 100.2 },
    ];
    expect(computeRate(buffer, T0).rate).toBeCloseTo(6, 2);
  });

  it('falls back to anchor = buffer[0] when buffer has only 2 samples', () => {
    // Drizzle resume case: localStorage held one stale sample, a fresh
    // one just landed. Use both with the now-driven denominator.
    const buffer = [
      { t: T0 - min(8) - 43_000, v: 791.7 },  // event 8 of the user's data
      { t: T0,                    v: 791.8 }, // event 9
    ];
    const { rate } = computeRate(buffer, T0);
    // 0.1 mm / (8m43s as h) = 0.1 / 0.14528 ≈ 0.688 mm/h
    expect(rate).toBeCloseTo(0.688, 2);
  });
});

describe('computeRate — decay via now-driven Δt', () => {
  it('halves the displayed rate when Δt doubles with no new ticks', () => {
    const buffer = [
      { t: T0 - min(1), v: 100.0 },
      { t: T0,           v: 100.2 },
    ];
    const atT0 = computeRate(buffer, T0).rate;
    const atT0Plus1 = computeRate(buffer, T0 + min(1)).rate;
    // At T0:   Δv=0.2, Δt=1 min → 12 mm/h
    // At T0+1: Δv=0.2, Δt=2 min →  6 mm/h
    expect(atT0).toBeCloseTo(12, 2);
    expect(atT0Plus1).toBeCloseTo(6, 2);
  });

  it('decays toward 0 as Δt grows large (idle buffer, no new ticks)', () => {
    // Hose-then-stop fixture: 4.8 mm fell in a 51-s burst. After an
    // hour of silence, the running average reads under 5 mm/h —
    // soft transition into "no rain" instead of a cliff.
    const burstStart = T0 - 51_000;
    const buffer = [
      { t: burstStart,         v: 786.8 },
      { t: burstStart + 25_000, v: 790.4 },
      { t: T0,                  v: 791.6 },
    ];
    const peak = computeRate(buffer, T0).rate;          // right after burst
    const after5min = computeRate(buffer, T0 + min(5)).rate;
    const after1h = computeRate(buffer, T0 + min(60)).rate;
    expect(peak).toBeGreaterThan(300);   // tropical-storm intensity
    expect(after5min).toBeLessThan(60);  // already decaying noticeably
    expect(after1h).toBeLessThan(5);     // approaching dry
  });
});

describe('computeRate — counter reset (findUsableSlice integration)', () => {
  it('computes rate from the post-reset slice only', () => {
    // Buffer crosses midnight: pre-reset values around 10-12 mm, then
    // a reset to 0 and small fresh values. Rate must reflect ONLY the
    // post-reset trio, not the negative jump.
    const buffer = [
      { t: T0 - min(10), v: 10.0 },
      { t: T0 - min(8),  v: 10.1 },
      { t: T0 - min(6),  v: 10.2 },
      { t: T0 - min(4),  v: 0.0 },
      { t: T0 - min(2),  v: 0.1 },
      { t: T0,            v: 0.2 },
    ];
    const { rate } = computeRate(buffer, T0);
    // Post-reset trio: anchor=(T0-min(4), 0), latest=(T0, 0.2),
    // Δv=0.2, Δt=4 min → 3 mm/h.
    expect(rate).toBeCloseTo(3, 2);
  });

  it('returns floor when post-reset slice has 1 fresh sample only', () => {
    // Right after a midnight rollover, only the reset value is in
    // the post-reset slice. Single-sample-fresh path → floor 0.1.
    const buffer = [
      { t: T0 - min(10), v: 12.4 },
      { t: T0 - min(7),  v: 12.4 },
      { t: T0 - min(1),  v: 0.2 },
    ];
    expect(computeRate(buffer, T0).rate).toBe(0.1);
  });

  it('returns 0 when prune+reset trim leaves an empty buffer', () => {
    // Wall-clock tick fires on a dry buffer that's already been pruned
    // to empty — should be a no-op-to-zero, never a NaN or sign error.
    const pruned = pruneOlderThan([
      { t: T0 - min(30), v: 100 },
      { t: T0 - min(25), v: 100 },
    ], min(15), T0);
    expect(pruned).toEqual([]);
    expect(computeRate(pruned, T0)).toEqual({ rate: 0, sampleCount: 0 });
  });

  it('reports the full buffer sampleCount even when reset trims most of it', () => {
    const buffer = [
      { t: T0 - min(3), v: 10 },
      { t: T0 - min(2), v: 11 },
      { t: T0 - min(1), v: 12 },
      { t: T0,           v: 0 },
    ];
    expect(computeRate(buffer, T0).sampleCount).toBe(4);
  });
});

describe('findUsableSlice — reset-boundary detection', () => {
  it('returns the whole buffer when monotone non-decreasing', () => {
    const buffer = [
      { t: 1, v: 10 },
      { t: 2, v: 11 },
      { t: 3, v: 12 },
    ];
    expect(findUsableSlice(buffer)).toBe(buffer);
  });

  it('trims to the post-reset tail when one reset is present', () => {
    // The canonical midnight scenario from the plan:
    // `[10, 11, 12, 0, 0.2, 0.4]` → keep `[0, 0.2, 0.4]`.
    const buffer = [
      { t: 1, v: 10 },
      { t: 2, v: 11 },
      { t: 3, v: 12 },
      { t: 4, v: 0 },
      { t: 5, v: 0.2 },
      { t: 6, v: 0.4 },
    ];
    expect(findUsableSlice(buffer)).toEqual([
      { t: 4, v: 0 },
      { t: 5, v: 0.2 },
      { t: 6, v: 0.4 },
    ]);
  });

  it('cuts at the LATEST reset when multiple are present', () => {
    // Defensive — within a 15-min buffer only one reset is realistic,
    // but if a future caller widens the window we must still pick the
    // last boundary so we don't span a reset.
    const buffer = [
      { t: 1, v: 10 },
      { t: 2, v: 0 },
      { t: 3, v: 1 },
      { t: 4, v: 0 },
      { t: 5, v: 0.2 },
    ];
    expect(findUsableSlice(buffer)).toEqual([
      { t: 4, v: 0 },
      { t: 5, v: 0.2 },
    ]);
  });

  it('returns the buffer unchanged when empty', () => {
    expect(findUsableSlice([])).toEqual([]);
  });
});

describe('saveBuffer + loadBuffer round-trip', () => {
  const ENTITY = 'sensor.pool_weather_station_precipitation';
  const KEY = 'weather-station-card.precipSamples.' + ENTITY;

  it('writes a JSON-serialised payload under the entity-keyed slot', () => {
    const storage = makeStorage();
    const buffer = [
      { t: T0 - min(5), v: 100.1 },
      { t: T0,           v: 100.2 },
    ];
    saveBuffer(ENTITY, buffer, storage);
    const raw = storage.getItem(KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw);
    expect(parsed.samples).toEqual(buffer);
  });

  it('round-trips through save/load', () => {
    const storage = makeStorage();
    const buffer = [
      { t: T0 - min(10), v: 100.0 },
      { t: T0 - min(5),  v: 100.1 },
      { t: T0,            v: 100.2 },
    ];
    saveBuffer(ENTITY, buffer, storage);
    const loaded = loadBuffer(ENTITY, storage, T0);
    expect(loaded).toEqual(buffer);
  });

  it('drops over-age entries on load', () => {
    // 20-min-old sample is past the 15-min default — must not survive
    // a reload, otherwise the warm-up display would feed stale data
    // into the first computeRate call after page mount.
    const storage = makeStorage();
    saveBuffer(ENTITY, [
      { t: T0 - min(20), v: 50.0 },
      { t: T0 - min(10), v: 51.0 },
      { t: T0,            v: 52.0 },
    ], storage);
    const loaded = loadBuffer(ENTITY, storage, T0);
    expect(loaded).toHaveLength(2);
    expect(loaded[0].t).toBe(T0 - min(10));
  });

  it('honours an explicit maxAgeMs override', () => {
    const storage = makeStorage();
    saveBuffer(ENTITY, [
      { t: T0 - min(8), v: 10 },
      { t: T0 - min(3), v: 11 },
      { t: T0,           v: 12 },
    ], storage);
    const loaded = loadBuffer(ENTITY, storage, T0, min(5));
    expect(loaded).toHaveLength(2);
    expect(loaded[0].t).toBe(T0 - min(3));
  });
});

describe('loadBuffer — null safety', () => {
  it('returns [] when storage is null (private mode / disabled)', () => {
    expect(loadBuffer('sensor.x', null, T0)).toEqual([]);
  });

  it('returns [] when entityId is empty', () => {
    const storage = makeStorage({ 'weather-station-card.precipSamples.': '{"samples":[{"t":1,"v":1}]}' });
    expect(loadBuffer('', storage, T0)).toEqual([]);
  });

  it('returns [] when no value is stored for the entity', () => {
    expect(loadBuffer('sensor.x', makeStorage(), T0)).toEqual([]);
  });

  it('returns [] when stored JSON is corrupt', () => {
    const storage = makeStorage({
      'weather-station-card.precipSamples.sensor.x': '{not-json',
    });
    expect(loadBuffer('sensor.x', storage, T0)).toEqual([]);
  });

  it('returns [] when payload is not an object', () => {
    const storage = makeStorage({
      'weather-station-card.precipSamples.sensor.x': '"plain-string"',
    });
    expect(loadBuffer('sensor.x', storage, T0)).toEqual([]);
  });

  it('skips entries with non-finite t or v', () => {
    // Schema corruption: a future writer might serialise NaN as null,
    // or a hand-edit might inject malformed entries. Filter them out
    // instead of letting them poison `computeRate`.
    const storage = makeStorage({
      'weather-station-card.precipSamples.sensor.x': JSON.stringify({
        samples: [
          { t: T0 - 1000, v: 100 },
          { t: 'oops',    v: 101 },
          { t: T0,         v: null },
          { t: T0 + 1000, v: 102 },
        ],
      }),
    });
    const loaded = loadBuffer('sensor.x', storage, T0);
    expect(loaded.map(s => s.v)).toEqual([100, 102]);
  });

  it('sorts loaded samples chronologically (defensive)', () => {
    const storage = makeStorage({
      'weather-station-card.precipSamples.sensor.x': JSON.stringify({
        samples: [
          { t: T0,            v: 102 },
          { t: T0 - min(10), v: 100 },
          { t: T0 - min(5),  v: 101 },
        ],
      }),
    });
    const loaded = loadBuffer('sensor.x', storage, T0);
    expect(loaded.map(s => s.t)).toEqual([T0 - min(10), T0 - min(5), T0]);
  });
});

describe('saveBuffer — null safety', () => {
  it('is a no-op when storage is null', () => {
    expect(() => saveBuffer('sensor.x', [{ t: T0, v: 1 }], null)).not.toThrow();
  });

  it('is a no-op when entityId is empty', () => {
    const storage = makeStorage();
    saveBuffer('', [{ t: T0, v: 1 }], storage);
    expect(Object.keys(storage._data)).toHaveLength(0);
  });

  it('swallows storage throws (quota / private mode)', () => {
    const storage = {
      getItem: () => null,
      setItem: () => { throw new Error('QuotaExceededError'); },
    };
    expect(() => saveBuffer('sensor.x', [{ t: T0, v: 1 }], storage)).not.toThrow();
  });
});

describe('precipIcon', () => {
  it('returns water-off for zero rate (dry)', () => {
    expect(precipIcon(0)).toBe('hass:water-off');
  });

  it('returns water-off for negative or non-finite input (defensive)', () => {
    // Non-finite inputs can never come from real Δv/Δt, but the icon
    // is the user-facing surface — collapse to the dry icon rather
    // than letting an undefined-icon attribute hit the DOM.
    expect(precipIcon(-1)).toBe('hass:water-off');
    expect(precipIcon(NaN)).toBe('hass:water-off');
    expect(precipIcon(Infinity)).toBe('hass:water-off');
  });

  it('returns weather-rainy for drizzle and light rain (0 < rate < 2.5)', () => {
    // Drizzle and light share the same icon — see precip-rate.ts for why
    // weather-partly-rainy was rejected (sun glyph contradicts the rain
    // context).
    expect(precipIcon(0.1)).toBe('hass:weather-rainy');
    expect(precipIcon(0.49)).toBe('hass:weather-rainy');
    expect(precipIcon(0.5)).toBe('hass:weather-rainy');
    expect(precipIcon(1.6)).toBe('hass:weather-rainy');
    expect(precipIcon(2.49)).toBe('hass:weather-rainy');
  });

  it('returns weather-pouring for moderate-to-heavy rain (rate ≥ 2.5)', () => {
    // Boundary at 2.5: pouring, not light.
    expect(precipIcon(2.5)).toBe('hass:weather-pouring');
    expect(precipIcon(10)).toBe('hass:weather-pouring');
    expect(precipIcon(86)).toBe('hass:weather-pouring');
  });
});
