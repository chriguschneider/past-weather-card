// Regression cover for the post-midnight doubled-today bug
// (https://github.com/chriguschneider/weather-station-card/issues — the
// THU label vanished and FRI's label sat between THU and FRI when the
// chart was viewed minutes after local midnight).
//
// `doubledToday` was previously gated only on stationCount > 0 &&
// forecastCount > 0. Just past midnight the station block ends at
// YESTERDAY (the recorder hasn't aggregated today yet, so
// `dropEmptyStationToday` removes the empty trailing bucket) while the
// forecast block leads with TODAY. The two boundary columns then
// represent different days; the label-collapse logic must not fire.
//
// `boundaryIsSameDay` is the new gate. We exercise the pure helper
// here — the rendering side is covered indirectly via the existing
// e2e suite.

import { describe, it, expect } from 'vitest';
import { boundaryIsSameDay } from '../src/chart/orchestrator.js';

describe('boundaryIsSameDay', () => {
  it('returns false when stationCount is 0', () => {
    expect(boundaryIsSameDay(['2026-05-15T00:00:00'], 0)).toBe(false);
  });

  it('returns false when stationCount is at array end (no forecast slot)', () => {
    expect(boundaryIsSameDay(['2026-05-15T00:00:00'], 1)).toBe(false);
  });

  it('returns true when station-last and forecast-first share the same calendar day', () => {
    // Typical mid-day daily-mode merge: station's "today" daily bucket
    // and forecast's "today" daily entry both sit on 2026-05-15.
    const dt = [
      '2026-05-11T00:00:00',
      '2026-05-12T00:00:00',
      '2026-05-13T00:00:00',
      '2026-05-14T00:00:00',
      '2026-05-15T00:00:00', // station-today
      '2026-05-15T00:00:00', // forecast-today
      '2026-05-16T00:00:00',
      '2026-05-17T00:00:00',
    ];
    expect(boundaryIsSameDay(dt, 5)).toBe(true);
  });

  it('returns false when station ends at yesterday and forecast starts at today (post-midnight)', () => {
    // The bug repro: at 00:16 on FRI 2026-05-15 the station block has
    // been trimmed to end at THU 2026-05-14 and forecast leads with
    // FRI 2026-05-15. doubledToday must NOT fire.
    const dt = [
      '2026-05-11T00:00:00',
      '2026-05-12T00:00:00',
      '2026-05-13T00:00:00',
      '2026-05-14T00:00:00', // station-yesterday
      '2026-05-15T00:00:00', // forecast-today
      '2026-05-16T00:00:00',
      '2026-05-17T00:00:00',
      '2026-05-18T00:00:00',
    ];
    expect(boundaryIsSameDay(dt, 4)).toBe(false);
  });

  it('returns false for missing or invalid datetimes at the boundary', () => {
    expect(boundaryIsSameDay([undefined, '2026-05-15T00:00:00'], 1)).toBe(false);
    expect(boundaryIsSameDay(['2026-05-15T00:00:00', undefined], 1)).toBe(false);
    expect(boundaryIsSameDay(['nonsense', '2026-05-15T00:00:00'], 1)).toBe(false);
  });

  it('compares LOCAL calendar days, not UTC — DST or near-midnight UTC offsets do not flip the gate', () => {
    // Two timestamps an hour apart, both on the same local day. The
    // helper uses Date#setHours(0,0,0,0) — local-midnight floor — so
    // a "2026-05-15T23:00 + 2026-05-15T23:30" pair stays same-day even
    // though their UTC representations might span midnight. Encoded
    // without an offset so the test runs identically in any TZ.
    const dt = ['2026-05-15T23:00:00', '2026-05-15T23:30:00'];
    expect(boundaryIsSameDay(dt, 1)).toBe(true);
  });
});
