import locale from './locale.js';
import {
  cardinalDirectionsIcon,
  weatherIcons,
  weatherIconsDay,
  weatherIconsNight,
} from './const.js';
import {LitElement, html} from 'lit';
import './weather-station-card-editor.js';
import { MeasuredDataSource, ForecastDataSource } from './data-source.js';
import { classifyDay, clearSkyLuxAt } from './condition-classifier.js';
import { lightenColor, computeInitialScrollLeft } from './format-utils.js';
import {
  hourlyTempSeries,
  normalizeForecastMode,
  startOfTodayMs,
  filterMidnightStaleForecast,
  dropEmptyStationToday,
} from './forecast-utils.js';
import { overlayFromOpenMeteo, sunshineFractions } from './sunshine-source.js';
import { OpenMeteoSunshineSource } from './openmeteo-source.js';
import { safeQuery } from './utils/safe-query.js';
import { parseNumericSafe } from './utils/numeric.js';
import { setupScrollUx } from './scroll-ux.js';
import { setupActionHandler } from './action-handler.js';
import { drawChartUnsafe } from './chart/orchestrator.js';
import { cardStyles } from './chart/styles.js';
import {
  createSeparatorPlugin,
  createDailyTickLabelsPlugin,
  createPrecipLabelPlugin,
  createSunshineLabelPlugin,
} from './chart/plugins.js';
import { buildChart } from './chart/draw.js';
import { property } from 'lit/decorators.js';
import {Chart, registerables} from 'chart.js';
import ChartDataLabels from 'chartjs-plugin-datalabels';
Chart.register(...registerables, ChartDataLabels);

class WeatherStationCard extends LitElement {

static getConfigElement() {
  return document.createElement("weather-station-card-editor");
}

static getStubConfig(hass, unusedEntities, allEntities) {
  // Auto-detect station sensors by device_class. Fall back to entity-id
  // pattern matching for the precipitation case (no standard device_class
  // for cumulative rain on every integration).
  const findByClass = (cls) => {
    const all = allEntities || [];
    return all.find((eid) => {
      if (!eid.startsWith('sensor.')) return false;
      const st = hass && hass.states && hass.states[eid];
      return st && st.attributes && st.attributes.device_class === cls;
    });
  };
  const findByPattern = (re) => {
    const all = allEntities || [];
    return all.find((eid) => eid.startsWith('sensor.') && re.test(eid));
  };

  return {
    sensors: {
      temperature: findByClass('temperature') || '',
      humidity: findByClass('humidity') || '',
      illuminance: findByClass('illuminance') || '',
      // Prefer a daily-reset sensor (e.g. utility_meter cycle: daily) so the
      // statistics max-per-day equals the day's rainfall. A cumulative
      // (lifetime) sensor would yield the running total, not daily mm.
      precipitation: findByPattern(/precipitation_today/)
        || findByPattern(/precipitation_daily/)
        || findByPattern(/precipitation/)
        || '',
      pressure: findByClass('atmospheric_pressure') || findByClass('pressure') || '',
      wind_speed: findByClass('wind_speed') || '',
      gust_speed: findByPattern(/gust/) || '',
      wind_direction: findByPattern(/(direction|bearing|wind.?dir)/) || '',
      uv_index: findByPattern(/uv/) || '',
      dew_point: findByPattern(/dew/) || '',
    },
    days: 7,
    show_station: true,
    show_forecast: false,
    weather_entity: '',
    forecast_days: 7,
    show_main: false,
    show_temperature: true,
    show_current_condition: false,
    show_attributes: false,
    show_time: false,
    show_time_seconds: false,
    show_day: false,
    show_date: false,
    show_humidity: false,
    show_pressure: false,
    show_wind_direction: true,
    show_wind_speed: true,
    show_sun: false,
    show_dew_point: false,
    show_wind_gust_speed: false,
    use_12hour_format: false,
    icons_size: 25,
    animated_icons: false,
    icon_style: 'style1',
    forecast: {
      labels_font_size: '11',
      precip_bar_size: '100',
      // Default chart style: temperature labels rendered as plain text
      // beside the lines (no boxes around each value). 'style1' was the
      // legacy default with bordered boxes — kept as an opt-in.
      style: 'style2',
      show_wind_forecast: true,
      show_wind_arrow: true,
      condition_icons: true,
      show_date: true,
      round_temp: false,
      type: 'daily',
      number_of_forecasts: 8,
      disable_animation: false,
      // v0.9 sunshine duration. Off by default. When enabled, the card
      // fetches daily sunshine_duration from Open-Meteo directly using
      // hass.config.latitude / longitude — no extra sensor setup.
      show_sunshine: false,
      sunshine_color: 'rgba(255, 193, 7, 1.0)',
    },
  };
}

