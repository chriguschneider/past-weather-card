import { describe, it, expect } from 'vitest';
import {
  pickHourlyTickIndices,
  hourlyTempSeries,
  normalizeForecastMode,
  startOfTodayMs,
  filterMidnightStaleForecast,
  dropEmptyStationToday,
} from '../src/forecast-utils.js';

// Build N consecutive hourly ISO timestamps starting at the given base.
// Default base is a midnight so every 24th entry lands on a day boundary —
// makes the midnight-forcing branch easy to reason about in tests.
function hourlyTimes(n, base = '2026-05-05T00:00:00') {
  const start = new Date(base).getTime();
  const out = new Array(n);
  for (let i = 0; i < n; i++) out[i] = new Date(start + i * 3600_000).toISOString();
  return out;
}

describe('pickHourlyTickIndices', () => {
  it('returns [] for empty input', () => {
    expect(pickHourlyTickIndices([])).toEqual([]);
  });

  it('returns [0] for a single entry', () => {
    expect(pickHourlyTickIndices(hourlyTimes(1))).toEqual([0]);
  });

  it('keeps every hour for 24 entries (step 1)', () => {
    const idx = pickHourlyTickIndices(hourlyTimes(24));
    expect(idx).toEqual(Array.from({ length: 24 }, (_, i) => i));
  });

  it('switches to step 3 for 25–48 entries', () => {
    const idx = pickHourlyTickIndices(hourlyTimes(48));
    // every 3rd: 0, 3, 6, …, 45  → 16 entries; +47 likely added (47-45=2 ≥ 1.5)
    expect(idx[0]).toBe(0);
    expect(idx[idx.length - 1]).toBe(47);
    // strictly ascending, no duplicates
    for (let i = 1; i < idx.length; i++) expect(idx[i]).toBeGreaterThan(idx[i - 1]);
    // count is around 17 (16 step-aligned + 1 last). Allow a small range so
    // tweaking the heuristic doesn't force a test rewrite.
    expect(idx.length).toBeGreaterThanOrEqual(16);
    expect(idx.length).toBeLessThanOrEqual(18);
  });

  it('switches to step 6 for 49–96 entries', () => {
    const idx = pickHourlyTickIndices(hourlyTimes(72));
    expect(idx[0]).toBe(0);
    expect(idx).toContain(6);
    expect(idx).toContain(12);
    expect(idx[idx.length - 1]).toBe(71);
  });

  it('switches to step 12 + forces midnights for ≥97 entries', () => {
    const idx = pickHourlyTickIndices(hourlyTimes(168));
    // 168 hours starting at midnight → midnights at 0, 24, 48, 72, 96, 120, 144.
    // step 12 hits all of those AND noons (12, 36, 60, …). Both sets land in idx.
    for (const m of [0, 24, 48, 72, 96, 120, 144]) {
      expect(idx).toContain(m);
    }
    // sanity: way fewer than 168 ticks
    expect(idx.length).toBeLessThan(40);
    // strictly ascending, no duplicates
    for (let i = 1; i < idx.length; i++) expect(idx[i]).toBeGreaterThan(idx[i - 1]);
  });

  it('forces midnights even when they would not land on the step grid', () => {
    // 100 hourly entries starting at 03:00 — the first midnight is at index 21
    // (which is not a multiple of 12). Without forcing it would be skipped.
    const idx = pickHourlyTickIndices(hourlyTimes(100, '2026-05-05T03:00:00'));
    // 03:00 + 21h = 00:00 next day → index 21 must be present
    expect(idx).toContain(21);
    // 21 is not a multiple of step=12, so it could only have come from
    // the midnight-forcing branch.
    expect(21 % 12).not.toBe(0);
  });

  it('does not duplicate the last index when it is already on the grid', () => {
    // 25 entries: step=3, grid hits 0,3,…,24. Last index 24 is on the grid.
    const idx = pickHourlyTickIndices(hourlyTimes(25));
    expect(idx).toContain(24);
    expect(idx.filter((v) => v === 24).length).toBe(1);
  });

  it('omits the trailing index when it would crowd the previous tick', () => {
    // step 12, 98 entries. Grid: 0,12,24,…,96. Last is 97. 97-96 = 1 < 12/2 = 6
    // → 97 should be skipped (it would crowd 96). But 96 is a midnight (since
    // base starts at 00:00, hour 96 = 4 days later, also 00:00) and remains.
    const idx = pickHourlyTickIndices(hourlyTimes(98));
    expect(idx).toContain(96);
    expect(idx).not.toContain(97);
  });

  it('honours an explicit stepHours override', () => {
    const idx = pickHourlyTickIndices(hourlyTimes(24), { stepHours: 4 });
    // 0, 4, 8, 12, 16, 20 — last index 23 is 3 away from 20, ≥ 4/2=2 → kept.
    expect(idx).toEqual([0, 4, 8, 12, 16, 20, 23]);
  });

  it('accepts Date objects in the array', () => {
    const dates = hourlyTimes(24).map((s) => new Date(s));
    const idx = pickHourlyTickIndices(dates);
    expect(idx.length).toBe(24);
  });

  it('survives invalid timestamps without throwing', () => {
    const dts = ['not-a-date', '2026-05-05T00:00:00', null, undefined];
    // Length 4 falls under step=1 — every index kept regardless of midnight test.
    expect(() => pickHourlyTickIndices(dts)).not.toThrow();
    expect(pickHourlyTickIndices(dts)).toEqual([0, 1, 2, 3]);
  });
});

