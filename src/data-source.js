// DataSource: feeds the card a `forecast`-shaped array.
//
// The render layer consumes `this.forecasts` — an array of entries with
// fields `datetime`, `temperature`, `templow`, `precipitation`,
// `wind_speed`, `wind_bearing`, `pressure`, `humidity`, `uv_index`,
// `condition`. Anything that produces this shape can drive the chart.
//
// MeasuredDataSource: past data via recorder/statistics_during_period.
// ForecastDataSource: future data via weather/subscribe_forecast.
// Both expose subscribe(callback) → unsubscribe and emit
// { forecast, error? } events.

import { classifyDay, clearSkyNoonLux, clearSkyLuxAt } from './condition-classifier.js';
import { WeatherEntityFeature } from './const.js';

const POLL_INTERVAL_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

function dayOfYearFromDate(date) {
  const start = new Date(date.getFullYear(), 0, 0);
  return Math.floor((date - start) / DAY_MS);
}

// Bucket-relative rainfall extraction that adapts to the sensor's
// `state_class`:
//   total_increasing → API returns `change`     (use as-is)
//   total            → API returns `sum`        (use as-is)
//   measurement      → API returns `max` only   (diff current.max − previous.max)
//
// For the diff path a non-positive delta means the lifetime counter
// reset between buckets (battery swap, device reinstall, integration
// restart); fall back to current bucket's max as the bucket total
// in that case.
//
// The function is bucket-size-agnostic — it works the same for daily
// and hourly statistics. Callers pass keys that match whatever bucket
// granularity they fetched (`period: 'day'` or `period: 'hour'`).
//
// Exported as a free function so the unit tests don't need to instantiate
// MeasuredDataSource.
export function bucketPrecipitation(byBucket, currentKey, previousKey) {
  if (!byBucket) return null;
  const current = byBucket.get(currentKey);
  if (!current) return null;

  if (current.change != null) return current.change;
  if (current.sum != null) return current.sum;
  if (current.max == null) return null;

  const previous = byBucket.get(previousKey);
  if (previous && previous.max != null) {
    const delta = current.max - previous.max;
    return delta >= 0 ? delta : current.max;
  }
  return current.max;
}

// Backwards-compatible alias for the daily-only call sites and existing
// tests that import the daily name. Internally identical to
// `bucketPrecipitation`.
export const dailyPrecipitation = bucketPrecipitation;

export class MeasuredDataSource {
  constructor(hass, config) {
    this.hass = hass;
    this.config = config;
    this._timer = null;
    this._listener = null;
    this._failureCount = 0;
  }

  setHass(hass) {
    this.hass = hass;
  }

  subscribe(callback) {
    this._listener = callback;
    this._poll();
    this._timer = setInterval(() => this._poll(), POLL_INTERVAL_MS);
    return () => this.unsubscribe();
  }