  static get properties() {
    return {
      _hass: {},
      config: {},
      language: {},
      sun: {type: Object},
      weather: {type: Object},
      temperature: {type: Object},
      humidity: {type: Object},
      pressure: {type: Object},
      windSpeed: {type: Object},
      windDirection: {type: Number},
      forecastChart: {type: Object},
      forecastItems: {type: Number},
      forecasts: { type: Array }
    };
  }

setConfig(config) {
  // tap/hold/double_tap default to 'none' — the card is read-only by
  // default and the user opts into actions via the editor.
  const cardConfig = {
    icons_size: 25,
    animated_icons: false,
    icon_style: 'style1',
    current_temp_size: 28,
    time_size: 26,
    day_date_size: 15,
    show_main: false,
    show_dew_point: false,
    show_wind_gust_speed: false,
    days: 7,
    sensors: {},
    tap_action: { action: 'none' },
    hold_action: { action: 'none' },
    double_tap_action: { action: 'none' },
    ...config,
    forecast: {
      labels_font_size: 11,
      chart_height: 180,
      precip_bar_size: 100,
      style: 'style2',
      temperature1_color: 'rgba(255, 152, 0, 1.0)',
      temperature2_color: 'rgba(68, 115, 158, 1.0)',
      precipitation_color: 'rgba(132, 209, 253, 1.0)',
      // v0.9 sunshine. Off by default to keep the chart unchanged for
      // users who upgrade without configuring a sunshine sensor.
      show_sunshine: false,
      sunshine_color: 'rgba(255, 193, 7, 1.0)',
      condition_icons: true,
      show_wind_forecast: true,
      show_wind_arrow: true,
      show_date: true,
      round_temp: false,
      type: 'daily',
      // Default viewport size in bars. With days=7 daily this is just
      // under "fit-all" (no scroll); at 7×24 = 168 hours hourly the
      // viewport caps at 8 hours visible and the user scrolls. Same
      // value across modes keeps the UI handle predictable.
      number_of_forecasts: 8,
      '12hourformat': false,
      ...config.forecast,
    },
    units: {
      pressure: 'hPa',
      ...config.units,
    }
  };

  cardConfig.units.speed = config.speed ? config.speed : cardConfig.units.speed;

  // Live-condition memoization (set hass) keys partly off `condition_mapping`;
  // wipe the cached entry so the next hass tick reclassifies with the new
  // mapping instead of returning a stale label.
  this._liveConditionKey = null;
  this._liveCondition = null;

  this.baseIconPath = cardConfig.icon_style === 'style2' ?
    'https://cdn.jsdelivr.net/gh/chriguschneider/weather-station-card/dist/icons2/':
    'https://cdn.jsdelivr.net/gh/chriguschneider/weather-station-card/dist/icons/' ;

  this.config = cardConfig;
  if (!cardConfig.sensors || !cardConfig.sensors.temperature) {
    throw new Error('Please define at least sensors.temperature in the card config');
  }
}

set hass(hass) {
  this._hass = hass;
  this.language = this.config.locale || hass.selectedLanguage || hass.language;
  this.sun = 'sun.sun' in hass.states ? hass.states['sun.sun'] : null;

  const sensors = this.config.sensors || {};
  const stateOf = (eid) => (eid && hass.states[eid]) ? hass.states[eid] : null;
  const valueOf = (eid) => { const s = stateOf(eid); return s ? s.state : undefined; };
  const attrOf = (eid, attr) => { const s = stateOf(eid); return s ? s.attributes[attr] : undefined; };

  // Source units come from the actual sensor entities; target units come
  // from config (or default to source). Keeping them separate is what
  // _convertWindSpeed / pressure conversion compare against — feeding the
  // target into both ends silently skips the conversion and the displayed
  // numbers stay in source units under a target-unit label.
  const sourceWindUnit = attrOf(sensors.wind_speed, 'unit_of_measurement')
    || attrOf(sensors.gust_speed, 'unit_of_measurement')
    || 'm/s';
  const sourcePressureUnit = attrOf(sensors.pressure, 'unit_of_measurement') || 'hPa';
  const sourceTempUnit = attrOf(sensors.temperature, 'unit_of_measurement') || '°C';

  this.unitSpeed = this.config.units.speed || sourceWindUnit;
  this.unitPressure = this.config.units.pressure || sourcePressureUnit;

  this.temperature = valueOf(sensors.temperature);
  this.humidity = valueOf(sensors.humidity);
  this.pressure = valueOf(sensors.pressure);
  this.uv_index = valueOf(sensors.uv_index);
  this.windSpeed = valueOf(sensors.wind_speed);
  this.dew_point = valueOf(sensors.dew_point);
  this.wind_gust_speed = valueOf(sensors.gust_speed);
  this.windDirection = sensors.wind_direction && hass.states[sensors.wind_direction]
    ? parseFloat(hass.states[sensors.wind_direction].state)
    : undefined;

  // Live "now" condition derived from current sensor states. The same
  // classifier is used as for daily forecast columns, just fed with
  // instantaneous values and an instantaneous clear-sky reference.
  // Precipitation only contributes when the sensor reports a rate
  // (unit ends in /h) — cumulative counters can't be turned into a
  // current rate without extra history and would otherwise spuriously
  // trigger 'rainy' on a dry day.
  const nowTemp = parseNumericSafe(this.temperature);
  const luxNow = parseNumericSafe(valueOf(sensors.illuminance));
  const precipUnit = attrOf(sensors.precipitation, 'unit_of_measurement') || '';
  const precipIsRate = /\/(h|hr|hour)$/i.test(precipUnit);
  const precipRateNow = precipIsRate ? parseNumericSafe(valueOf(sensors.precipitation)) : null;
  const lat = hass.config && hass.config.latitude;
  const lon = hass.config && hass.config.longitude;

  // Memoize: classifyDay walks an ~80-line decision tree and clearSkyLuxAt
  // does ~4 trig ops + cos. Across the 2–5 hass ticks per second that
  // arrive when many entities update at once, the inputs rarely change
  // — sensors update at a far slower cadence than HA's WebSocket fan-out.
  // Cache key buckets the time at minute precision so clearskyNow drift
  // doesn't break the cache (lux moves ~50 lx/minute under a clear sky,
  // immaterial to the cloud-ratio threshold). Cache invalidates on
  // setConfig (condition_mapping changes) — see setConfig.
  const minuteKey = Math.floor(Date.now() / 60_000);
  const conditionKey =
    nowTemp + '|' + luxNow + '|' + precipRateNow + '|' +
    this.humidity + '|' + this.windSpeed + '|' + this.wind_gust_speed + '|' +
    this.dew_point + '|' + minuteKey;
  let currentCondition;
  if (this._liveConditionKey === conditionKey) {
    currentCondition = this._liveCondition;
  } else {
    const clearskyNow = lat != null && lon != null
      ? clearSkyLuxAt(lat, lon, new Date())
      : 110000;
    // precip_total here is precipRateNow — an instantaneous rate (mm/h)
    // when the sensor reports a /h unit. Use period: 'hour' so the
    // precipitation thresholds match the rate semantics, not 24 h totals.
    currentCondition = classifyDay({
      temp_max: nowTemp,
      temp_min: nowTemp,
      humidity: parseNumericSafe(this.humidity),
      lux_max: luxNow,
      precip_total: precipRateNow,
      wind_mean: parseNumericSafe(this.windSpeed),
      gust_max: parseNumericSafe(this.wind_gust_speed),
      dew_point_mean: parseNumericSafe(this.dew_point),
      clearsky_lux: clearskyNow,
    }, this.config.condition_mapping || {}, 'hour');
    this._liveConditionKey = conditionKey;
    this._liveCondition = currentCondition;
  }

  // Synthesized stand-in for the original weather entity. The *_unit fields
  // here represent the SOURCE units (what the data layer actually emits);
  // the conversion code compares them against this.unitSpeed / unitPressure
  // to decide whether to convert.
  this.weather = {
    state: currentCondition,
    attributes: {
      wind_speed_unit: sourceWindUnit,
      pressure_unit: sourcePressureUnit,
      temperature_unit: sourceTempUnit,
      temperature: this.temperature,
      humidity: this.humidity,
      pressure: this.pressure,
      uv_index: this.uv_index,
      wind_speed: this.windSpeed,
      wind_bearing: this.windDirection,
      dew_point: this.dew_point,
      wind_gust_speed: this.wind_gust_speed,
      supported_features: 0,
    },
  };

  this._stationData = this._stationData || [];
  this._forecastData = this._forecastData || [];

  const wantStation = this.config.show_station !== false;
  const wantForecast = this.config.show_forecast === true && !!this.config.weather_entity;

  // Both subscribe callbacks are invoked from HA's WebSocket listener
  // (ForecastDataSource) or our own polling timer (MeasuredDataSource).
  // A throw out of the callback would propagate into those code paths
  // and could detach the listener — wrap each body in try/catch so the
  // chart can recover via _chartError instead.
  if (wantStation) {
    if (!this._dataSource) {
      this._dataSource = new MeasuredDataSource(hass, this.config);
      this._dataUnsubscribe = this._dataSource.subscribe((event) => {
        try {
          this._stationData = event.forecast || [];
          this._stationError = event.error || null;
          this._refreshForecasts();
        } catch (err) {
          console.error('[weather-station-card] station callback failed', err);
        }
      });
    } else {
      this._dataSource.setHass(hass);
    }
  } else if (this._dataSource) {
    this._teardownStation();
    this._stationError = null;
  }

  if (wantForecast) {
    if (!this._forecastSource) {
      this._forecastSource = new ForecastDataSource(hass, this.config);
      this._forecastUnsubscribe = this._forecastSource.subscribe((event) => {
        try {
          this._forecastData = event.forecast || [];
          this._forecastError = event.error || null;
          this._refreshForecasts();
        } catch (err) {
          console.error('[weather-station-card] forecast callback failed', err);
        }
      });
    } else {
      this._forecastSource.setHass(hass);
    }
  } else if (this._forecastSource) {
    this._teardownForecast();
    this._forecastError = null;
  }

  // Initial merge so forecasts is at least an empty array (not undefined).
  if (!this.forecasts) this._refreshForecasts();

  // Detect missing/unavailable sensor entities for the render-time banner.
  this._missingSensors = [];
  for (const [key, eid] of Object.entries(sensors)) {
    if (!eid) continue;
    const s = hass.states[eid];
    if (!s || s.state === 'unavailable' || s.state === 'unknown') {
      this._missingSensors.push(`${key} (${eid})`);
    }
  }
}

