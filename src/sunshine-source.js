// Pure helpers for the sunshine-duration row.
//
// No DOM, no Home Assistant — just data shaping. The card calls these from
// data-source.js (past tier) and main.js (post-processing pass that overlays
// history / forecast attributes onto the merged forecast array).
//
// The decisions encoded here come from issue #6 (decision A1 = Variant A:
// Methods F + C only; A2 = two slots; A3 = F2 forecast tier; A6 naming).

const DAY_MS = 24 * 60 * 60 * 1000;

// Solar declination in degrees (Cooper 1969). Same approximation the
// classifier uses — accurate to ~0.5°, enough for a day-length estimate.
function declinationDeg(dayOfYear) {
  return 23.45 * Math.sin(((360 * (284 + dayOfYear)) / 365) * Math.PI / 180);
}

function dayOfYearOf(date) {
  const start = new Date(date.getFullYear(), 0, 0);
  return Math.floor((date - start) / DAY_MS);
}

// Astronomical day length in hours for a given latitude and date. Uses
// the standard sunrise-equation: cos(H₀) = -tan(φ) tan(δ), day length =
// 2 H₀ / 15° per hour. No atmospheric-refraction correction (~6 min at
// horizon — negligible at the 0.1 h granularity we care about for the
// "fraction of day" scaling).
//
// Edge cases:
//   - polar night (sun never rises): returns 0
//   - midnight sun (sun never sets):  returns 24
//   - non-finite latitude:            returns 12 (equinox fallback)
export function dayLengthHours(latDeg, date) {
  if (!Number.isFinite(latDeg)) return 12;
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return 12;
  const decl = declinationDeg(dayOfYearOf(d)) * Math.PI / 180;
  const lat = latDeg * Math.PI / 180;
  const cosH = -Math.tan(lat) * Math.tan(decl);
  if (cosH <= -1) return 24; // midnight sun
  if (cosH >= 1) return 0;   // polar night
  const H = Math.acos(cosH); // half-day-length, radians
  return (2 * H * 180 / Math.PI) / 15;
}

// Auto-detect whether a sensor reports sunshine duration in hours or
// seconds, return hours either way.
//
// The heuristic: a calendar day cannot exceed 24 hours of sunshine, but
// any non-trivial daily total in seconds will exceed 30 (= 0.5 min). So
// values ≥ 30 are interpreted as seconds and divided by 3600. Values
// below 30 are kept as hours. The cut-off is conservative on both sides
// — at 30 s/day a sensor in seconds-mode would still flip correctly,
// and a real "0.5 h" reading (rare; would correspond to deep winter
// twilight) is preserved.
//
// Returns null for non-finite / non-numeric inputs.
export function normalizeSunshineValue(raw) {
  if (raw == null) return null;
  const n = typeof raw === 'number' ? raw : parseFloat(raw);
  if (!Number.isFinite(n)) return null;
  if (n < 0) return 0; // clamp negative noise to zero
  return n >= 30 ? n / 3600 : n;
}

// Local-date string YYYY-MM-DD for matching daily attribute entries.
// Open-Meteo's `daily=…` response uses local civil dates (with
// `timezone=auto`), so matching has to be done in the user's local
// timezone — not UTC.
export function localDateString(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// Local-hour string YYYY-MM-DDTHH:MM for matching hourly attribute
// entries against Open-Meteo's hourly=sunshine_duration response.
// Minutes are forced to :00 since the chart's hourly entries align to
// the hour and Open-Meteo emits one value per full hour.
export function localHourString(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  return `${y}-${m}-${day}T${h}:00`;
}

// Find an entry by hourly key in an array of {datetime, value} items
// (the shape parseHourlySunshine emits). Open-Meteo's datetime strings
// are "YYYY-MM-DDTHH:MM" — we slice to the first 13 chars
// ("YYYY-MM-DDTHH") so a :30 minute mismatch (very rare; would only
// happen if Chart.js entries drift off the hour) still aligns.
export function findInHourArray(arr, hourKey) {
  if (!Array.isArray(arr) || !hourKey) return null;
  const k = hourKey.slice(0, 13);
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    const itemKey = item.datetime != null ? String(item.datetime).slice(0, 13) : null;
    if (itemKey === k) return normalizeSunshineValue(item.value);
  }
  return null;
}

// Look up a sunshine value in a date-keyed array attribute. Accepts a
// few shapes since "the right format" depends on what the user's REST
// template outputs:
//
//   1. [{date: "YYYY-MM-DD", value: <number>}, …]      (preferred)
//   2. [{datetime: "YYYY-MM-DD…", value: <number>}, …]
//   3. {<YYYY-MM-DD>: <number>, …}                     (object map)
//   4. ["YYYY-MM-DD", <number>] tuples                 (rare but used in HA examples)
//
// `arr` may also carry an envelope — { history: [...] } or
// { forecast: [...] } — which the caller normally peels off first; we
// peel here too for ergonomics.
//
// Returns the matched value normalized via normalizeSunshineValue, or
// null if no match.
export function findInDateArray(arr, dateString) {
  if (!arr || !dateString) return null;

  // Envelope unwrap.
  if (!Array.isArray(arr) && typeof arr === 'object') {
    if (Array.isArray(arr.history)) return findInDateArray(arr.history, dateString);
    if (Array.isArray(arr.forecast)) return findInDateArray(arr.forecast, dateString);
    // Fallthrough: treat as object-map (case 3).
    if (Object.prototype.hasOwnProperty.call(arr, dateString)) {
      return normalizeSunshineValue(arr[dateString]);
    }
    return null;
  }

  if (!Array.isArray(arr)) return null;

  for (const item of arr) {
    if (!item) continue;

    // Case 4: tuple [date, value].
    if (Array.isArray(item) && item.length >= 2) {
      const k = String(item[0] || '').slice(0, 10);
      if (k === dateString) return normalizeSunshineValue(item[1]);
      continue;
    }

    if (typeof item !== 'object') continue;

    // Cases 1 & 2: object with `date` or `datetime`.
    const k = item.date != null
      ? String(item.date).slice(0, 10)
      : (item.datetime != null ? String(item.datetime).slice(0, 10) : null);
    if (!k) continue;
    if (k === dateString) {
      const v = item.value != null ? item.value
              : item.sunshine != null ? item.sunshine
              : item.duration != null ? item.duration
              : item.sunshine_duration;
      return normalizeSunshineValue(v);
    }
  }
  return null;
}

