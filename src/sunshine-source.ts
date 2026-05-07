// Pure helpers for the sunshine-duration row.
//
// No DOM, no Home Assistant — just data shaping. The card calls these from
// data-source.js (past tier) and main.js (post-processing pass that overlays
// history / forecast attributes onto the merged forecast array).
//
// The decisions encoded here come from issue #6 (decision A1 = Variant A:
// Methods F + C only; A2 = two slots; A3 = F2 forecast tier; A6 naming).

const DAY_MS = 24 * 60 * 60 * 1000;

/** Date-input shapes the lookup helpers accept. Strings go through `new
 *  Date(...)`; numbers are treated as ms since epoch. */
export type DateLike = Date | string | number;

/** Per-day sunshine entry. The card supports a few historic shapes
 *  (object with `date` + `value`, object map by date, [date, value]
 *  tuple) — `findInDateArray` normalises across them. */
export interface DailySunshineEntry {
  date?: string;
  datetime?: string;
  value?: number | string | null;
  sunshine?: number | string | null;
  duration?: number | string | null;
  sunshine_duration?: number | string | null;
}

/** Per-hour sunshine entry — Open-Meteo's hourly response after we
 *  reshape it into {datetime, value} pairs. */
export interface HourlySunshineEntry {
  datetime?: string;
  value?: number | string | null;
}

/** Loose envelope wrappers a user's REST template might emit. */
export type DailySunshineInput =
  | ReadonlyArray<DailySunshineEntry | [string, number | string]>
  | { history?: DailySunshineInput; forecast?: DailySunshineInput }
  | Record<string, number | string | null>;

export type HourlySunshineInput = ReadonlyArray<HourlySunshineEntry>;

/** Forecast entry shape this module operates on. Compatible with
 *  `ForecastEntry` from forecast-utils — kept loose here so the
 *  overlay can run before the rest of the pipeline has typed
 *  everything. */
export interface SunshineForecastEntry {
  datetime?: string;
  sunshine?: number | null;
  day_length?: number | null;
  [k: string]: unknown;
}

/** Options bag for `attachSunshine`. */
export interface AttachSunshineOpts {
  dailyValues?: DailySunshineInput | null;
  hourlyValues?: HourlySunshineInput | null;
  latitude?: number | null;
  granularity?: 'daily' | 'hourly';
  /** When the recorder sensor and the Open-Meteo overlay both come up
   *  empty, fall back to the Kasten-style estimator on
   *  `entry.cloud_coverage` (#6 Option F3). The exponent tunes the
   *  estimate; default 1.7 (mid-range of Kasten's 1.5–2.0). Off when
   *  null — the chart shows nothing for the column rather than a
   *  guess, matching the spec's "omit silently" behaviour for users
   *  who haven't opted in. */
  cloudCoverageExponent?: number | null;
}

// Solar declination in degrees (Cooper 1969). Same approximation the
// classifier uses — accurate to ~0.5°, enough for a day-length estimate.
function declinationDeg(dayOfYear: number): number {
  return 23.45 * Math.sin(((360 * (284 + dayOfYear)) / 365) * Math.PI / 180);
}

function dayOfYearOf(date: Date): number {
  const start = new Date(date.getFullYear(), 0, 0);
  return Math.floor((date.getTime() - start.getTime()) / DAY_MS);
}

/** Astronomical day length in hours for a given latitude and date.
 *  Standard sunrise-equation: cos(H₀) = -tan(φ)·tan(δ), day length =
 *  2 H₀ / 15° per hour. No atmospheric-refraction correction (~6 min
 *  at horizon — negligible at the 0.1 h granularity needed for the
 *  "fraction of day" scaling).
 *
 *  Edge cases: polar night → 0, midnight sun → 24, non-finite latitude
 *  → 12 (equinox fallback). */