describe('hourlyTempSeries', () => {
  it('returns empty arrays for empty input', () => {
    expect(hourlyTempSeries([])).toEqual({ tempHigh: [], tempLow: null });
  });

  it('returns tempLow as null when no entry has templow (hourly shape)', () => {
    const entries = [
      { temperature: 18 },
      { temperature: 19 },
      { temperature: 20 },
    ];
    expect(hourlyTempSeries(entries)).toEqual({
      tempHigh: [18, 19, 20],
      tempLow: null,
    });
  });

  it('returns tempLow array when every entry has templow (daily shape)', () => {
    const entries = [
      { temperature: 22, templow: 11 },
      { temperature: 24, templow: 13 },
    ];
    expect(hourlyTempSeries(entries)).toEqual({
      tempHigh: [22, 24],
      tempLow: [11, 13],
    });
  });

  // v1.0.1 regression: previously a single missing templow killed the
  // whole low-temp dataset (combination + station modes hid the second
  // line on any past day where the recorder had no `min` reading).
  // New rule: tempLow is null only when NO entry has templow (pure
  // hourly). Otherwise gaps are individual nulls in the array, which
  // Chart.js renders as line breaks — preserving the rest.
  it('keeps tempLow as a positional array with null in the missing slot', () => {
    const entries = [
      { temperature: 22, templow: 11 },
      { temperature: 24 }, // missing
      { temperature: 25, templow: 14 },
    ];
    const out = hourlyTempSeries(entries);
    expect(out.tempHigh).toEqual([22, 24, 25]);
    expect(out.tempLow).toEqual([11, null, 14]);
  });

  it('treats explicit null templow as a gap, not a kill-switch', () => {
    const entries = [
      { temperature: 22, templow: 11 },
      { temperature: 24, templow: null },
    ];
    const out = hourlyTempSeries(entries);
    expect(out.tempLow).toEqual([11, null]);
  });

  it('returns tempLow null only when EVERY entry lacks templow', () => {
    const entries = [
      { temperature: 22 },
      { temperature: 24 },
      { temperature: 25 },
    ];
    expect(hourlyTempSeries(entries).tempLow).toBeNull();
  });

  it('rounds temperatures when roundTemp is true', () => {
    const entries = [
      { temperature: 21.4, templow: 10.6 },
      { temperature: 22.5, templow: 11.4 },
    ];
    expect(hourlyTempSeries(entries, { roundTemp: true })).toEqual({
      tempHigh: [21, 23],
      tempLow: [11, 11],
    });
  });

  it('keeps fractional temperatures when roundTemp is false', () => {
    const entries = [{ temperature: 21.4, templow: 10.6 }];
    expect(hourlyTempSeries(entries)).toEqual({
      tempHigh: [21.4],
      tempLow: [10.6],
    });
  });

  it('preserves null temperature through rounding (no spurious 0° labels)', () => {
    // Recorder returns no entry for the still-in-progress current hour →
    // temperature is null. Math.round(null) is 0 in JS, which would render
    // a fake "0°" datalabel. The helper must keep null so Chart.js renders
    // a gap and chartjs-plugin-datalabels skips the point.
    const entries = [
      { temperature: 22, templow: 11 },
      { temperature: null }, // current hour, partial bucket
    ];
    const out = hourlyTempSeries(entries, { roundTemp: true });
    expect(out.tempHigh[0]).toBe(22);
    expect(out.tempHigh[1]).toBeNull();
  });

  it('preserves undefined / non-finite temperatures the same way', () => {
    const entries = [
      { temperature: undefined },
      { temperature: NaN },
    ];
    const out = hourlyTempSeries(entries, { roundTemp: true });
    expect(out.tempHigh[0]).toBeUndefined();
    expect(out.tempHigh[1]).toBeNull(); // NaN normalised to null
  });
});

