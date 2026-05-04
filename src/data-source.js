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

const POLL_INTERVAL_MS = 60 * 60 * 1000;

export class MeasuredDataSource {
  constructor(hass, config) {
    this.hass = hass;
    this.config = config;
    this._timer = null;
    this._listener = null;
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
      if (this._listener) this._listener({ forecast });
    } catch (err) {
      console.error('[past-weather-card] statistics fetch failed', err);
    }
  }

  async _fetchAggregates() {
    const days = parseInt(this.config.days, 10) || 7;
    const sensors = this.config.sensors || {};

    const end = new Date();
    end.setHours(0, 0, 0, 0);
    const start = new Date(end);
    start.setDate(start.getDate() - days);

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
    const out = [];
    for (let i = 0; i < days; i++) {
      const dayStart = new Date(start);
      dayStart.setDate(start.getDate() + i);

      const pickAt = (eid, field) => {
        if (!eid) return null;
        const series = stats && stats[eid];
        if (!series || !series[i]) return null;
        const v = series[i][field];
        return v === undefined ? null : v;
      };

      const tempMax = pickAt(sensors.temperature, 'max');
      const tempMin = pickAt(sensors.temperature, 'min');

      // Precipitation source state_class varies (measurement vs total_increasing);
      // accept whichever aggregate the API returned.
      const precipChange = pickAt(sensors.precipitation, 'change');
      const precipSum = pickAt(sensors.precipitation, 'sum');
      const precipMax = pickAt(sensors.precipitation, 'max');
      const precipitation = precipChange ?? precipSum ?? precipMax ?? null;

      const gustMax = pickAt(sensors.gust_speed, 'max');
      const windMean = pickAt(sensors.wind_speed, 'mean');
      const luxMean = pickAt(sensors.illuminance, 'mean');

      out.push({
        datetime: dayStart.toISOString(),
        temperature: tempMax,
        templow: tempMin,
        precipitation,
        precipitation_probability: null,
        wind_speed: gustMax ?? windMean ?? null,
        wind_bearing: pickAt(sensors.wind_direction, 'mean'),
        pressure: pickAt(sensors.pressure, 'mean'),
        humidity: pickAt(sensors.humidity, 'mean'),
        uv_index: pickAt(sensors.uv_index, 'max'),
        condition: this._mapCondition({
          precipitation,
          lux: luxMean,
          gust: gustMax,
        }),
      });
    }
    return out;
  }

  _mapCondition({ precipitation, lux, gust }) {
    const m = this.config.condition_mapping || {};
    const rainyThresh = m.rainy_threshold_mm ?? 0.5;
    const windyThresh = m.windy_threshold_ms ?? 14;
    if (precipitation != null && precipitation >= rainyThresh) return 'rainy';
    if (gust != null && gust >= windyThresh) return 'windy';
    if (lux == null) return 'cloudy';
    if (lux >= 32000) return 'sunny';
    if (lux >= 10000) return 'partlycloudy';
    if (lux >= 100) return 'cloudy';
    return 'clear-night';
  }
}