  constructor() {
    super();
    this.resizeObserver = null;
    this.resizeInitialized = false;
  }

  connectedCallback() {
    super.connectedCallback();
    if (!this.resizeInitialized) {
      this.delayedAttachResizeObserver();
    }
  }

  delayedAttachResizeObserver() {
    setTimeout(() => {
      this.attachResizeObserver();
      this.resizeInitialized = true;
    }, 0);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.detachResizeObserver();
    this._teardownStation();
    this._teardownForecast();
    this._teardownInitialScrollObserver();
    if (this._sunshineSource) {
      this._sunshineSource.abort();
      this._sunshineSource = null;
    }
    if (this._scrollUxTeardown) {
      this._scrollUxTeardown();
      this._scrollUxTeardown = null;
    }
    if (this._actionHandlerTeardown) {
      this._actionHandlerTeardown();
      this._actionHandlerTeardown = null;
    }
    if (this._clockTimer) {
      clearInterval(this._clockTimer);
      this._clockTimer = null;
    }
  }

  _refreshForecasts() {
    // normalizeForecastMode validates forecast.type (typo'd values fall
    // back to 'daily'). Station block is now coherent at hourly too —
    // MeasuredDataSource fetches with period:'hour' when the type is
    // hourly — so the previous show_station-override at hourly is gone.
    const { config: effectiveCfg } = normalizeForecastMode(this.config);
    let station = effectiveCfg.show_station !== false ? (this._stationData || []) : [];
    let forecast = [];
    // Midnight-transition guards (see filterMidnightStaleForecast and
    // dropEmptyStationToday below). Cached locally so the same `today`
    // boundary is used for both station + forecast filters within one
    // refresh tick.
    const todayStartMs = startOfTodayMs();
    if (effectiveCfg.show_forecast === true && effectiveCfg.weather_entity) {
      // `days` / `forecast_days` are the data-loading window in days for
      // both modes; at hourly each day expands to 24 buckets.
      const isHourly = effectiveCfg.forecast.type === 'hourly';
      const slotsPerUnit = isHourly ? 24 : 1;
      const cap = parseInt(effectiveCfg.forecast_days, 10);
      const limit = (cap > 0 ? cap : (parseInt(effectiveCfg.days, 10) || 7)) * slotsPerUnit;
      forecast = filterMidnightStaleForecast(this._forecastData || [], todayStartMs)
        .slice(0, limit);
    }
    station = dropEmptyStationToday(station, todayStartMs);
    this._stationCount = station.length;
    this._forecastCount = forecast.length;
    this._ensureSunshineSource(effectiveCfg);
    const granularity = effectiveCfg.forecast.type === 'hourly' ? 'hourly' : 'daily';
    this.forecasts = overlayFromOpenMeteo(
      [...station, ...forecast],
      this._hass,
      this._sunshineSource,
      granularity,
    );
    this.requestUpdate();
    // measureCard() recomputes forecastItems from the new this.forecasts
    // length and then redraws. Going through it (instead of calling
    // drawChart() directly) prevents a stale forecastItems set by an
    // earlier ResizeObserver tick from cropping the merged array.
    //
    // Data callbacks can fire before Lit's first render has built the
    // shadow root. Skip the redraw in that window — firstUpdated() will
    // call measureCard() once the DOM is in place.
    if (this.shadowRoot) this.measureCard();
  }

  // Lazy-init the Open-Meteo source on first use, tear it down when the
  // user toggles sunshine off, and trigger a fetch when the cache is
  // stale (no-op if a fetch is already in flight). The source's
  // listener calls _refreshForecasts again so the chart redraws once
  // the data lands.
  _ensureSunshineSource(effectiveCfg) {
    const enabled = effectiveCfg && effectiveCfg.forecast
      && effectiveCfg.forecast.show_sunshine === true;
    if (!enabled) {
      if (this._sunshineSource) {
        this._sunshineSource.abort();
        this._sunshineSource = null;
      }
      return;
    }
    const cfg = this._hass && this._hass.config;
    const lat = cfg && Number.isFinite(cfg.latitude) ? cfg.latitude : null;
    const lon = cfg && Number.isFinite(cfg.longitude) ? cfg.longitude : null;
    if (lat == null || lon == null) return;

    const includeHourly = effectiveCfg.forecast.type === 'hourly';

    // Re-create when location or hourly-mode flag changes — the
    // includeHourly flag determines whether the request URL carries
    // `hourly=…`, so flipping it requires a fresh fetch.
    const same = this._sunshineSource
      && this._sunshineSource.latitude === lat
      && this._sunshineSource.longitude === lon
      && this._sunshineSource.includeHourly === includeHourly;
    if (!same) {
      if (this._sunshineSource) this._sunshineSource.abort();
      const days = parseInt(effectiveCfg.days, 10) || 7;
      const fcDays = parseInt(effectiveCfg.forecast_days, 10) || days;
      this._sunshineSource = new OpenMeteoSunshineSource({
        latitude: lat,
        longitude: lon,
        // +1 covers today's column when station block ends at today's
        // local midnight (the entry has datetime today 00:00).
        pastDays: Math.min(92, days + 1),
        forecastDays: Math.min(16, fcDays + 1),
        includeHourly,
      });
      this._sunshineSource.setListener((event) => {
        // On a successful refresh, recompute the forecasts so the new
        // sunshine values land on the entries — and redraw the chart.
        if (event && event.ok) this._refreshForecasts();
      });
    }
    // Fire-and-forget — the listener handles the redraw on completion.
    this._sunshineSource.ensureFresh();
  }

  attachResizeObserver() {
    // Section-grid resizes fire many ResizeObserver ticks per frame.
    // measureCard → drawChart destroys + recreates the Chart.js instance,
    // and doing that synchronously dozens of times confuses both Chart.js
    // and HA's grid layout — the card briefly drops out of the render tree
    // and only reappears after a hard reload. Coalesce into one rAF tick.
    this.resizeObserver = new ResizeObserver(() => {
      if (this._resizeRaf) return;
      this._resizeRaf = requestAnimationFrame(() => {
        this._resizeRaf = null;
        this.measureCard();
      });
    });
    const card = this.shadowRoot.querySelector('ha-card');
    if (card) {
      this.resizeObserver.observe(card);
    }
  }