// Compose the sunshine field on each forecast entry. Non-destructive —
// returns a NEW array; the input forecasts are read-only.
//
// Two modes, picked via opts.granularity:
//
//   - 'daily' (default): match each entry against `dailyValues` by
//     local YYYY-MM-DD. day_length comes from astronomical sunrise-eq;
//     bar fractions later are sunshine_h / day_length.
//
//   - 'hourly': match against `hourlyValues` by local YYYY-MM-DDTHH:00.
//     day_length is fixed at 1h (one bar = one hour), and a value
//     normalizes against that — a fully sunny hour fills the bar.
//
// Always caps at the appropriate maximum (no negative noise, no
// 70-minute hours) and normalizes seconds → hours via
// normalizeSunshineValue at lookup time.
export function attachSunshine(forecasts, opts) {
  if (!Array.isArray(forecasts)) return [];
  if (!opts) return forecasts.map((f) => ({ ...f }));

  const { dailyValues, hourlyValues, latitude, granularity = 'daily' } = opts;
  const isHourly = granularity === 'hourly';

  return forecasts.map((entry) => {
    const out = { ...entry };
    const dt = entry.datetime ? new Date(entry.datetime) : null;
    if (!dt || Number.isNaN(dt.getTime())) {
      out.sunshine = null;
      out.day_length = null;
      return out;
    }

    let value;
    let cap;
    if (isHourly) {
      const hourKey = localHourString(dt);
      value = findInHourArray(hourlyValues, hourKey);
      // One bar = one hour. The fraction calculation downstream uses
      // value / day_length, so day_length = 1 keeps a fully sunny hour
      // at fraction 1.0.
      out.day_length = 1;
      cap = 1;
    } else {
      const entryMidnight = new Date(dt);
      entryMidnight.setHours(0, 0, 0, 0);
      const dateKey = localDateString(entryMidnight);
      out.day_length = dayLengthHours(latitude, entryMidnight);
      value = findInDateArray(dailyValues, dateKey);
      cap = out.day_length;
    }

    if (value != null) {
      // Cap at the appropriate max so a misconfigured / over-long
      // reading doesn't break the bar-fraction scaling downstream.
      if (cap > 0 && value > cap) value = cap;
      if (value < 0) value = 0;
    }
    out.sunshine = value;
    return out;
  });
}

// Convert (sunshine_h, dayLength_h) pairs into the 0..1 fractions that
// the SunshineAxis bar dataset uses. Out-of-range pairs (null sunshine,
// missing/zero day length) come out as null so Chart.js draws a gap
// instead of a 0-height bar that would visually be a thin baseline
// stripe.
//
// Used both at chart construction (drawChart) and on every data refresh
// (updateChart) — extracted so the same logic doesn't drift between the
// two call sites.
export function sunshineFractions(sunshineHours, dayLengthHoursArr) {
  if (!Array.isArray(sunshineHours)) return [];
  return sunshineHours.map((v, i) => {
    if (v == null) return null;
    const dl = Array.isArray(dayLengthHoursArr) ? dayLengthHoursArr[i] : null;
    if (!Number.isFinite(dl) || dl <= 0) return null;
    return Math.max(0, Math.min(1, v / dl));
  });
}

// Compose the overlay opts from a Home Assistant `hass` object and an
// OpenMeteo source instance, then run attachSunshine. Pure — testable
// without instantiating LitElement / a real card.
//
// Inputs:
//   - forecasts: pre-merged station+forecast array (each entry already
//     has datetime).
//   - hass: { config: { latitude } }.
//   - source: an object exposing getDailyValues() / getHourlyValues().
//     Typically an OpenMeteoSunshineSource instance.
//   - granularity: 'daily' (default) or 'hourly'. Picks which array
//     attachSunshine matches against.
//
// Output: new forecasts array with sunshine + day_length attached.
export function overlayFromOpenMeteo(forecasts, hass, source, granularity = 'daily') {
  const lat = hass && hass.config ? hass.config.latitude : null;
  const dailyValues = source && typeof source.getDailyValues === 'function'
    ? source.getDailyValues()
    : null;
  const hourlyValues = source && typeof source.getHourlyValues === 'function'
    ? source.getHourlyValues()
    : null;
  return attachSunshine(forecasts, {
    dailyValues,
    hourlyValues,
    latitude: Number.isFinite(lat) ? lat : null,
    granularity,
  });
}
