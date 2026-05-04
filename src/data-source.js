// DataSource: feeds the card a `forecast`-shaped array.
//
// The render layer consumes `this.forecasts` — an array of entries with
// fields `datetime`, `temperature`, `templow`, `precipitation`,
// `precipitation_probability`, `wind_speed`, `wind_bearing`, `pressure`,
// `humidity`, `uv_index`, `condition`. Anything that produces this shape
// can drive the chart.
//
// v1 ships MeasuredDataSource (past data via recorder/statistics_during_period).
// v2 will add a ForecastDataSource (wrapping weather/subscribe_forecast)
// for forecast-vs-actual overlays — same surface, no render-layer change.

import { classifyDay, clearSkyNoonLux } from './condition-classifier.js';

const POLL_INTERVAL_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function dayOfYearFromDate(date) {
  const start = new Date(date.getFullYear(), 0, 0);
  return Math.floor((date - start) / DAY_MS);
}

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
    const sensors = this.config.sensors || {};

    // Window ends at tomorrow midnight (exclusive) so today's partial-day
    // bucket is included as the rightmost column. We fetch one extra day
    // at the start (days+1) so a cumulative precipitation sensor has a
    // baseline value to diff against on the oldest displayed day.
    const end = new Date();
    end.setHours(0, 0, 0, 0);
    end.setDate(end.getDate() + 1);
    const start = new Date(end);
    start.setDate(start.getDate() - (days + 1));

    const entityIds = Object.values(sensors).filter(Boolean);
    if (entityIds.length === 0) return [];

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

      const precipitation = this._dailyPrecipitation(byDate[sensors.precipitation], dayKey, prevKey);

      out.push({
        datetime: dayStart.toISOString(),
        temperature: tempMax,
        templow: tempMin,
        precipitation,
        precipitation_probability: null,
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

  // Daily-rainfall extraction that adapts to the sensor's state_class:
  //
  //   total_increasing → API returns `change`     (use as-is)
  //   total            → API returns `sum`        (use as-is)
  //   measurement      → API returns max only     (diff max - prevMax)
  //
  // For the diff path a non-positive delta means the lifetime counter
  // reset between buckets (battery swap, device reinstall, integration
  // restart); fall back to today's max as the day's total in that case.
  _dailyPrecipitation(byDate, dayKey, prevKey) {
    if (!byDate) return null;
    const today = byDate.get(dayKey);
    if (!today) return null;

    if (today.change != null) return today.change;
    if (today.sum != null) return today.sum;
    if (today.max == null) return null;

    const yesterday = byDate.get(prevKey);
    if (yesterday && yesterday.max != null) {
      const delta = today.max - yesterday.max;
      return delta >= 0 ? delta : today.max;
    }
    return today.max;
  }

  _mapCondition(day) {
    const lat = this.hass && this.hass.config ? this.hass.config.latitude : null;
    const clearsky_lux = lat != null
      ? clearSkyNoonLux(lat, day.dayOfYear)
      : 110000; // sea-level perpendicular-sun fallback (IES)
    return classifyDay({ ...day, clearsky_lux }, this.config.condition_mapping || {});
  }
}
