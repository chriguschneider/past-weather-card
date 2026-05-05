// Pure helpers for hourly-forecast rendering. Kept in their own module so
// they can be unit-tested without pulling in Lit, Chart.js, or HA — vitest
// runs in node (no jsdom) and these stay fully exercisable there.

// Decide which entry indices should carry an x-axis tick label when the
// forecast is hourly. Strategy depends on horizon length so a 1-day chart
// shows every hour and a 7-day chart doesn't try to render 168 labels:
//
//   1–24 entries → step 1  (every hour)
//   25–48        → step 3
//   49–96        → step 6
//   ≥97          → step 12, plus every midnight forced in (so day
//                   boundaries always carry a label even if step skips)
//
// First entry is always included (so "now" carries a label). The last
// entry is added only if it is at least step/2 away from the previous
// kept index — otherwise it crowds the right edge.
//
// Inputs are accepted as ISO strings or Date objects; invalid timestamps
// just won't trigger the midnight-force branch.
export function pickHourlyTickIndices(datetimes, opts = {}) {
  if (!Array.isArray(datetimes) || datetimes.length === 0) return [];
  const n = datetimes.length;

  let step;
  let forceMidnights;
  if (n <= 24)      { step = 1;  forceMidnights = false; }
  else if (n <= 48) { step = 3;  forceMidnights = false; }
  else if (n <= 96) { step = 6;  forceMidnights = false; }
  else              { step = 12; forceMidnights = true;  }

  // Allow tests / future callers to override the heuristic.
  if (Number.isFinite(opts.stepHours) && opts.stepHours > 0) step = opts.stepHours;
  if (typeof opts.alwaysIncludeMidnight === 'boolean') forceMidnights = opts.alwaysIncludeMidnight;

  const kept = new Set();
  kept.add(0);
  for (let i = 0; i < n; i++) {
    if (i % step === 0) kept.add(i);
  }
  if (forceMidnights) {
    for (let i = 0; i < n; i++) {
      const d = datetimes[i] instanceof Date ? datetimes[i] : new Date(datetimes[i]);
      if (!Number.isFinite(d.getTime())) continue;
      if (d.getHours() === 0 && d.getMinutes() === 0) kept.add(i);
    }
  }

  const sorted = Array.from(kept).sort((a, b) => a - b);
  const last = n - 1;
  if (sorted[sorted.length - 1] !== last) {
    const prev = sorted[sorted.length - 1];
    if (last - prev >= step / 2) sorted.push(last);
  }
  return sorted;
}

// Decide what the temperature line(s) of the forecast chart should look
// like for the given entries. Daily forecasts carry both `temperature`
// (high) and `templow`; hourly forecasts carry only `temperature`. The
// caller draws two datasets either way — when tempLow is null it should
// hide / skip the second dataset instead of pushing an empty array
// (which would otherwise leave a dangling legend / pointless gap).
//
// Returns:
//   tempHigh: number[]   — always populated, one entry per input.
//   tempLow:  number[] | null
//             null when any entry lacks `templow` (hourly or mixed).
export function hourlyTempSeries(entries, opts = {}) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return { tempHigh: [], tempLow: null };
  }
  const round = opts.roundTemp === true;
  // Preserve null / undefined / non-finite values through rounding —
  // Math.round(null) returns 0 (because null coerces to 0), which would
  // turn "no data for this hour" into a fake 0° label. Chart.js draws a
  // gap on null values, which is the desired behaviour.
  const r = (v) => {
    if (v === null || v === undefined) return v;
    if (typeof v !== 'number' || !Number.isFinite(v)) return null;
    return round ? Math.round(v) : v;
  };

  const tempHigh = new Array(entries.length);
  const tempLow = new Array(entries.length);
  let allHaveLow = true;

  for (let i = 0; i < entries.length; i++) {
    const d = entries[i] || {};
    tempHigh[i] = r(d.temperature);
    if (typeof d.templow === 'undefined' || d.templow === null) {
      allHaveLow = false;
    } else {
      tempLow[i] = r(d.templow);
    }
  }
  return {
    tempHigh,
    tempLow: allHaveLow ? tempLow : null,
  };
}

// Project a card config onto a render-ready shape. The single rule
// today is forecast.type validation: typo'd / unset values fall back
// to 'daily' so downstream code can read the field unconditionally.
// (Earlier drafts forced show_station off at hourly — that constraint
// was dropped once MeasuredDataSource learned to fetch hourly station
// aggregates, so combination mode at hourly is a coherent view: past
// hours of measurements + future hours of forecast.)
//
// Returns { config, warnings: string[] }. `warnings` carries i18n keys
// the caller (or the editor preview) can translate. Idempotent.
export function normalizeForecastMode(rawConfig) {
  const warnings = [];
  if (!rawConfig || typeof rawConfig !== 'object') {
    return { config: rawConfig, warnings };
  }
  const config = { ...rawConfig, forecast: { ...(rawConfig.forecast || {}) } };

  const t = config.forecast.type;
  if (t !== 'daily' && t !== 'hourly') {
    if (t !== undefined) warnings.push('forecast_type_invalid');
    config.forecast.type = 'daily';
  }
  return { config, warnings };
}