  unsubscribe() {
    this._listener = null;
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  async _poll() {
    if (!this._listener || !this.hass) return;
    try {
      const forecast = await this._fetchAggregates();
      this._failureCount = 0;
      if (this._listener) this._listener({ forecast });
    } catch (err) {
      this._failureCount += 1;
      console.error('[weather-station-card] statistics fetch failed', err);
      // After a few consecutive failures, surface to the render layer so
      // the card can display a banner instead of hanging on stale data.
      if (this._failureCount >= 3 && this._listener) {
        this._listener({ forecast: [], error: String(err && err.message ? err.message : err) });
      }
    }
  }

  async _fetchAggregates() {
    const days = parseInt(this.config.days, 10) || 7;
    const isHourly = (this.config.forecast && this.config.forecast.type) === 'hourly';
    const sensors = this.config.sensors || {};

    const entityIds = Object.values(sensors).filter(Boolean);
    if (entityIds.length === 0) return [];

    if (isHourly) {
      // Window ends at the next full hour (exclusive). We fetch one extra
      // hour at the start (hours+1) so a cumulative precipitation sensor
      // has a baseline value to diff against on the oldest displayed hour.
      const hours = days * 24;
      const end = new Date();
      end.setMinutes(0, 0, 0);
      end.setHours(end.getHours() + 1);
      const start = new Date(end.getTime() - (hours + 1) * HOUR_MS);

      const stats = await this.hass.callWS({
        type: 'recorder/statistics_during_period',
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        statistic_ids: entityIds,
        period: 'hour',
        types: ['min', 'max', 'mean', 'change', 'sum'],
      });

      return this._buildHourlyForecast(stats, sensors, start, hours);
    }

    // Daily path. Window ends at tomorrow midnight (exclusive) so today's
    // partial-day bucket is included as the rightmost column. We fetch
    // one extra day at the start (days+1) so a cumulative precipitation
    // sensor has a baseline value to diff against on the oldest day.
    const end = new Date();
    end.setHours(0, 0, 0, 0);
    end.setDate(end.getDate() + 1);
    const start = new Date(end);
    start.setDate(start.getDate() - (days + 1));

    const stats = await this.hass.callWS({
      type: 'recorder/statistics_during_period',
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      statistic_ids: entityIds,
      period: 'day',
      types: ['min', 'max', 'mean', 'change', 'sum'],
    });

    return this._buildForecast(stats, sensors, start, days);
  }

  _buildForecast(stats, sensors, start, days) {
    // Index each entity's series by midnight-of-day so day alignment doesn't
    // depend on positional indices (the API omits entries for empty days).
    const byDate = {};
    for (const [eid, series] of Object.entries(stats || {})) {
      const m = new Map();
      for (const entry of series || []) {
        const d = new Date(entry.start);
        d.setHours(0, 0, 0, 0);
        m.set(d.getTime(), entry);
      }
      byDate[eid] = m;
    }

    const dayMs = (date) => {
      const d = new Date(date);
      d.setHours(0, 0, 0, 0);
      return d.getTime();
    };

    const out = [];
    for (let i = 1; i <= days; i++) {
      const dayStart = new Date(start);
      dayStart.setDate(start.getDate() + i);
      const dayKey = dayMs(dayStart);
      const prevKey = dayKey - DAY_MS;

      const at = (eid, field) => {
        const m = byDate[eid];
        if (!m) return null;
        const e = m.get(dayKey);
        if (!e) return null;
        const v = e[field];
        return v === undefined ? null : v;
      };

      const tempMax = at(sensors.temperature, 'max');
      const tempMin = at(sensors.temperature, 'min');
      const humidityMean = at(sensors.humidity, 'mean');
      const pressureMean = at(sensors.pressure, 'mean');
      const windMean = at(sensors.wind_speed, 'mean');
      const gustMax = at(sensors.gust_speed, 'max');
      const luxMax = at(sensors.illuminance, 'max');
      const dewPointMean = at(sensors.dew_point, 'mean');

      const precipitation = dailyPrecipitation(byDate[sensors.precipitation], dayKey, prevKey);

      out.push({
        datetime: dayStart.toISOString(),
        temperature: tempMax,
        templow: tempMin,
        precipitation,
        wind_speed: windMean,
        wind_gust_speed: gustMax,
        wind_bearing: at(sensors.wind_direction, 'mean'),
        pressure: pressureMean,
        humidity: humidityMean,
        uv_index: at(sensors.uv_index, 'max'),
        condition: this._mapCondition({
          temp_max: tempMax,
          temp_min: tempMin,
          humidity: humidityMean,
          lux_max: luxMax,
          precip_total: precipitation,
          wind_mean: windMean,
          gust_max: gustMax,
          dew_point_mean: dewPointMean,
          dayOfYear: dayOfYearFromDate(dayStart),
        }),
      });
    }
    return out;
  }

  _mapCondition(day) {
    const lat = this.hass && this.hass.config ? this.hass.config.latitude : null;
    const clearsky_lux = lat != null
      ? clearSkyNoonLux(lat, day.dayOfYear)
      : 110000; // sea-level perpendicular-sun fallback (IES)
    return classifyDay({ ...day, clearsky_lux }, this.config.condition_mapping || {});
  }

  // Hourly counterpart to _buildForecast. Emits one entry per hour
  // (datetime = hour-start ISO). Differences from daily:
  //   - temperature is the hourly `mean` (single-line render — see
  //     hourlyTempSeries in forecast-utils.js).
  //   - templow is omitted; the chart hides dataset[1] when no entry
  //     carries a low.
  //   - precipitation uses bucketPrecipitation against the previous
  //     hour as baseline (same logic as daily, just at hour scale).
  //   - condition still goes through classifyDay; clear-sky lux is
  //     computed for the actual hour rather than the day's noon, so
  //     the cloud-cover ratio reflects the relevant solar geometry.
  //     Threshold semantics (rainy_threshold_mm etc.) are kept as-is
  //     and known to be conservative at hour scale — refining hourly
  //     thresholds is tracked as a v0.9 issue.
  _buildHourlyForecast(stats, sensors, start, hours) {
    const byHour = {};
    for (const [eid, series] of Object.entries(stats || {})) {
      const m = new Map();
      for (const entry of series || []) {
        const d = new Date(entry.start);
        d.setMinutes(0, 0, 0);
        m.set(d.getTime(), entry);
      }
      byHour[eid] = m;
    }

    const hourMs = (date) => {
      const d = new Date(date);
      d.setMinutes(0, 0, 0);
      return d.getTime();
    };

    // Recorder hourly buckets are only finalized after the hour ends, so
    // the current (in-progress) hour typically has null fields. For the
    // last entry we fall back to the entity's live state — which is what
    // the dashboard's "now" panel shows anyway, so it's both correct and
    // consistent UX.
    const liveOf = (eid) => {
      if (!eid || !this.hass || !this.hass.states) return null;
      const s = this.hass.states[eid];
      if (!s) return null;
      const v = parseFloat(s.state);
      return Number.isFinite(v) ? v : null;
    };

    const out = [];
    for (let i = 1; i <= hours; i++) {
      const hourStart = new Date(start.getTime() + i * HOUR_MS);
      const hourKey = hourMs(hourStart);
      const prevKey = hourKey - HOUR_MS;
      const isLastHour = i === hours;

      const at = (eid, field) => {
        const m = byHour[eid];
        if (!m) return null;
        const e = m.get(hourKey);
        if (!e) return null;
        const v = e[field];
        return v === undefined ? null : v;
      };
      // For the last (current, partial) hour: when the recorder hasn't
      // got the bucket yet, use the live state. For complete past hours
      // a missing entry is genuine missing data — keep null so Chart.js
      // draws a gap.
      const atOrLive = (eid, field) => {
        const v = at(eid, field);
        if (v != null || !isLastHour) return v;
        return liveOf(eid);
      };

      let tempMean = atOrLive(sensors.temperature, 'mean');
      let tempMax = at(sensors.temperature, 'max');
      let tempMin = at(sensors.temperature, 'min');
      const humidityMean = atOrLive(sensors.humidity, 'mean');
      const pressureMean = atOrLive(sensors.pressure, 'mean');
      const windMean = atOrLive(sensors.wind_speed, 'mean');
      const gustMax = atOrLive(sensors.gust_speed, 'max');
      const luxMax = atOrLive(sensors.illuminance, 'max');
      const dewPointMean = atOrLive(sensors.dew_point, 'mean');
      // For the last hour with only a single live datapoint, max/min
      // collapse to the same value so the classifier still gets numbers
      // to work with (otherwise temp_max/min stay null and several
      // classifier branches go through the no-data fallback).
      if (isLastHour) {
        if (tempMax == null) tempMax = tempMean;
        if (tempMin == null) tempMin = tempMean;
      }

      let precipitation = bucketPrecipitation(byHour[sensors.precipitation], hourKey, prevKey);
      if (isLastHour && precipitation == null && sensors.precipitation) {
        // Mirror the live-fill we do for temperature, scaled to the
        // bucketPrecipitation semantics: treat the entity's live state
        // as a synthetic "current.max" for the in-progress hour and
        // diff against the previous hour's recorded max. Works for
        // measurement-class cumulative counters (the user's typical
        // weather-station rain gauge); for total / total_increasing
        // sensors the recorder usually has `change` even for partial
        // hours, so this branch is only taken when it's actually
        // missing. Negative delta = counter reset between buckets,
        // mirror dailyPrecipitation by falling back to live as the
        // bucket total.
        const live = liveOf(sensors.precipitation);
        const map = byHour[sensors.precipitation];
        const prev = map ? map.get(prevKey) : null;
        if (live != null && prev && prev.max != null) {
          const delta = live - prev.max;
          precipitation = delta >= 0 ? delta : live;
        }
      }

      out.push({
        datetime: hourStart.toISOString(),
        temperature: tempMean,
        precipitation,
        wind_speed: windMean,
        wind_gust_speed: gustMax,
        wind_bearing: atOrLive(sensors.wind_direction, 'mean'),
        pressure: pressureMean,
        humidity: humidityMean,
        uv_index: atOrLive(sensors.uv_index, 'max'),
        condition: this._mapHourCondition({
          temp_max: tempMax,
          temp_min: tempMin,
          humidity: humidityMean,
          lux_max: luxMax,
          precip_total: precipitation,
          wind_mean: windMean,
          gust_max: gustMax,
          dew_point_mean: dewPointMean,
          hourStart,
        }),
      });
    }
    return out;
  }

  _mapHourCondition(hour) {
    const cfg = this.hass && this.hass.config;
    const lat = cfg ? cfg.latitude : null;
    const lon = cfg ? cfg.longitude : null;
    const clearsky_lux = (lat != null && lon != null)
      ? clearSkyLuxAt(lat, lon, hour.hourStart)
      : 110000;
    const { hourStart: _ignored, ...inputs } = hour;
    return classifyDay({ ...inputs, clearsky_lux }, this.config.condition_mapping || {}, 'hour');
  }
}

export class ForecastDataSource {
  constructor(hass, config) {
    this.hass = hass;
    this.config = config;
    this._listener = null;
    this._unsubPromise = null;
    this._lastEntity = null;
    this._lastType = null;
  }