export function dayLengthHours(latDeg: number | null | undefined, date: DateLike): number {
  if (!Number.isFinite(latDeg)) return 12;
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return 12;
  const decl = declinationDeg(dayOfYearOf(d)) * Math.PI / 180;
  const lat = (latDeg as number) * Math.PI / 180;
  const cosH = -Math.tan(lat) * Math.tan(decl);
  if (cosH <= -1) return 24;
  if (cosH >= 1) return 0;
  const H = Math.acos(cosH);
  return (2 * H * 180 / Math.PI) / 15;
}

/** Auto-detect whether a sensor reports sunshine duration in hours or
 *  seconds, return hours either way.
 *
 *  Heuristic: a calendar day cannot exceed 24 h of sunshine, but any
 *  non-trivial daily total in seconds will exceed 30 (= 0.5 min). So
 *  values ≥ 30 are interpreted as seconds and divided by 3600. Values
 *  below 30 are kept as hours. Conservative on both sides — at 30 s/day
 *  a sensor in seconds-mode would still flip correctly, and a real
 *  "0.5 h" reading (rare; deep winter twilight) is preserved.
 *
 *  Returns null for non-finite / non-numeric inputs. */
export function normalizeSunshineValue(raw: unknown): number | null {
  if (raw == null) return null;
  const n = typeof raw === 'number' ? raw : parseFloat(raw as string);
  if (!Number.isFinite(n)) return null;
  if (n < 0) return 0;
  return n >= 30 ? n / 3600 : n;
}

/** Local-date string YYYY-MM-DD for matching daily attribute entries.
 *  Open-Meteo's `daily=…` response uses local civil dates (with
 *  `timezone=auto`), so matching has to be done in the user's local
 *  timezone — not UTC. */
export function localDateString(date: DateLike): string | null {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Local-hour string YYYY-MM-DDTHH:00 for matching hourly attribute
 *  entries against Open-Meteo's hourly=sunshine_duration response.
 *  Minutes forced to :00 since the chart's hourly entries align to the
 *  hour and Open-Meteo emits one value per full hour. */
export function localHourString(date: DateLike): string | null {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  return `${y}-${m}-${day}T${h}:00`;
}

/** Find an entry by hourly key in an array of {datetime, value} items.
 *  Open-Meteo's datetime strings are "YYYY-MM-DDTHH:MM" — slice to the
 *  first 13 chars ("YYYY-MM-DDTHH") so a :30 minute mismatch (rare;
 *  would only happen if Chart.js entries drift off the hour) still
 *  aligns. */
export function findInHourArray(
  arr: HourlySunshineInput | null | undefined,
  hourKey: string | null | undefined,
): number | null {
  if (!Array.isArray(arr) || !hourKey) return null;
  const k = hourKey.slice(0, 13);
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    const itemKey = item.datetime != null ? String(item.datetime).slice(0, 13) : null;
    if (itemKey === k) return normalizeSunshineValue(item.value);
  }
  return null;
}

/** Look up a sunshine value in a date-keyed array attribute. Accepts
 *  several shapes since "the right format" depends on the user's REST
 *  template:
 *
 *    1. [{date: "YYYY-MM-DD", value: <number>}, …]      (preferred)
 *    2. [{datetime: "YYYY-MM-DD…", value: <number>}, …]
 *    3. {<YYYY-MM-DD>: <number>, …}                     (object map)
 *    4. ["YYYY-MM-DD", <number>] tuples                 (rare in HA examples)
 *
 *  `arr` may also carry an envelope — { history: [...] } or
 *  { forecast: [...] } — which we peel off here too for ergonomics.
 *
 *  Returns the matched value normalized via `normalizeSunshineValue`,
 *  or null if no match. */