describe('normalizeForecastMode', () => {
  const baseDaily = () => ({
    show_station: true,
    show_forecast: true,
    forecast: { type: 'daily' },
  });

  it('returns input shape unchanged on default daily config', () => {
    const cfg = baseDaily();
    const out = normalizeForecastMode(cfg);
    expect(out.config).toEqual(cfg);
    expect(out.warnings).toEqual([]);
  });

  it('does not mutate the caller-provided config', () => {
    const cfg = baseDaily();
    cfg.forecast.type = 'hourly';
    normalizeForecastMode(cfg);
    expect(cfg.show_station).toBe(true); // mutation would have flipped this
    expect(cfg.forecast.type).toBe('hourly');
  });

  it('preserves show_station at hourly (combination mode = past hours + future hours)', () => {
    const cfg = { ...baseDaily(), forecast: { type: 'hourly' } };
    const out = normalizeForecastMode(cfg);
    expect(out.config.show_station).toBe(true);
    expect(out.config.show_forecast).toBe(true);
    expect(out.warnings).toEqual([]);
  });

  it('passes hourly forecast-only through unchanged', () => {
    const cfg = { show_station: false, show_forecast: true, forecast: { type: 'hourly' } };
    const out = normalizeForecastMode(cfg);
    expect(out.config).toEqual(cfg);
    expect(out.warnings).toEqual([]);
  });

  it('passes today forecast-type through unchanged (24h zoom mode)', () => {
    const cfg = { show_station: true, show_forecast: true, forecast: { type: 'today' } };
    const out = normalizeForecastMode(cfg);
    expect(out.config).toEqual(cfg);
    expect(out.warnings).toEqual([]);
  });

  it('falls back to daily for an unknown forecast.type', () => {
    const cfg = { ...baseDaily(), forecast: { type: 'fortnightly' } };
    const out = normalizeForecastMode(cfg);
    expect(out.config.forecast.type).toBe('daily');
    expect(out.warnings).toContain('forecast_type_invalid');
  });

  it('does not warn when forecast.type is missing — just defaults to daily silently', () => {
    const cfg = { show_station: true, show_forecast: false, forecast: {} };
    const out = normalizeForecastMode(cfg);
    expect(out.config.forecast.type).toBe('daily');
    expect(out.warnings).toEqual([]);
  });

  it('is idempotent on its own output', () => {
    const cfg = { ...baseDaily(), forecast: { type: 'hourly' } };
    const first = normalizeForecastMode(cfg);
    const second = normalizeForecastMode(first.config);
    expect(second.config).toEqual(first.config);
    expect(second.warnings).toEqual([]); // second pass produces no new warnings
  });

  it('passes nullish input through without throwing', () => {
    expect(() => normalizeForecastMode(null)).not.toThrow();
    expect(() => normalizeForecastMode(undefined)).not.toThrow();
    const out = normalizeForecastMode(null);
    expect(out.warnings).toEqual([]);
  });
});

describe('startOfTodayMs', () => {
  it('returns ms-since-epoch at local-midnight today', () => {
    const got = startOfTodayMs();
    const d = new Date(got);
    expect(d.getHours()).toBe(0);
    expect(d.getMinutes()).toBe(0);
    expect(d.getSeconds()).toBe(0);
    // Today's date matches the wall clock
    const now = new Date();
    expect(d.getDate()).toBe(now.getDate());
    expect(d.getMonth()).toBe(now.getMonth());
  });

  it('is finite', () => {
    expect(Number.isFinite(startOfTodayMs())).toBe(true);
  });
});