  detachResizeObserver() {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    if (this._resizeRaf) {
      cancelAnimationFrame(this._resizeRaf);
      this._resizeRaf = null;
    }
  }

measureCard() {
  // Callers (firstUpdated, ResizeObserver, _refreshForecasts) all gate on
  // shadowRoot existence — the only thing left to guard is the ha-card
  // element itself, which can briefly be missing during teardown.
  const card = safeQuery(this.shadowRoot,'ha-card');
  if (!card) return;

  // forecastItems is the count of bars actually rendered. v0.8 treats
  // forecast.number_of_forecasts as a *viewport size* (handled in render
  // via overflow-x scroll), not as a data-cropping cap — so this always
  // renders the full series. Width-based auto-fit only kicks in when no
  // data is loaded yet (initial render before the data sources fire).
  if (this.forecasts && this.forecasts.length) {
    this.forecastItems = this.forecasts.length;
  } else {
    const fontSize = this.config.forecast.labels_font_size;
    this.forecastItems = Math.round(card.offsetWidth / (fontSize * 6));
  }
  this.drawChart();
}

ll(str) {
  const selectedLocale = this.config.locale || this.language || 'en';

  if (locale[selectedLocale] === undefined) {
    return locale.en[str];
  }

  return locale[selectedLocale][str];
}

  getCardSize() {
    return 4;
  }

  getUnit(unit) {
    return this._hass.config.unit_system[unit] || '';
  }

  getWeatherIcon(condition, sun) {
    if (this.config.animated_icons === true) {
      const iconName = sun === 'below_horizon' ? weatherIconsNight[condition] : weatherIconsDay[condition];
      return `${this.baseIconPath}${iconName}.svg`;
    } else if (this.config.icons) {
      const iconName = sun === 'below_horizon' ? weatherIconsNight[condition] : weatherIconsDay[condition];
      return `${this.config.icons}${iconName}.svg`;
    }
    return weatherIcons[condition];
  }

getWindDirIcon(deg) {
  if (typeof deg === 'number') {
    return cardinalDirectionsIcon[parseInt((deg + 22.5) / 45.0)];
  } else {
    let i = 9;
    switch (deg) {
      case "N":
        i = 0;
        break;
      case "NNE":
      case "NE":
        i = 1;
        break;
      case "ENE":
      case "E":
        i = 2;
        break;
      case "ESE":
      case "SE":
        i = 3;
        break;
      case "SSE":
      case "S":
        i = 4;
        break;
      case "SSW":
      case "SW":
        i = 5;
        break;
      case "WSW":
      case "W":
        i = 6;
        break;
      case "NW":
      case "NNW":
        i = 7;
        break;
      case "WNW":
        i = 8;
        break;
      default:
        i = 9;
        break;
    }
    return cardinalDirectionsIcon[i];
  }
}

getWindDir(deg) {
  if (typeof deg === 'number') {
    return this.ll('cardinalDirections')[parseInt((deg + 11.25) / 22.5)];
  } else {
    return deg;
  }
}

calculateBeaufortScale(windSpeed) {
  const unitConversion = {
    'km/h': 1,
    'm/s': 3.6,
    'mph': 1.60934,
  };

  const wind_speed_unit = this.weather && this.weather.attributes
    ? this.weather.attributes.wind_speed_unit
    : null;
  const conversionFactor = unitConversion[wind_speed_unit] || unitConversion['m/s'];
  const windSpeedInKmPerHour = windSpeed * conversionFactor;

  if (windSpeedInKmPerHour < 1) return 0;
  else if (windSpeedInKmPerHour < 6) return 1;
  else if (windSpeedInKmPerHour < 12) return 2;
  else if (windSpeedInKmPerHour < 20) return 3;
  else if (windSpeedInKmPerHour < 29) return 4;
  else if (windSpeedInKmPerHour < 39) return 5;
  else if (windSpeedInKmPerHour < 50) return 6;
  else if (windSpeedInKmPerHour < 62) return 7;
  else if (windSpeedInKmPerHour < 75) return 8;
  else if (windSpeedInKmPerHour < 89) return 9;
  else if (windSpeedInKmPerHour < 103) return 10;
  else if (windSpeedInKmPerHour < 118) return 11;
  else return 12;
}

async firstUpdated(changedProperties) {
  super.firstUpdated(changedProperties);
  this.measureCard();
  await new Promise(resolve => setTimeout(resolve, 0));
  this.drawChart();
}


async updated(changedProperties) {
  await this.updateComplete;

  // Re-attempt action-handler binding after every render. Lit can swap
  // the <ha-card> element when the render branch changes (the
  // weather-undefined fallback uses a different template than the
  // populated branch); the per-element _wsActionHandlerBound flag
  // makes this idempotent on stable elements.
  setupActionHandler(this);
  this._maybeApplyInitialScroll(changedProperties);
  setupScrollUx(this);

  if (changedProperties.has('config')) {
    const oldConfig = changedProperties.get('config');
    if (oldConfig) {
      this._invalidateStaleSources(oldConfig);

      // Pure render-only config changes (round_temp, colours, labels, …)
      // re-merge against existing forecasts; teardowns above will refill
      // anyway via the next `set hass` tick. forecast_days alone only
      // crops what we already have, so trigger refresh even with no data
      // currently merged.
      const forecastDaysChanged = this.config.forecast_days !== oldConfig.forecast_days;
      if ((this.forecasts && this.forecasts.length) || forecastDaysChanged) {
        try { this._refreshForecasts(); } catch (e) { console.error('[weather-station-card] redraw failed', e); }
      }
    }
  }

  if (changedProperties.has('weather')) {
    this.updateChart();
  }
}

// Tear down whichever data source had a config dependency change. The next
// `set hass` tick rebuilds the source with the new config and emits a fresh
// merge via _refreshForecasts. Adding a new field that drives a source is
// a one-line edit to the keys table, not a new branch in updated().
_invalidateStaleSources(oldConfig) {
  const get = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
  const stale = (key) => JSON.stringify(get(this.config, key)) !== JSON.stringify(get(oldConfig, key));
  // forecast.type now also drives MeasuredDataSource (hourly station
  // aggregates use period:'hour'), so toggling it must rebuild both
  // sources, not just ForecastDataSource.
  const STATION_KEYS = ['sensors', 'days', 'show_station', 'forecast.type'];
  const FORECAST_KEYS = ['show_forecast', 'weather_entity', 'forecast.type'];
  if (STATION_KEYS.some(stale)) this._teardownStation();
  if (FORECAST_KEYS.some(stale)) this._teardownForecast();
}

_teardownStation() {
  if (this._dataUnsubscribe) { this._dataUnsubscribe(); this._dataUnsubscribe = null; }
  this._dataSource = null;
  this._stationData = [];
}

_teardownForecast() {
  if (this._forecastUnsubscribe) { this._forecastUnsubscribe(); this._forecastUnsubscribe = null; }
  this._forecastSource = null;
  this._forecastData = [];
}

drawChart(args) {
  try {
    const result = drawChartUnsafe(this, args);
    if (this._chartError) {
      this._chartError = null;
      this.requestUpdate();
    }
    return result;
  } catch (e) {
    // The phase tag (set by chart/orchestrator's drawChartUnsafe before each sub-step)
    // tells us where we crashed — without it, the banner just says "render
    // failed" and we have to repro to find the spot. Falls back to "draw"
    // for failures that happen outside any tagged step.
    const phase = this._chartPhase || 'draw';
    console.error(`[weather-station-card] chart ${phase} failed`, e);
    if (this.forecastChart) {
      try { this.forecastChart.destroy(); } catch (_) { /* already gone */ }
      this.forecastChart = null;
    }
    const msg = String(e && e.message ? e.message : e);
    this._chartError = `${phase}: ${msg}`;
    this._chartPhase = null;
    this.requestUpdate();
  }
}

computeForecastData({ config, forecastItems } = this) {
  const forecast = this.forecasts ? this.forecasts.slice(0, forecastItems) : [];
  const dateTime = forecast.map((d) => d.datetime);
  const { tempHigh, tempLow } = hourlyTempSeries(forecast, {
    roundTemp: config.forecast.round_temp == true,
  });
  const precip = forecast.map((d) => d.precipitation);
  // Sunshine columns. Each entry has a normalized hours value (or null
  // when no source resolved) and a day_length the bar is scaled against.
  const sunshine = forecast.map((d) => (d.sunshine != null ? d.sunshine : null));
  const dayLength = forecast.map((d) => (d.day_length != null ? d.day_length : null));

  return {
    forecast,
    dateTime,
    tempHigh,
    // tempLow is null when no entry has `templow` (hourly forecast). Coerce
    // to [] so the dataset builder downstream — which indexes by position —
    // doesn't choke. The single-line decision (hide dataset[1]) lives in
    // chart/orchestrator, gated on `tempLow === null` from hourlyTempSeries.
    tempLow: tempLow || [],
    // Track the high/low intent separately so the chart layer can decide
    // whether to render a second temperature line; null means hourly /
    // single-line, otherwise daily / two-line.
    tempLowAvailable: tempLow !== null,
    precip,
    sunshine,
    dayLength,
  };
}

updateChart({ forecasts, forecastChart } = this) {
  if (!forecasts || !forecasts.length) {
    return [];
  }

  const data = this.computeForecastData();

  if (forecastChart) {
    forecastChart.data.labels = data.dateTime;
    forecastChart.data.datasets[0].data = data.tempHigh;
    forecastChart.data.datasets[1].data = data.tempLow;
    forecastChart.data.datasets[2].data = data.precip;
    // Sunshine dataset is appended at index 3 only when the toggle is
    // on — gate the update so we don't write into a non-existent slot
    // for users who haven't enabled it.
    if (forecastChart.data.datasets[3]) {
      forecastChart.data.datasets[3].data = sunshineFractions(data.sunshine, data.dayLength);
    }
    forecastChart.update();
  }
}

// Renders the daily ↔ hourly mode toggle as a small circular button
// overlaid on the chart at the precipitation-baseline level. Only
// visible when there's a station OR forecast block to switch
// (`forecast.type` drives both MeasuredDataSource period:hour|day
// and ForecastDataSource forecast_type — toggling is meaningful
// whenever any block renders, including station-only).
renderModeToggle() {
  const cfg = this.config || {};
  const showsStation = cfg.show_station !== false;
  const showsForecast = cfg.show_forecast === true && !!cfg.weather_entity;
  if (!showsStation && !showsForecast) return '';
  const isHourly = (cfg.forecast || {}).type === 'hourly';
  const icon = isHourly ? 'mdi:calendar-month-outline' : 'mdi:clock-time-eight-outline';
  const label = isHourly ? 'Switch to daily forecast' : 'Switch to hourly forecast';
  return html`
    <button type="button" class="mode-toggle" aria-label="${label}"
            aria-pressed="${isHourly ? 'true' : 'false'}" title="${label}"
            @click=${this._onModeToggleClick}>
      <ha-icon icon=${icon} aria-hidden="true"></ha-icon>
    </button>
  `;
}

// Toggle between daily and hourly via the same setConfig path the
// editor uses. _invalidateStaleSources picks up the forecast.type
// change and rebuilds both station and forecast data sources, so
// hourly station aggregates load on demand. The mutation does NOT
// persist to the user's saved YAML — refresh resets to whatever
// they configured. For permanent changes, the editor's radio.
_onModeToggleClick(ev) {
  if (ev) ev.stopPropagation();
  const cfg = this.config || {};
  const fcfg = cfg.forecast || {};
  const next = fcfg.type === 'hourly' ? 'daily' : 'hourly';
  this.setConfig({ ...cfg, forecast: { ...fcfg, type: next } });
}