export function findInDateArray(
  arr: DailySunshineInput | null | undefined,
  dateString: string | null | undefined,
): number | null {
  if (!arr || !dateString) return null;

  // Envelope unwrap.
  if (!Array.isArray(arr) && typeof arr === 'object') {
    const obj = arr as { history?: DailySunshineInput; forecast?: DailySunshineInput }
      & Record<string, number | string | null>;
    if (Array.isArray(obj.history)) return findInDateArray(obj.history, dateString);
    if (Array.isArray(obj.forecast)) return findInDateArray(obj.forecast, dateString);
    if (Object.prototype.hasOwnProperty.call(obj, dateString)) {
      return normalizeSunshineValue(obj[dateString]);
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

    const entry = item as DailySunshineEntry;
    const k = entry.date != null
      ? String(entry.date).slice(0, 10)
      : (entry.datetime != null ? String(entry.datetime).slice(0, 10) : null);
    if (!k) continue;
    if (k === dateString) {
      const v = entry.value != null ? entry.value
              : entry.sunshine != null ? entry.sunshine
              : entry.duration != null ? entry.duration
              : entry.sunshine_duration;
      return normalizeSunshineValue(v);
    }
  }
  return null;
}

/** Compose the sunshine field on each forecast entry. Non-destructive
 *  — returns a NEW array; the input forecasts are read-only.
 *
 *  Two modes, picked via opts.granularity:
 *    - 'daily' (default): match each entry against `dailyValues` by
 *      local YYYY-MM-DD. `day_length` comes from the astronomical
 *      sunrise equation; bar fractions later are sunshine_h / day_length.
 *    - 'hourly': match against `hourlyValues` by local
 *      YYYY-MM-DDTHH:00. `day_length` is fixed at 1 h (one bar = one
 *      hour) so a fully sunny hour fills the bar.
 *
 *  Always caps at the appropriate maximum (no negative noise, no
 *  70-minute hours) and normalizes seconds → hours via
 *  `normalizeSunshineValue` at lookup time. */
export function attachSunshine<T extends SunshineForecastEntry>(
  forecasts: ReadonlyArray<T>,
  opts?: AttachSunshineOpts | null,
): T[] {
  if (!Array.isArray(forecasts)) return [];
  if (!opts) return forecasts.map((f) => ({ ...f }));

  const { dailyValues, hourlyValues, latitude, granularity = 'daily', cloudCoverageExponent } = opts;
  const isHourly = granularity === 'hourly';

  return forecasts.map((entry) => {
    const out: T = { ...entry };
    const dt = entry.datetime ? new Date(entry.datetime) : null;
    if (!dt || Number.isNaN(dt.getTime())) {
      out.sunshine = null;
      out.day_length = null;
      return out;
    }

    let value: number | null;
    let cap: number;
    if (isHourly) {
      const hourKey = localHourString(dt);
      value = findInHourArray(hourlyValues, hourKey);
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
      if (cap > 0 && value > cap) value = cap;
      if (value < 0) value = 0;
    }
    // Preserve a pre-existing value from the upstream entry (e.g.
    // recorder daily-max set by `_buildForecast`). attachSunshine only
    // OVERLAYS the Open-Meteo value where upstream had nothing — past
    // days, today, and the synthetic future-day bucket all keep their
    // recorder value when one is configured. (#37 reverted the
    // earlier today-bucket substitution: today now reads the recorder
    // running daily-max like every other day, even though the value
    // is partial early in the day.)
    const existing = (entry as { sunshine?: number | null }).sunshine;
    if (existing != null && Number.isFinite(existing)) {
      out.sunshine = existing;
    } else if (value != null) {
      out.sunshine = value;
    } else if (
      cloudCoverageExponent != null
      && !isHourly
      && out.day_length != null
      && (out.day_length as number) > 0
    ) {
      // #6 Option F3: when neither the recorder sensor nor the
      // Open-Meteo overlay resolves a value, fall back to deriving
      // sunshine from the forecast's cloud_coverage via Kasten. Only
      // for daily granularity — hourly cloud_coverage is too coarse
      // to estimate per-hour sunshine accurately.
      const cc = (entry as { cloud_coverage?: number | null }).cloud_coverage;
      out.sunshine = sunshineFromCloudCoverageInline(cc, out.day_length as number, cloudCoverageExponent);
    } else {
      out.sunshine = null;
    }
    return out;
  });
}

// Inline copy of the Kasten formula — sunshine-source has no other
// dependency on forecast-utils today and importing one for a single
// closed-form computation would set up a back-reference. Equivalent
// to `sunshineFromCloudCoverage` exported from forecast-utils;
// duplicated to keep the dep graph one-way.
function sunshineFromCloudCoverageInline(
  cloudPercent: number | null | undefined,
  dayLengthH: number,
  exponent: number,
): number | null {
  if (cloudPercent == null || !Number.isFinite(cloudPercent)) return null;
  const cc = Math.max(0, Math.min(100, cloudPercent));
  const fraction = 1 - Math.pow(cc / 100, exponent);
  if (!Number.isFinite(fraction)) return null;
  return dayLengthH * Math.max(0, fraction);
}

/** Convert (sunshine_h, dayLength_h) pairs into the 0..1 fractions
 *  that the SunshineAxis bar dataset uses. Out-of-range pairs (null
 *  sunshine, missing/zero day length) come out as null so Chart.js
 *  draws a gap instead of a 0-height bar that would visually be a thin
 *  baseline stripe.
 *
 *  Used both at chart construction (drawChart) and on every data
 *  refresh (updateChart) — extracted so the same logic doesn't drift
 *  between the two call sites. */
export function sunshineFractions(
  sunshineHours: ReadonlyArray<number | null | undefined>,
  dayLengthHoursArr: ReadonlyArray<number | null | undefined> | null | undefined,
): Array<number | null> {
  if (!Array.isArray(sunshineHours)) return [];
  return sunshineHours.map((v, i) => {
    if (v == null) return null;
    const dl = Array.isArray(dayLengthHoursArr) ? dayLengthHoursArr[i] : null;
    if (!Number.isFinite(dl) || (dl as number) <= 0) return null;
    return Math.max(0, Math.min(1, v / (dl as number)));
  });
}

/** Source instance interface — typically an `OpenMeteoSunshineSource`,
 *  but any object with these two methods works. */
export interface SunshineSource {
  getDailyValues(): DailySunshineInput | null;
  getHourlyValues(): HourlySunshineInput | null;
}

interface HassLatLon {
  config?: { latitude?: number | null };
}

/** Compose the overlay opts from a Home Assistant `hass` object and an
 *  OpenMeteo source instance, then run `attachSunshine`. Pure —
 *  testable without instantiating LitElement / a real card.
 *
 *  Inputs:
 *    - forecasts: pre-merged station+forecast array (each entry
 *      already has `datetime`).
 *    - hass: { config: { latitude } }.
 *    - source: an object exposing `getDailyValues()` /
 *      `getHourlyValues()`. Typically an `OpenMeteoSunshineSource`.
 *    - granularity: 'daily' (default) or 'hourly'. Picks which array
 *      `attachSunshine` matches against.
 *
 *  Output: new forecasts array with `sunshine` + `day_length` attached. */
export function overlayFromOpenMeteo<T extends SunshineForecastEntry>(
  forecasts: ReadonlyArray<T>,
  hass: HassLatLon | null | undefined,
  source: Partial<SunshineSource> | null | undefined,
  granularity: 'daily' | 'hourly' = 'daily',
  cloudCoverageExponent: number | null = null,
): T[] {
  const lat = hass?.config ? hass.config.latitude : null;
  const dailyValues = source && typeof source.getDailyValues === 'function'
    ? source.getDailyValues()
    : null;
  const hourlyValues = source && typeof source.getHourlyValues === 'function'
    ? source.getHourlyValues()
    : null;
  return attachSunshine(forecasts, {
    dailyValues,
    hourlyValues,
    latitude: Number.isFinite(lat as number) ? lat as number : null,
    granularity,
    cloudCoverageExponent,
  });
}
