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
//   tempLow:  (number | null)[] | null
//             null when NO entry carries `templow` (pure hourly).
//             Otherwise a positional array with null entries for any
//             individual day where the recorder had no `min` reading
//             (sensor offline that day) — Chart.js draws a gap there
//             instead of dropping the whole second line.
//
// History (v1.0.1): the previous "all-or-nothing" rule (any null →
// tempLow returned as null entirely) hid the low-temp line in
// combination + station modes whenever a single past day had a
// missing min reading. Switched to "some have low" so a single
// offline day shows as a gap, not as a vanished dataset.
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
  let anyHaveLow = false;

  for (let i = 0; i < entries.length; i++) {
    const d = entries[i] || {};
    tempHigh[i] = r(d.temperature);
    if (typeof d.templow === 'undefined' || d.templow === null) {
      tempLow[i] = null;
    } else {
      tempLow[i] = r(d.templow);
      anyHaveLow = true;
    }
  }
  return {
    tempHigh,
    tempLow: anyHaveLow ? tempLow : null,
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

// Returns the local-midnight start-of-today as ms-since-epoch. Pure
// helper used by the midnight-transition guards below — kept as a
// function (rather than `Date.now() - Date.now() % DAY_MS`) so each
// caller picks up the user's local timezone and DST behaviour.
export function startOfTodayMs() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// Just past local midnight, two HA-side mismatches can show up at the
// chart's station/forecast boundary:
//
//   1. Forecast data still carries yesterday's daily entry. HA weather
//      integrations refresh on their own cadence (Open-Meteo a few times
//      per day, Met.no every model run), so for some minutes after
//      midnight the array can lead with a YYYY-MM-DD that is now
//      yesterday's date.
//
//   2. Station data has a "today" daily bucket that the recorder hasn't
//      aggregated yet — temperature / templow / precipitation are all
//      null. The Open-Meteo sunshine overlay fills `sunshine` from the
//      forecast value, producing a hybrid entry: sunshine bar visible,
//      no temperature line, no date label (the doubled-today plugin
//      suppresses the label at i = stationCount-1, expecting that
//      column to be the legitimate "today station" partner of "today
//      forecast"; an empty hybrid entry there shifts the framing onto
//      the wrong column).
//
// Both filters are pure on the array level. Apply them in
// `_refreshForecasts` once per merge so the same today-boundary is
// used for station + forecast.

// Drop forecast entries whose datetime is strictly before today's
// local midnight. Idempotent on already-clean arrays. Hourly forecasts
// pass through unchanged in practice (every hour from today onwards is
// "today or later").
export function filterMidnightStaleForecast(forecast, todayStartMs) {
  if (!Array.isArray(forecast)) return [];
  if (!Number.isFinite(todayStartMs)) return forecast.slice();
  return forecast.filter((entry) => {
    if (!entry || !entry.datetime) return true;
    const t = new Date(entry.datetime).getTime();
    if (!Number.isFinite(t)) return true;
    return t >= todayStartMs;
  });
}

// Drop the last station entry if it's "today" AND has no recorded
// data yet (recorder hasn't aggregated). Returns a new array; original
// unchanged. The "no recorded data" check is intentionally narrow
// (temperature + templow + precipitation): an offline-sensor
// historical day should NOT be filtered, since the chart still wants
// to show its column with whatever data IS present (e.g. a sunshine
// reading from a different sensor).
export function dropEmptyStationToday(station, todayStartMs) {
  if (!Array.isArray(station) || station.length === 0) return station;
  const last = station[station.length - 1];
  if (!last || !last.datetime) return station;
  const lastT = new Date(last.datetime).getTime();
  if (!Number.isFinite(lastT) || lastT < todayStartMs) return station;
  const noRecordedData = last.temperature == null
    && last.templow == null
    && last.precipitation == null;
  return noRecordedData ? station.slice(0, -1) : station;
}
