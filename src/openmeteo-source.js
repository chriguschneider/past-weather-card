// Open-Meteo daily-sunshine fetcher.
//
// The card calls Open-Meteo's Forecast endpoint with `past_days` covering
// the visible station window plus `forecast_days` for the upcoming
// columns — one HTTP round-trip per refresh, no Archive call needed
// (Forecast supports up to past_days=92, well beyond the card's
// typical days=7..14 window).
//
// All fetch logic lives behind a class so the lifecycle (lazy load on
// first use, in-flight de-dup, abortable on disconnect, opaque retry)
// stays out of the render path.
//
// Unit-tested against a mocked fetch — see tests/openmeteo-source.test.js.

const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const DAY_MS = 24 * 60 * 60 * 1000;

// Refresh once per hour. Open-Meteo's free tier is 10 000 calls/day per
// IP — at most 24 calls/day per active dashboard tab, which is far
// below the threshold even for a household with several screens. The
// Forecast endpoint updates a few times per day, so an hourly poll
// catches new model runs without hammering the API.
const REFRESH_TTL_MS = 60 * 60 * 1000;

// LocalStorage key prefix. Keyed by lat/lon-rounded-to-2 so two
// dashboards at the same location share the cache, but a dashboard at
// a different location doesn't accidentally see stale far-away data.
const STORAGE_PREFIX = 'wsc_sunshine_';

// ── Pure helpers (testable without instantiating the source class) ──

// Builds the Forecast-endpoint URL. `includeHourly` adds the
// `hourly=sunshine_duration` parameter alongside `daily=…`, so a
// single call returns both granularities — used in hourly chart mode
// where the card renders one bar per hour.
export function buildOpenMeteoUrl(latitude, longitude, pastDays, forecastDays, includeHourly = false) {
  const p = new URLSearchParams({
    latitude: String(latitude),
    longitude: String(longitude),
    daily: 'sunshine_duration',
    timezone: 'auto',
    past_days: String(pastDays),
    forecast_days: String(forecastDays),
  });
  if (includeHourly) p.set('hourly', 'sunshine_duration');
  return `${FORECAST_URL}?${p.toString()}`;
}

// Open-Meteo emits two parallel arrays (`time`, `sunshine_duration`).
// Reshape into the {date, value} array attachSunshine consumes — same
// shape we'd accept from a user-built REST sensor, so the data layer
// downstream doesn't know or care which way the values arrived.
//
// Values come back in seconds; normalizeSunshineValue (in
// sunshine-source.js) does the sec→hours conversion at lookup time.
export function parseDailySunshine(response) {
  if (!response || !response.daily) return [];
  const t = response.daily.time || [];
  const v = response.daily.sunshine_duration || [];
  const out = [];
  for (let i = 0; i < t.length; i++) {
    if (v[i] != null) out.push({ date: t[i], value: v[i] });
  }
  return out;
}

// Hourly counterpart. Open-Meteo's hourly time strings are
// "YYYY-MM-DDTHH:MM" in the requested timezone (we use timezone=auto,
// matching the user's HA location). attachSunshine consumes these via
// localHourString matching.
//
// Values are seconds of sunshine within that hour, capped at 3600.
export function parseHourlySunshine(response) {
  if (!response || !response.hourly) return [];
  const t = response.hourly.time || [];
  const v = response.hourly.sunshine_duration || [];
  const out = [];
  for (let i = 0; i < t.length; i++) {
    if (v[i] != null) out.push({ datetime: t[i], value: v[i] });
  }
  return out;
}

function storageKey(lat, lon) {
  return `${STORAGE_PREFIX}${lat.toFixed(2)}_${lon.toFixed(2)}`;
}