  render({config, _hass, weather} = this) {
    if (!config || !_hass) {
      return html``;
    }
    // Match the mm-unit sizing rule from precipLabelPlugin so the wind unit
    // ("km/h", "m/s", …) renders at the same compact size as the precip unit
    // alongside its number.
    const labelsBaseSize = parseInt(config && config.forecast && config.forecast.labels_font_size) || 11;
    const labelsSmallSize = Math.max(6, Math.round(labelsBaseSize * 0.5));
    if (!weather || !weather.attributes) {
      return html`
        <style>
          .card {
            padding-top: ${config.title? '0px' : '16px'};
            padding-right: 16px;
            padding-bottom: 16px;
            padding-left: 16px;
          }
        </style>
        <ha-card header="${config.title}">
          <div class="card">
            Please, check your weather entity
          </div>
        </ha-card>
      `;
    }
    // forecast.number_of_forecasts is the visible viewport size in bars.
    // setConfig defaults this to 8 across both modes, so the same
    // mechanism handles daily (8 ≥ totalBars=7 → no scroll, fits all)
    // and hourly (8 < totalBars=168 → scrollable, viewport caps at
    // ~8 hours). 0 disables the viewport entirely (legacy "fit-all"
    // for users who explicitly set it).
    const visibleBars = parseInt(config.forecast.number_of_forecasts, 10) || 0;
    const totalBars = (this.forecasts || []).length;
    const scrolling = visibleBars > 0 && totalBars > visibleBars;
    const contentWidthPct = scrolling ? (totalBars / visibleBars) * 100 : 100;

    return html`
      <style>${cardStyles({
        iconsSize: config.icons_size,
        currentTempSize: config.current_temp_size,
        timeSize: config.time_size,
        dayDateSize: config.day_date_size,
        chartHeight: config.forecast.chart_height,
        titlePresent: !!config.title,
        labelsSmallSize,
        labelsBaseSize,
      })}</style>

      <ha-card header="${config.title}">
        <div class="card">
          ${this.renderErrorBanner()}
          ${this.renderMain()}
          ${this.renderAttributes()}
          <div class="forecast-scroll-block">
            <div class="forecast-scroll ${scrolling ? 'scrolling' : ''}">
              <div class="forecast-content" style="width: ${contentWidthPct}%">
                <div class="chart-container">
                  <canvas id="forecastChart"></canvas>
                </div>
                ${this.renderForecastConditionIcons()}
                ${this.renderWind()}
              </div>
            </div>
            ${this.renderModeToggle()}
            ${scrolling ? html`
              <button type="button" class="scroll-indicator scroll-indicator-left" aria-label="Scroll left" hidden>
                <ha-icon icon="mdi:chevron-left" aria-hidden="true"></ha-icon>
              </button>
              <button type="button" class="scroll-indicator scroll-indicator-right" aria-label="Scroll right" hidden>
                <ha-icon icon="mdi:chevron-right" aria-hidden="true"></ha-icon>
              </button>
              <button type="button" class="jump-to-now" aria-label="Jump to now" title="Jump to now" hidden>
                <ha-icon icon="mdi:crosshairs-gps" aria-hidden="true"></ha-icon>
              </button>
            ` : ''}
            ${scrolling && config.forecast.type === 'hourly' ? html`
              <div class="scroll-date scroll-date-left" hidden></div>
              <div class="scroll-date scroll-date-right" hidden></div>
            ` : ''}
          </div>
        </div>
      </ha-card>
    `;
  }

renderErrorBanner() {
  const errors = [];
  if (this._stationError) {
    errors.push(`Statistics fetch failed: ${this._stationError}`);
  }
  if (this._forecastError) {
    errors.push(`Forecast unavailable: ${this._forecastError}`);
  }
  if (this._chartError) {
    errors.push(`Chart render failed: ${this._chartError}`);
  }
  if (this._missingSensors && this._missingSensors.length) {
    errors.push(`Sensors unavailable: ${this._missingSensors.join(', ')}`);
  }
  if (!errors.length) return html``;
  return html`
    <div style="background: var(--error-color, #b71c1c); color: white; padding: 8px 12px; margin: 8px; border-radius: 4px; font-size: 13px;">
      ${errors.map((e) => html`<div>${e}</div>`)}
    </div>
  `;
}

renderMain({ config, sun, weather, temperature } = this) {
  if (config.show_main === false)
    return html``;

  const use12HourFormat = config.use_12hour_format;
  const showTime = config.show_time;
  const showDay = config.show_day;
  const showDate = config.show_date;
  const showCurrentCondition = config.show_current_condition !== false;
  const showTemperature = config.show_temperature !== false;
  const showSeconds = config.show_time_seconds === true;

  let roundedTemperature = parseFloat(temperature);
  if (!isNaN(roundedTemperature) && roundedTemperature % 1 !== 0) {
    roundedTemperature = Math.round(roundedTemperature * 10) / 10;
  }

  const iconHtml = config.animated_icons || config.icons
    ? html`<img src="${this.getWeatherIcon(weather.state, sun.state)}" alt="">`
    : html`<ha-icon icon="${this.getWeatherIcon(weather.state, sun.state)}"></ha-icon>`;

  const updateClock = () => {
    const currentDate = new Date();
    const timeOptions = {
      hour12: use12HourFormat,
      hour: 'numeric',
      minute: 'numeric',
      second: showSeconds ? 'numeric' : undefined
    };
    const currentTime = currentDate.toLocaleTimeString(this.language, timeOptions);
    const currentDayOfWeek = currentDate.toLocaleString(this.language, { weekday: 'long' }).toUpperCase();
    const currentDateFormatted = currentDate.toLocaleDateString(this.language, { month: 'long', day: 'numeric' });

    const mainDiv = this.shadowRoot.querySelector('.main');
    if (mainDiv) {
      const clockElement = mainDiv.querySelector('#digital-clock');
      if (clockElement) {
        clockElement.textContent = currentTime;
      }
      if (showDay) {
        const dayElement = mainDiv.querySelector('.date-text.day');
        if (dayElement) {
          dayElement.textContent = currentDayOfWeek;
        }
      }
      if (showDate) {
        const dateElement = mainDiv.querySelector('.date-text.date');
        if (dateElement) {
          dateElement.textContent = currentDateFormatted;
        }
      }
    }
  };

  updateClock();

  if (this._clockTimer) {
    clearInterval(this._clockTimer);
    this._clockTimer = null;
  }
  if (showTime) {
    this._clockTimer = setInterval(updateClock, 1000);
  }

  return html`
    <div class="main">
      ${iconHtml}
      <div>
        <div>
          ${showTemperature ? html`${roundedTemperature}<span>${this.getUnit('temperature')}</span>` : ''}
          ${showCurrentCondition ? html`
            <div class="current-condition">
              <span>${this.ll(weather.state)}</span>
            </div>
          ` : ''}
        </div>
        ${showTime ? html`
          <div class="current-time">
            <div id="digital-clock"></div>
            ${showDay ? html`<div class="date-text day"></div>` : ''}
            ${showDay && showDate ? html` ` : ''}
            ${showDate ? html`<div class="date-text date"></div>` : ''}
          </div>
        ` : ''}
      </div>
    </div>
  `;
}

renderAttributes({ config, humidity, pressure, windSpeed, windDirection, sun, language, uv_index, dew_point, wind_gust_speed } = this) {
  let dWindSpeed = windSpeed;
  let dPressure = pressure;

  if (this.unitSpeed !== this.weather.attributes.wind_speed_unit) {
    if (this.unitSpeed === 'm/s') {
      if (this.weather.attributes.wind_speed_unit === 'km/h') {
        dWindSpeed = Math.round(windSpeed * 1000 / 3600);
      } else if (this.weather.attributes.wind_speed_unit === 'mph') {
        dWindSpeed = Math.round(windSpeed * 0.44704);
      }
    } else if (this.unitSpeed === 'km/h') {
      if (this.weather.attributes.wind_speed_unit === 'm/s') {
        dWindSpeed = Math.round(windSpeed * 3.6);
      } else if (this.weather.attributes.wind_speed_unit === 'mph') {
        dWindSpeed = Math.round(windSpeed * 1.60934);
      }
    } else if (this.unitSpeed === 'mph') {
      if (this.weather.attributes.wind_speed_unit === 'm/s') {
        dWindSpeed = Math.round(windSpeed / 0.44704);
      } else if (this.weather.attributes.wind_speed_unit === 'km/h') {
        dWindSpeed = Math.round(windSpeed / 1.60934);
      }
    } else if (this.unitSpeed === 'Bft') {
      dWindSpeed = this.calculateBeaufortScale(windSpeed);
    }
  } else {
    dWindSpeed = Math.round(dWindSpeed);
  }

  if (this.unitPressure !== this.weather.attributes.pressure_unit) {
    if (this.unitPressure === 'mmHg') {
      if (this.weather.attributes.pressure_unit === 'hPa') {
        dPressure = Math.round(pressure * 0.75006);
      } else if (this.weather.attributes.pressure_unit === 'inHg') {
        dPressure = Math.round(pressure * 25.4);
      }
    } else if (this.unitPressure === 'hPa') {
      if (this.weather.attributes.pressure_unit === 'mmHg') {
        dPressure = Math.round(pressure / 0.75006);
      } else if (this.weather.attributes.pressure_unit === 'inHg') {
        dPressure = Math.round(pressure * 33.8639);
      }
    } else if (this.unitPressure === 'inHg') {
      if (this.weather.attributes.pressure_unit === 'mmHg') {
        dPressure = pressure / 25.4;
      } else if (this.weather.attributes.pressure_unit === 'hPa') {
        dPressure = pressure / 33.8639;
      }
      dPressure = dPressure.toFixed(2);
    }
  } else {
    if (this.unitPressure === 'hPa' || this.unitPressure === 'mmHg') {
      dPressure = Math.round(dPressure);
    }
  }

  if (config.show_attributes == false)
    return html``;

  const showHumidity = config.show_humidity !== false;
  const showPressure = config.show_pressure !== false;
  const showWindDirection = config.show_wind_direction !== false;
  const showWindSpeed = config.show_wind_speed !== false;
  const showSun = config.show_sun !== false;
  const showDewpoint = config.show_dew_point == true;
  const showWindgustspeed = config.show_wind_gust_speed == true;

return html`
    <div class="attributes">
      ${((showHumidity && humidity !== undefined) || (showPressure && dPressure !== undefined) || (showDewpoint && dew_point !== undefined)) ? html`
        <div>
          ${showHumidity && humidity !== undefined ? html`
            <ha-icon icon="hass:water-percent"></ha-icon> ${humidity} %<br>
          ` : ''}
          ${showPressure && dPressure !== undefined ? html`
            <ha-icon icon="hass:gauge"></ha-icon> ${dPressure} ${this.ll('units')[this.unitPressure]} <br>
          ` : ''}
          ${showDewpoint && dew_point !== undefined ? html`
            <ha-icon icon="hass:thermometer-water"></ha-icon> ${dew_point} ${this.weather.attributes.temperature_unit} <br>
          ` : ''}
        </div>
      ` : ''}
      ${((showSun && sun !== undefined) || (typeof uv_index !== 'undefined' && uv_index !== undefined)) ? html`
        <div>
          ${typeof uv_index !== 'undefined' && uv_index !== undefined ? html`
            <div>
              <ha-icon icon="hass:white-balance-sunny"></ha-icon> UV: ${Math.round(uv_index * 10) / 10}
            </div>
          ` : ''}
          ${showSun && sun !== undefined ? html`
            <div>
              ${this.renderSun({ sun, language })}
            </div>
          ` : ''}
        </div>
      ` : ''}
      ${((showWindDirection && windDirection !== undefined) || (showWindSpeed && dWindSpeed !== undefined)) ? html`
        <div>
          ${showWindDirection && windDirection !== undefined ? html`
            <ha-icon icon="hass:${this.getWindDirIcon(windDirection)}"></ha-icon> ${this.getWindDir(windDirection)} <br>
          ` : ''}
          ${showWindSpeed && dWindSpeed !== undefined ? html`
            <ha-icon icon="hass:weather-windy"></ha-icon>
            ${dWindSpeed} ${this.ll('units')[this.unitSpeed]} <br>
          ` : ''}
          ${showWindgustspeed && wind_gust_speed !== undefined ? html`
            <ha-icon icon="hass:weather-windy-variant"></ha-icon>
            ${this._convertWindSpeed(parseFloat(wind_gust_speed))} ${this.ll('units')[this.unitSpeed]}
          ` : ''}
        </div>
      ` : ''}
    </div>
`;
}

renderSun({ sun, language, config } = this) {
  if (sun == undefined) {
    return html``;
  }

const use12HourFormat = this.config.use_12hour_format;
const timeOptions = {
    hour12: use12HourFormat,
    hour: 'numeric',
    minute: 'numeric'
};

  return html`
    <ha-icon icon="mdi:weather-sunset-up"></ha-icon>
      ${new Date(sun.attributes.next_rising).toLocaleTimeString(language, timeOptions)}<br>
    <ha-icon icon="mdi:weather-sunset-down"></ha-icon>
      ${new Date(sun.attributes.next_setting).toLocaleTimeString(language, timeOptions)}
  `;
}

renderForecastConditionIcons({ config, forecastItems, sun } = this) {
  const forecast = this.forecasts ? this.forecasts.slice(0, forecastItems) : [];

  if (config.forecast.condition_icons === false) {
    return html``;
  }

  return html`
    <div class="conditions">
      ${forecast.map((item) => {
        const forecastTime = new Date(item.datetime);
        const sunriseTime = new Date(sun.attributes.next_rising);
        const sunsetTime = new Date(sun.attributes.next_setting);

        // Adjust sunrise and sunset times to match the date of forecastTime
        const adjustedSunriseTime = new Date(forecastTime);
        adjustedSunriseTime.setHours(sunriseTime.getHours());
        adjustedSunriseTime.setMinutes(sunriseTime.getMinutes());
        adjustedSunriseTime.setSeconds(sunriseTime.getSeconds());

        const adjustedSunsetTime = new Date(forecastTime);
        adjustedSunsetTime.setHours(sunsetTime.getHours());
        adjustedSunsetTime.setMinutes(sunsetTime.getMinutes());
        adjustedSunsetTime.setSeconds(sunsetTime.getSeconds());

        let isDayTime;

        if (config.forecast.type === 'daily') {
          // For daily forecast, assume it's day time
          isDayTime = true;
        } else {
          // For other forecast types, determine based on sunrise and sunset times
          isDayTime = forecastTime >= adjustedSunriseTime && forecastTime <= adjustedSunsetTime;
        }

        const weatherIcons = isDayTime ? weatherIconsDay : weatherIconsNight;
        const condition = item.condition;

        let iconHtml;

        if (config.animated_icons || config.icons) {
          const iconSrc = config.animated_icons ?
            `${this.baseIconPath}${weatherIcons[condition]}.svg` :
            `${this.config.icons}${weatherIcons[condition]}.svg`;
          iconHtml = html`<img class="icon" src="${iconSrc}" alt="">`;
        } else {
          iconHtml = html`<ha-icon icon="${this.getWeatherIcon(condition, sun.state)}"></ha-icon>`;
        }

        return html`
          <div class="forecast-item">
            ${iconHtml}
          </div>
        `;
      })}
    </div>
  `;
}

renderWind({ config, weather, windSpeed, windDirection, forecastItems } = this) {
  const showWindForecast = config.forecast.show_wind_forecast !== false;
  if (!showWindForecast) return html``;

  // Per-column wind direction arrow can be hidden via forecast.show_wind_arrow
  // (default true). When kept on but the column gets too narrow for arrow +
  // speed side-by-side, .wind-detail's flex-wrap drops the speed below the
  // arrow — see chart/styles.js.
  const showArrow = config.forecast.show_wind_arrow !== false;
  const forecast = this.forecasts ? this.forecasts.slice(0, forecastItems) : [];
  const unit = this.ll('units')[this.unitSpeed];

  return html`
    <div class="wind-details">
      ${forecast.map((item) => {
        const raw = item.wind_gust_speed != null ? item.wind_gust_speed : item.wind_speed;
        const dWindSpeed = this._convertWindSpeed(raw);
        const hasSpeed = dWindSpeed !== null && dWindSpeed !== undefined;
        const hasBearing = item.wind_bearing != null;
        // Some integrations (notably HA's Open-Meteo at forecast_type:
        // 'hourly') only ship `temperature` / `precipitation` / `condition`
        // and omit wind fields entirely. Without these guards
        // getWindDirIcon(undefined) falls into its default branch and
        // every cell shows the same arrow, while the unit span renders
        // an orphan "km/h". Suppress each piece independently so
        // partial-data integrations also display cleanly.
        return html`
          <div class="wind-detail">
            ${showArrow && hasBearing ? html`
              <ha-icon class="wind-icon" icon="hass:${this.getWindDirIcon(item.wind_bearing)}"></ha-icon>
            ` : ''}
            ${hasSpeed ? html`
              <span class="wind-value">
                <span class="wind-speed">${dWindSpeed}</span>
                <span class="wind-unit">${unit}</span>
              </span>
            ` : ''}
          </div>
        `;
      })}
    </div>
  `;
}

_convertWindSpeed(raw) {
  if (raw === null || raw === undefined) return null;
  const fromUnit = this.weather.attributes.wind_speed_unit;
  if (this.unitSpeed === fromUnit) return Math.round(raw);
  if (this.unitSpeed === 'm/s') {
    if (fromUnit === 'km/h') return Math.round(raw * 1000 / 3600);
    if (fromUnit === 'mph') return Math.round(raw * 0.44704);
  } else if (this.unitSpeed === 'km/h') {
    if (fromUnit === 'm/s') return Math.round(raw * 3.6);
    if (fromUnit === 'mph') return Math.round(raw * 1.60934);
  } else if (this.unitSpeed === 'mph') {
    if (fromUnit === 'm/s') return Math.round(raw / 0.44704);
    if (fromUnit === 'km/h') return Math.round(raw / 1.60934);
  } else if (this.unitSpeed === 'Bft') {
    return this.calculateBeaufortScale(raw);
  }
  return Math.round(raw);
}