describe('filterMidnightStaleForecast', () => {
  // Use absolute timestamps so the test is deterministic regardless of
  // when it runs.
  const today = new Date(2026, 4, 6, 0, 0, 0, 0).getTime(); // May 6 local midnight
  const yesterday = new Date(2026, 4, 5, 0, 0, 0, 0).getTime();
  const tomorrow = new Date(2026, 4, 7, 0, 0, 0, 0).getTime();

  it('drops entries before today', () => {
    const out = filterMidnightStaleForecast([
      { datetime: new Date(yesterday).toISOString(), temperature: 10 },
      { datetime: new Date(today).toISOString(), temperature: 12 },
      { datetime: new Date(tomorrow).toISOString(), temperature: 14 },
    ], today);
    expect(out).toHaveLength(2);
    expect(out[0].temperature).toBe(12);
    expect(out[1].temperature).toBe(14);
  });

  it('keeps today entries even at exactly midnight', () => {
    const out = filterMidnightStaleForecast([
      { datetime: new Date(today).toISOString(), temperature: 12 },
    ], today);
    expect(out).toHaveLength(1);
  });

  it('keeps entries with malformed datetime (defensive — let them render)', () => {
    const out = filterMidnightStaleForecast([
      { datetime: 'not-a-date', temperature: 99 },
    ], today);
    expect(out).toHaveLength(1);
  });

  it('keeps entries with missing datetime', () => {
    const out = filterMidnightStaleForecast([
      { temperature: 99 },
    ], today);
    expect(out).toHaveLength(1);
  });

  it('returns a new array (does not mutate input)', () => {
    const input = [
      { datetime: new Date(yesterday).toISOString() },
      { datetime: new Date(today).toISOString() },
    ];
    const out = filterMidnightStaleForecast(input, today);
    expect(out).not.toBe(input);
    expect(input).toHaveLength(2); // unchanged
  });

  it('returns [] for non-array input', () => {
    expect(filterMidnightStaleForecast(null, today)).toEqual([]);
    expect(filterMidnightStaleForecast(undefined, today)).toEqual([]);
    expect(filterMidnightStaleForecast({}, today)).toEqual([]);
  });

  it('passes through unchanged when todayStartMs is non-finite', () => {
    const input = [{ datetime: '2026-05-05T00:00:00Z' }];
    expect(filterMidnightStaleForecast(input, NaN)).toEqual(input);
  });
});

describe('dropEmptyStationToday', () => {
  const today = new Date(2026, 4, 6, 0, 0, 0, 0).getTime();
  const yesterday = new Date(2026, 4, 5, 0, 0, 0, 0).getTime();

  const todayEmpty = {
    datetime: new Date(today).toISOString(),
    temperature: null, templow: null, precipitation: null,
    sunshine: 2.0, // sunshine overlay filled this in
  };
  const todayWithData = {
    datetime: new Date(today).toISOString(),
    temperature: 18, templow: 9, precipitation: 0,
  };
  const yesterdayWithData = {
    datetime: new Date(yesterday).toISOString(),
    temperature: 17, templow: 8, precipitation: 1.2,
  };
  const yesterdayEmpty = {
    datetime: new Date(yesterday).toISOString(),
    temperature: null, templow: null, precipitation: null,
  };

  it('drops the last station entry when it is today + has no recorded data', () => {
    const out = dropEmptyStationToday([yesterdayWithData, todayEmpty], today);
    expect(out).toHaveLength(1);
    expect(out[0]).toBe(yesterdayWithData);
  });

  it('keeps the last station entry when today already has data', () => {
    const out = dropEmptyStationToday([yesterdayWithData, todayWithData], today);
    expect(out).toHaveLength(2);
  });

  it('keeps an offline-historical day even with all null fields', () => {
    // yesterdayEmpty has all null fields BUT it's NOT today — sensor
    // was offline a previous day, the chart should still show the
    // column (with line gaps) rather than dropping it.
    const out = dropEmptyStationToday([yesterdayEmpty, todayWithData], today);
    expect(out).toHaveLength(2);
  });

  it('does not modify the input array', () => {
    const input = [yesterdayWithData, todayEmpty];
    dropEmptyStationToday(input, today);
    expect(input).toHaveLength(2);
  });

  it('returns the original on non-array / empty input', () => {
    expect(dropEmptyStationToday([], today)).toEqual([]);
    expect(dropEmptyStationToday(null, today)).toEqual(null);
  });

  it('keeps an entry with missing datetime (defensive)', () => {
    const noDatetime = { temperature: null, templow: null, precipitation: null };
    const out = dropEmptyStationToday([yesterdayWithData, noDatetime], today);
    expect(out).toHaveLength(2);
  });
});