// Best-effort persistence so a page reload doesn't always re-fetch.
// Returns null on any error (private mode, quota, JSON corruption, …).
function loadFromStorage(storage, lat, lon) {
  if (!storage) return null;
  try {
    const raw = storage.getItem(storageKey(lat, lon));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch (_) {
    return null;
  }
}

function saveToStorage(storage, lat, lon, payload) {
  if (!storage) return;
  try {
    storage.setItem(storageKey(lat, lon), JSON.stringify(payload));
  } catch (_) { /* quota / private-mode — silent */ }
}

// Read the cached daily array and count past vs forecast days. Used by
// the editor to surface "Open-Meteo currently has N forecast days for
// your location" so the user knows when their `forecast_days` setting
// outruns the available data (Open-Meteo's free Forecast endpoint
// returns 5–16 days depending on model and location).
//
// Returns null when nothing is cached for that location yet.
export function readCachedAvailability(latitude, longitude, storage, now = Date.now()) {
  const store = storage !== undefined
    ? storage
    : (typeof window !== 'undefined' && window.localStorage ? window.localStorage : null);
  if (!store) return null;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  const cached = loadFromStorage(store, latitude, longitude);
  if (!cached) return null;

  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const todayMs = today.getTime();

  const daily = Array.isArray(cached.daily) ? cached.daily : [];
  let pastDays = 0;
  let forecastDays = 0;
  for (const item of daily) {
    if (!item || !item.date) continue;
    const d = new Date(item.date);
    d.setHours(0, 0, 0, 0);
    const t = d.getTime();
    if (Number.isNaN(t)) continue;
    if (t < todayMs) pastDays += 1;
    else forecastDays += 1;
  }
  return {
    pastDays,
    forecastDays,
    lastFetchMs: Number(cached.lastFetchMs) || 0,
  };
}

// ── Source class ────────────────────────────────────────────────────

export class OpenMeteoSunshineSource {
  constructor({
    latitude,
    longitude,
    pastDays = 14,
    forecastDays = 8,
    includeHourly = false,
    fetchImpl,
    storage,
    now,
  } = {}) {
    this.latitude = latitude;
    this.longitude = longitude;
    this.pastDays = pastDays;
    this.forecastDays = forecastDays;
    this.includeHourly = includeHourly === true;
    // Allow overriding the fetch and storage implementations so the
    // tests can run in a Node environment without polluting globals.
    this._fetch = fetchImpl
      || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
    this._storage = storage !== undefined
      ? storage
      : (typeof window !== 'undefined' && window.localStorage ? window.localStorage : null);
    this._now = now || (() => Date.now());

    this._daily = [];
    this._hourly = [];
    this._lastFetchMs = 0;
    this._inFlight = null;
    this._abort = null;
    this._listener = null;

    if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
      const cached = loadFromStorage(this._storage, latitude, longitude);
      if (cached) {
        if (Array.isArray(cached.daily)) this._daily = cached.daily;
        if (Array.isArray(cached.hourly)) this._hourly = cached.hourly;
        this._lastFetchMs = Number(cached.lastFetchMs) || 0;
      }
    }
  }

  // Synchronous accessors — return whatever's in cache (may be empty
  // until ensureFresh resolves). attachSunshine picks the right one
  // based on the chart's granularity (daily vs hourly).
  getDailyValues() {
    return this._daily;
  }
  getHourlyValues() {
    return this._hourly;
  }

  // True when we should kick off a refresh (cache empty for the
  // currently-requested granularity, or stale).
  isStale(now = this._now()) {
    if (!this._daily.length) return true;
    if (this.includeHourly && !this._hourly.length) return true;
    return now - this._lastFetchMs >= REFRESH_TTL_MS;
  }

  // Subscribe a one-shot callback for refresh completion. Used by
  // main.js to call requestUpdate / measureCard once the data lands.
  setListener(cb) {
    this._listener = cb;
  }

  // Abort any in-flight fetch — call this on disconnectedCallback.
  abort() {
    if (this._abort) {
      try { this._abort.abort(); } catch (_) { /* aborted twice */ }
      this._abort = null;
    }
  }

  // Trigger a refresh if stale and none is already running. Returns the
  // in-flight promise so callers can await if they want to (most don't —
  // the listener handles "data arrived" notifications).
  async ensureFresh() {
    if (this._inFlight) return this._inFlight;
    if (!this.isStale()) return Promise.resolve();
    if (!this._fetch) return Promise.resolve();
    if (!Number.isFinite(this.latitude) || !Number.isFinite(this.longitude)) {
      return Promise.resolve();
    }

    this._abort = (typeof AbortController === 'function') ? new AbortController() : null;
    const signal = this._abort ? this._abort.signal : undefined;

    const url = buildOpenMeteoUrl(
      this.latitude, this.longitude, this.pastDays, this.forecastDays,
      this.includeHourly,
    );

    this._inFlight = (async () => {
      try {
        const res = await this._fetch(url, signal ? { signal } : undefined);
        if (!res || !res.ok) {
          throw new Error(`Open-Meteo HTTP ${res ? res.status : '<no response>'}`);
        }
        const json = await res.json();
        this._daily = parseDailySunshine(json);
        this._hourly = this.includeHourly ? parseHourlySunshine(json) : [];
        this._lastFetchMs = this._now();
        saveToStorage(this._storage, this.latitude, this.longitude, {
          daily: this._daily,
          hourly: this._hourly,
          lastFetchMs: this._lastFetchMs,
        });
        if (this._listener) this._listener({ ok: true });
      } catch (err) {
        // AbortError (disconnect) is expected — don't surface as a
        // problem. Anything else, log and notify the listener so the
        // chart can stay rendering with whatever stale cache it has.
        const isAbort = err && (err.name === 'AbortError' || err.code === 20);
        if (!isAbort) {
          // eslint-disable-next-line no-console
          console.warn('[weather-station-card] Open-Meteo fetch failed:', err);
          if (this._listener) this._listener({ ok: false, error: String(err) });
        }
      } finally {
        this._inFlight = null;
        this._abort = null;
      }
    })();

    return this._inFlight;
  }
}