  setHass(hass) {
    this.hass = hass;
    // Resubscribe if entity or forecast type changed via config edit.
    const entity = this.config.weather_entity;
    const type = (this.config.forecast && this.config.forecast.type) || 'daily';
    if (this._listener && (entity !== this._lastEntity || type !== this._lastType)) {
      this._resubscribe();
    }
  }

  subscribe(callback) {
    this._listener = callback;
    this._resubscribe();
    return () => this.unsubscribe();
  }

  async unsubscribe() {
    this._listener = null;
    const pending = this._unsubPromise;
    // Always clear the slot first so a subsequent unsubscribe() doesn't
    // await the same (possibly rejected) promise. If subscribeMessage
    // rejected, awaiting it again would just re-throw without progress.
    this._unsubPromise = null;
    if (!pending) return;
    try {
      const unsub = await pending;
      if (typeof unsub === 'function') unsub();
    } catch (_) { /* already gone or never landed */ }
  }

  _resubscribe() {
    if (this._unsubPromise) {
      const pending = this._unsubPromise;
      this._unsubPromise = null;
      pending.then(
        (unsub) => { try { if (typeof unsub === 'function') unsub(); } catch (_) {} },
        () => { /* rejected — nothing to dispose */ },
      );
    }
    const entity = this.config.weather_entity;
    if (!entity) {
      this._emit({ forecast: [], error: 'weather_entity not configured' });
      return;
    }
    const state = this.hass && this.hass.states && this.hass.states[entity];
    if (!state) {
      this._emit({ forecast: [], error: `weather entity "${entity}" not found` });
      return;
    }
    const type = (this.config.forecast && this.config.forecast.type) || 'daily';
    const isHourly = type === 'hourly';
    const feature = isHourly ? WeatherEntityFeature.FORECAST_HOURLY : WeatherEntityFeature.FORECAST_DAILY;
    const supported = state.attributes && state.attributes.supported_features;
    if (!supported || (supported & feature) === 0) {
      this._emit({ forecast: [], error: `entity "${entity}" does not support ${isHourly ? 'hourly' : 'daily'} forecasts` });
      return;
    }
    this._lastEntity = entity;
    this._lastType = type;
    try {
      this._unsubPromise = this.hass.connection.subscribeMessage(
        (event) => this._emit({ forecast: event.forecast || [] }),
        {
          type: 'weather/subscribe_forecast',
          forecast_type: isHourly ? 'hourly' : 'daily',
          entity_id: entity,
        },
      );
    } catch (err) {
      this._emit({ forecast: [], error: String(err && err.message ? err.message : err) });
    }
  }

  _emit(event) {
    if (this._listener) this._listener(event);
  }
}