  _fire(type, detail, options) {
    const node = this.shadowRoot;
    options = options || {};
    detail = (detail === null || detail === undefined) ? {} : detail;
    const event = new Event(type, {
      bubbles: options.bubbles === undefined ? true : options.bubbles,
      cancelable: Boolean(options.cancelable),
      composed: options.composed === undefined ? true : options.composed
    });
    event.detail = detail;
    node.dispatchEvent(event);
    return event;
  }

  // Apply the "scroll to now" position once per render generation.
  // A generation changes when forecast.type or number_of_forecasts
  // change — outside those, we leave scrollLeft alone so the user's
  // manual scroll position survives data refreshes (which fire every
  // hour from MeasuredDataSource).
  _maybeApplyInitialScroll(changedProperties) {
    const wrapper = safeQuery(this.shadowRoot,'.forecast-scroll.scrolling');
    if (!wrapper) {
      // Non-scrolling render (or before first paint). Mark unapplied so
      // the next scrolling render re-positions.
      this._initialScrollApplied = false;
      return;
    }
    const cfg = this.config || {};
    const fcfg = cfg.forecast || {};
    const stationCount = this._stationCount || 0;
    const forecastCount = this._forecastCount || 0;
    const wantsStation = cfg.show_station !== false;
    const wantsForecast = cfg.show_forecast === true && !!cfg.weather_entity;
    // Defer the initial scroll until every block we *intend* to render
    // has data. Otherwise the forecast-loads-before-station case (the
    // ForecastDataSource WebSocket subscribe usually replies sooner
    // than the recorder/statistics_during_period roundtrip) hits the
    // forecast-only branch — scrollLeft 0 — and pins that position via
    // _initialScrollApplied before station data arrives. The result is
    // a combination card that opens scrolled to the start of station
    // history rather than centred on "now".
    const dataReady =
      (!wantsStation || stationCount > 0) &&
      (!wantsForecast || forecastCount > 0);
    if (!dataReady) {
      this._initialScrollApplied = false;
      return;
    }
    const generationKey = `${fcfg.type || 'daily'}|${fcfg.number_of_forecasts || 0}`;

    let needsReset = !this._initialScrollApplied;
    if (changedProperties && changedProperties.has('config') && this._lastScrollGeneration
        && this._lastScrollGeneration !== generationKey) {
      needsReset = true;
    }
    if (!needsReset) return;

    // Tear down any in-flight observer / frame from a previous call —
    // e.g. when the user flips forecast.type while a previous settle
    // wait is still pending.
    this._teardownInitialScrollObserver();

    const apply = () => {
      if (!wrapper.isConnected) return false;
      // Lit's updateComplete guarantees DOM commit but NOT that browser
      // layout has measured the .forecast-content's `width: <ratio>%`
      // CSS, NOR that Chart.js has finished sizing the canvas inside
      // it — at the first paint scrollWidth can still equal clientWidth,
      // which makes computeInitialScrollLeft early-return 0.
      if (wrapper.scrollWidth <= wrapper.clientWidth) return false;
      const scrollLeft = computeInitialScrollLeft({
        stationCount: this._stationCount || 0,
        forecastCount: this._forecastCount || 0,
        contentWidth: wrapper.scrollWidth,
        viewportWidth: wrapper.clientWidth,
      });
      wrapper.scrollLeft = scrollLeft;
      this._initialScrollApplied = true;
      this._lastScrollGeneration = generationKey;
      return true;
    };

    // Best case: layout already settled. Otherwise observe the inner
    // content for size changes — that fires once Chart.js's canvas
    // settles and the wrapper actually overflows. Hard cap (1 s after
    // dataReady) so we don't observe forever if the wrapper never
    // overflows for some reason.
    if (apply()) return;

    const content = wrapper.querySelector('.forecast-content');
    if (!content || typeof ResizeObserver === 'undefined') {
      this._pendingScrollFrame = requestAnimationFrame(() => {
        this._pendingScrollFrame = null;
        apply();
      });
      return;
    }
    const startedAt = Date.now();
    const observer = new ResizeObserver(() => {
      if (Date.now() - startedAt > 1000 || apply()) {
        this._teardownInitialScrollObserver();
      }
    });
    observer.observe(content);
    this._initialScrollObserver = observer;
  }

  _teardownInitialScrollObserver() {
    if (this._initialScrollObserver) {
      this._initialScrollObserver.disconnect();
      this._initialScrollObserver = null;
    }
    if (this._pendingScrollFrame) {
      cancelAnimationFrame(this._pendingScrollFrame);
      this._pendingScrollFrame = null;
    }
  }

}

customElements.define('weather-station-card', WeatherStationCard);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "weather-station-card",
  name: "Weather Station Card",
  description: "Weather-chart-card layout for past weather station measurements.",
  preview: true,
  documentationURL: "https://github.com/chriguschneider/weather-station-card",
});
