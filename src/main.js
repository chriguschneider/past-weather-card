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
import { hourlyTempSeries, normalizeForecastMode } from './forecast-utils.js';
import { cardStyles } from './chart/styles.js';
import {
  createSeparatorPlugin,
  createDailyTickLabelsPlugin,
  createPrecipLabelPlugin,
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
  const numOrNull = (v) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
  };
  const nowTemp = numOrNull(this.temperature);
  const luxNow = numOrNull(valueOf(sensors.illuminance));
  const precipUnit = attrOf(sensors.precipitation, 'unit_of_measurement') || '';
  const precipIsRate = /\/(h|hr|hour)$/i.test(precipUnit);
  const precipRateNow = precipIsRate ? numOrNull(valueOf(sensors.precipitation)) : null;
  const lat = hass.config && hass.config.latitude;
  const lon = hass.config && hass.config.longitude;
  const clearskyNow = lat != null && lon != null
    ? clearSkyLuxAt(lat, lon, new Date())
    : 110000;
  // precip_total here is precipRateNow — an instantaneous rate (mm/h)
  // when the sensor reports a /h unit. Use period: 'hour' so the
  // precipitation thresholds match the rate semantics, not 24 h totals.
  const currentCondition = classifyDay({
    temp_max: nowTemp,
    temp_min: nowTemp,
    humidity: numOrNull(this.humidity),
    lux_max: luxNow,
    precip_total: precipRateNow,
    wind_mean: numOrNull(this.windSpeed),
    gust_max: numOrNull(this.wind_gust_speed),
    dew_point_mean: numOrNull(this.dew_point),
    clearsky_lux: clearskyNow,
  }, this.config.condition_mapping || {}, 'hour');

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
    const station = effectiveCfg.show_station !== false ? (this._stationData || []) : [];
    let forecast = [];
    if (effectiveCfg.show_forecast === true && effectiveCfg.weather_entity) {
      // `days` / `forecast_days` are the data-loading window in days for
      // both modes; at hourly each day expands to 24 buckets.
      const isHourly = effectiveCfg.forecast.type === 'hourly';
      const slotsPerUnit = isHourly ? 24 : 1;
      const cap = parseInt(effectiveCfg.forecast_days, 10);
      const limit = (cap > 0 ? cap : (parseInt(effectiveCfg.days, 10) || 7)) * slotsPerUnit;
      forecast = (this._forecastData || []).slice(0, limit);
    }
    this._stationCount = station.length;
    this._forecastCount = forecast.length;
    this.forecasts = [...station, ...forecast];
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
  const card = this.shadowRoot && this.shadowRoot.querySelector('ha-card');
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
    var i = 9;
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

// Pointer-based tap / hold / double-tap detection on the ha-card root.
// Dispatches the configured action by calling _runAction directly (HA's
// frontend doesn't have a global hass-action listener — cards are
// expected to invoke handle-action themselves; firing the event was a
// no-op, see commit history).
//
// Why pointer events vs. plain click: we need hold detection (fires
// before pointerup) and a way to suppress the trailing tap. A 250 ms
// tap delay is required to disambiguate single from double — that's
// the same window HA's own action-handler uses.
_setupActionHandler() {
  const card = this.shadowRoot && this.shadowRoot.querySelector('ha-card');
  if (!card) return;

  // Cursor reflects "is anything wired" — refresh on every call so
  // toggling tap_action in the editor flips the hand cursor on/off
  // immediately, not only on first render.
  const cfg0 = this.config || {};
  const isLive = (a) => a && a.action && a.action !== 'none';
  card.style.cursor = (isLive(cfg0.tap_action) || isLive(cfg0.hold_action) || isLive(cfg0.double_tap_action))
    ? 'pointer' : '';

  if (card._wsActionHandlerBound) return;
  card._wsActionHandlerBound = true;

  const HOLD_MS = 500;
  const DBL_MS = 250;
  let holdTimer = null;
  let holdFired = false;
  let lastTapAt = 0;
  let pendingTap = null;

  const fire = (kind) => {
    const cfg = this.config || {};
    const map = {
      tap: cfg.tap_action,
      hold: cfg.hold_action,
      double_tap: cfg.double_tap_action,
    };
    this._runAction(map[kind]);
  };

  const clearHold = () => {
    if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
  };

  // Pointer events that originate on a card-internal control button
  // (mode-toggle, jump-to-now, scroll indicators) are part of that
  // control's own gesture — they must NOT trigger the card-level
  // tap/hold/double-tap action.
  const isCardControl = (target) =>
    target && target.closest && target.closest('button, ha-icon-button, [role="button"]') !== null;

  const onPointerDown = (ev) => {
    if (isCardControl(ev.target)) return;
    holdFired = false;
    clearHold();
    holdTimer = setTimeout(() => {
      // If the user has been dragging the chart to scroll, the hold
      // is part of that gesture — don't fire a hold_action for it.
      if (this._dragMoved) return;
      holdFired = true;
      fire('hold');
    }, HOLD_MS);
  };

  const onPointerUp = (ev) => {
    if (isCardControl(ev.target)) return;
    clearHold();
    if (holdFired) return;
    // Drag-to-scroll consumed this gesture; suppress the trailing tap.
    // _dragMoved is reset on the next microtask by the drag handler,
    // so a fresh gesture immediately afterwards still detects normally.
    if (this._dragMoved) return;
    const now = Date.now();
    if (now - lastTapAt < DBL_MS) {
      // Second tap inside the double-tap window — cancel the queued
      // single tap and fire double_tap instead.
      lastTapAt = 0;
      if (pendingTap) { clearTimeout(pendingTap); pendingTap = null; }
      fire('double_tap');
      return;
    }
    lastTapAt = now;
    pendingTap = setTimeout(() => {
      pendingTap = null;
      fire('tap');
    }, DBL_MS);
  };

  const onPointerCancel = () => {
    clearHold();
    holdFired = false;
  };

  card.addEventListener('pointerdown', onPointerDown);
  card.addEventListener('pointerup', onPointerUp);
  card.addEventListener('pointercancel', onPointerCancel);
  card.addEventListener('pointerleave', onPointerCancel);

  // Saved so disconnectedCallback can detach. Re-using `card` rather than
  // `this` because the ha-card element is what we bound to.
  this._actionHandlerTeardown = () => {
    card.removeEventListener('pointerdown', onPointerDown);
    card.removeEventListener('pointerup', onPointerUp);
    card.removeEventListener('pointercancel', onPointerCancel);
    card.removeEventListener('pointerleave', onPointerCancel);
    clearHold();
    if (pendingTap) clearTimeout(pendingTap);
    card._wsActionHandlerBound = false;
  };
}


async updated(changedProperties) {
  await this.updateComplete;

  // Re-attempt action-handler binding after every render. Lit can swap
  // the <ha-card> element when the render branch changes (the
  // weather-undefined fallback uses a different template than the
  // populated branch); the per-element _wsActionHandlerBound flag
  // makes this idempotent on stable elements.
  this._setupActionHandler();
  this._maybeApplyInitialScroll(changedProperties);
  this._setupScrollUx();

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
    const result = this._drawChartUnsafe(args);
    if (this._chartError) {
      this._chartError = null;
      this.requestUpdate();
    }
    return result;
  } catch (e) {
    // The phase tag (set by _drawChartUnsafe before calling each sub-step)
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

_drawChartUnsafe({ config: rawConfig, language, weather, forecastItems } = this) {
  if (!this.forecasts || !this.forecasts.length) {
    return [];
  }
  // All downstream references read `config` — by binding it to the
  // normalized result we get one consistent view of the mode (and
  // forecast.type fallback to 'daily' for typo'd YAML) across the
  // chart code path.
  const { config } = normalizeForecastMode(rawConfig);

  const chartCanvas = this.renderRoot && this.renderRoot.querySelector('#forecastChart');
  if (!chartCanvas) {
    console.error('Canvas element not found:', this.renderRoot);
    return;
  }

  if (this.forecastChart) {
    this.forecastChart.destroy();
  }
  this._chartPhase = 'compute';
  var tempUnit = this._hass.config.unit_system.temperature;
  var lengthUnit = this._hass.config.unit_system.length;
  var precipUnit = lengthUnit === 'km' ? this.ll('units')['mm'] : this.ll('units')['in'];
  const data = this.computeForecastData();

  var style = getComputedStyle(document.body);
  var backgroundColor = style.getPropertyValue('--card-background-color');
  var textColor = style.getPropertyValue('--primary-text-color');
  var dividerColor = style.getPropertyValue('--divider-color');
  const canvas = this.renderRoot.querySelector('#forecastChart');
  if (!canvas) {
    requestAnimationFrame(() => this.drawChart());
    return;
  }

  const ctx = canvas.getContext('2d');

  let precipMax;
  if (config.forecast.type === 'hourly') {
    precipMax = lengthUnit === 'km' ? 4 : 1;
  } else {
    precipMax = lengthUnit === 'km' ? 20 : 1;
  }

  Chart.defaults.color = textColor;
  Chart.defaults.scale.grid.color = dividerColor;
  Chart.defaults.elements.line.fill = false;
  Chart.defaults.elements.line.tension = 0.3;
  Chart.defaults.elements.line.borderWidth = 1.5;
  Chart.defaults.elements.point.radius = 2;
  Chart.defaults.elements.point.hitRadius = 10;

  // Boundary handling between station and forecast blocks differs by mode:
  //
  // - Daily combination: "today" appears as a doubled column (station-today
  //   on the left, forecast-today on the right). The segment between those
  //   two columns is suppressed (transparent) — measured vs. predicted of
  //   the SAME day shouldn't visually flow into each other.
  //
  // - Hourly combination: there's no doubled hour. Station and forecast
  //   meet at "now" with one bar each side. The boundary segment is
  //   drawn DASHED — same visual cue we use for the rest of the forecast
  //   block, but applied to the transition itself, so the user reads the
  //   line as "measured up to now → predicted from now on" without a
  //   confusing transparent gap.
  const stationCountForGap = this._stationCount || 0;
  const forecastCountForGap = this._forecastCount || 0;
  const hasBothBlocks = stationCountForGap > 0 && forecastCountForGap > 0;
  const gapStartIdx = stationCountForGap - 1;
  const isHourlyCombo = hasBothBlocks && config.forecast.type === 'hourly';
  const isBoundarySegment = (ctx) =>
    ctx.p0DataIndex === gapStartIdx && ctx.p1DataIndex === gapStartIdx + 1;
  const segmentSkip = (ctx) => {
    if (!hasBothBlocks) return undefined;
    // Hourly combo: boundary is drawn (dashed by segmentDash); only daily
    // combo suppresses it.
    if (!isHourlyCombo && isBoundarySegment(ctx)) return 'transparent';
    return undefined;
  };
  // Dash forecast segments to mark "predicted, not measured". A segment is
  // entirely in the forecast block when its left endpoint is at or past
  // the first forecast index (stationCount). At hourly combo we also dash
  // the boundary segment itself (the "is → soll" transition).
  const segmentDash = (ctx) => {
    if (ctx.p0DataIndex >= stationCountForGap && forecastCountForGap > 0) {
      return [6, 4];
    }
    if (isHourlyCombo && isBoundarySegment(ctx)) return [6, 4];
    return undefined;
  };
  const tempSegmentOpts = { borderColor: segmentSkip, borderDash: segmentDash };

  const precipColor = config.forecast.precipitation_color;
  const precipColorLight = lightenColor(precipColor);
  const precipPerBarColor = (data.precip || []).map(
    (_, i) => (hasBothBlocks && i >= stationCountForGap) ? precipColorLight
            : (!hasBothBlocks && stationCountForGap === 0) ? precipColorLight
            : precipColor,
  );

  var datasets = [
    {
      label: this.ll('tempHi'),
      type: 'line',
      data: data.tempHigh,
      yAxisID: 'TempAxis',
      borderColor: config.forecast.temperature1_color,
      backgroundColor: config.forecast.temperature1_color,
      segment: tempSegmentOpts,
    },
    {
      label: this.ll('tempLo'),
      type: 'line',
      data: data.tempLow,
      yAxisID: 'TempAxis',
      borderColor: config.forecast.temperature2_color,
      backgroundColor: config.forecast.temperature2_color,
      segment: tempSegmentOpts,
      // Hourly forecasts carry only `temperature` per entry, no separate
      // low — hide the second line dataset entirely (vs. drawing a flat
      // empty line). precipPlugin still indexes dataset[2] so we must not
      // remove this slot.
      hidden: !data.tempLowAvailable,
    },
    {
      label: this.ll('precip'),
      type: 'bar',
      data: data.precip,
      yAxisID: 'PrecipAxis',
      borderColor: precipPerBarColor,
      backgroundColor: precipPerBarColor,
      barPercentage: config.forecast.precip_bar_size / 100,
      categoryPercentage: 1.0,
      // datalabels handled by precipLabelPlugin so the unit can render
      // at a smaller font next to the number. The default chartjs-
      // datalabels render is suppressed via display:false here; the
      // plugin reads dataset.data[i] directly to draw number + unit.
      datalabels: {
        display: function () { return false; },
        textAlign: 'center',
        textBaseline: 'middle',
        align: 'top',
        anchor: 'start',
        offset: -10,
      },
    },
  ];

  const chart_text_color = (config.forecast.chart_text_color === 'auto') ? textColor : config.forecast.chart_text_color;

  if (config.forecast.style === 'style2') {
    const todayBoldFont = (context) => {
      const dt = data.dateTime[context.dataIndex];
      const k = dt ? new Date(dt) : null;
      if (k) k.setHours(0, 0, 0, 0);
      const t = new Date(); t.setHours(0, 0, 0, 0);
      const isToday = k && k.getTime() === t.getTime();
      return {
        size: parseInt(config.forecast.labels_font_size) + 1,
        lineHeight: 0.7,
        weight: isToday ? 'bold' : 'normal',
      };
    };

    datasets[0].datalabels = {
      display: function (context) {
        return 'true';
      },
      formatter: function (value, context) {
        return context.dataset.data[context.dataIndex] + '°';
      },
      align: 'top',
      anchor: 'center',
      backgroundColor: 'transparent',
      borderColor: 'transparent',
      color: chart_text_color || config.forecast.temperature1_color,
      font: todayBoldFont,
    };

    datasets[1].datalabels = {
      display: function (context) {
        return 'true';
      },
      formatter: function (value, context) {
        return context.dataset.data[context.dataIndex] + '°';
      },
      align: 'bottom',
      anchor: 'center',
      backgroundColor: 'transparent',
      borderColor: 'transparent',
      color: chart_text_color || config.forecast.temperature2_color,
      font: todayBoldFont,
    };
  }

  const stationCount = this._stationCount || 0;
  const forecastCount = this._forecastCount || 0;
  const isHourly = config.forecast.type === 'hourly';
  // doubled-today only makes sense at daily — at hourly station and
  // forecast meet at "now" with a single separator line.
  const doubledToday = !isHourly && stationCount > 0 && forecastCount > 0;
  const separatorPlugin = createSeparatorPlugin({
    stationCount, forecastCount, style, dividerColor,
    mode: isHourly ? 'hourly' : 'daily',
  });
  const dailyTickLabelsPlugin = createDailyTickLabelsPlugin({
    config, language, data, textColor, backgroundColor, style, stationCount, doubledToday,
  });
  const precipLabelPlugin = createPrecipLabelPlugin({
    config, data, precipUnit, precipPerBarColor, precipColor, textColor, backgroundColor,
    chartTextColor: chart_text_color,
  });

  this._chartPhase = 'init';
  this.forecastChart = buildChart(ctx, {
    datasets,
    plugins: [separatorPlugin, dailyTickLabelsPlugin, precipLabelPlugin],
    data,
    config,
    language,
    textColor,
    backgroundColor,
    dividerColor,
    chartTextColor: chart_text_color,
    precipMax,
    precipUnit,
    tempUnit,
    doubledToday,
    stationCount,
    style,
  });
  this._chartPhase = null;
}

computeForecastData({ config, forecastItems } = this) {
  const forecast = this.forecasts ? this.forecasts.slice(0, forecastItems) : [];
  const dateTime = forecast.map((d) => d.datetime);
  const { tempHigh, tempLow } = hourlyTempSeries(forecast, {
    roundTemp: config.forecast.round_temp == true,
  });
  const precip = forecast.map((d) => d.precipitation);

  return {
    forecast,
    dateTime,
    tempHigh,
    // tempLow is null when no entry has `templow` (hourly forecast). Coerce
    // to [] so the dataset builder downstream — which indexes by position —
    // doesn't choke. The single-line decision (hide dataset[1]) lives in
    // _drawChartUnsafe, gated on `tempLow === null` from hourlyTempSeries.
    tempLow: tempLow || [],
    // Track the high/low intent separately so the chart layer can decide
    // whether to render a second temperature line; null means hourly /
    // single-line, otherwise daily / two-line.
    tempLowAvailable: tempLow !== null,
    precip,
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
    forecastChart.update();
  }
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
              <button class="scroll-indicator scroll-indicator-left" aria-label="Scroll left" hidden>
                <ha-icon icon="mdi:chevron-left"></ha-icon>
              </button>
              <button class="scroll-indicator scroll-indicator-right" aria-label="Scroll right" hidden>
                <ha-icon icon="mdi:chevron-right"></ha-icon>
              </button>
              <button class="jump-to-now" aria-label="Jump to now" title="Jump to now" hidden
                @click=${this._onJumpToNowClick}>
                <ha-icon icon="mdi:crosshairs-gps"></ha-icon>
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

  // Mirror of HA's frontend handle-action helper, scoped to the actions
  // the editor exposes via ha-selector ui_action: more-info, navigate,
  // url, toggle, perform-action (a.k.a. call-service) and assist.
  // 'none' / unconfigured actions are no-ops. We don't import HA's
  // handle-action to avoid a runtime dependency on an internal module
  // path that has changed names across HA versions.
  // Wire up scroll-related UX on the .forecast-scroll wrapper:
  //   - mouse drag-to-scroll on desktop (touch keeps native scrolling)
  //   - left/right indicator buttons that scroll one viewport at a time
  //   - indicator visibility tracking via the wrapper's scroll event
  //
  // Idempotent on stable elements via a per-element flag — Lit reuses
  // the wrapper across data refreshes, so we don't want to re-bind on
  // every render. Cleanup teardown is stored on `this` so disconnect
  // can detach.
  _setupScrollUx() {
    const wrapper = this.shadowRoot && this.shadowRoot.querySelector('.forecast-scroll.scrolling');
    if (!wrapper) {
      // Non-scrolling render (daily default fits all). Detach any
      // previously bound handlers so a daily↔hourly toggle doesn't leak.
      if (this._scrollUxTeardown) {
        this._scrollUxTeardown();
        this._scrollUxTeardown = null;
      }
      return;
    }
    if (wrapper._wsScrollUxBound) {
      // Same element, already bound — only refresh indicator visibility
      // (which depends on current scrollLeft / scrollWidth).
      this._updateScrollIndicators();
      return;
    }
    wrapper._wsScrollUxBound = true;

    const block = wrapper.parentElement; // .forecast-scroll-block
    const leftBtn = block && block.querySelector('.scroll-indicator-left');
    const rightBtn = block && block.querySelector('.scroll-indicator-right');

    // ── Drag-to-scroll + tap suppression ──────────────────────────────
    // We listen to ALL pointer types so a swipe / drag — whether mouse
    // or touch — sets `this._dragMoved`, which the action handler on
    // ha-card checks before firing tap_action / hold_action. Without
    // that gate, a horizontal touch-swipe to scroll the chart on mobile
    // would also fire the configured tap action on pointerup.
    //
    // The actual scrollLeft manipulation (and pointer capture) is still
    // mouse-only — touch falls through to the native `overflow-x: auto`
    // scroll, and calling preventDefault or capturing the pointer
    // would interfere with that native gesture.
    const DRAG_THRESHOLD = 5;
    let isDown = false;
    let dragMoved = false;
    let startX = 0;
    let startScrollLeft = 0;
    let activePointerId = null;

    const onPointerDown = (ev) => {
      isDown = true;
      dragMoved = false;
      activePointerId = ev.pointerId;
      startX = ev.clientX;
      startScrollLeft = wrapper.scrollLeft;
      if (ev.pointerType === 'mouse') {
        try { wrapper.setPointerCapture(ev.pointerId); } catch (_) { /* not always supported */ }
      }
    };

    const onPointerMove = (ev) => {
      if (!isDown || ev.pointerId !== activePointerId) return;
      const dx = ev.clientX - startX;
      if (!dragMoved && Math.abs(dx) > DRAG_THRESHOLD) {
        dragMoved = true;
        // Shared with the action handler so that a drag/swipe gesture
        // doesn't also fire a tap_action on pointerup.
        this._dragMoved = true;
        wrapper.classList.add('dragging');
      }
      if (dragMoved && ev.pointerType === 'mouse') {
        wrapper.scrollLeft = startScrollLeft - dx;
        ev.preventDefault();
      }
    };

    const onPointerEnd = (ev) => {
      if (!isDown || (ev && ev.pointerId !== activePointerId)) return;
      isDown = false;
      activePointerId = null;
      wrapper.classList.remove('dragging');
      // pointercancel from the browser claiming the gesture for native
      // scroll counts as a drag, even if our pointermove threshold
      // wasn't crossed yet — any pointerup that may bubble up to the
      // ha-card afterwards must skip its tap-detection branch.
      if (ev && ev.type === 'pointercancel') {
        dragMoved = true;
        this._dragMoved = true;
      }
      if (dragMoved) {
        // Reset via setTimeout(0) — a macrotask, not a microtask. The
        // ha-card's pointerup listener bubbles up AFTER this one in the
        // same event dispatch, and microtasks flush between listener
        // invocations in V8/Blink, so a Promise.resolve().then(reset)
        // would fire before the action handler reads the flag and the
        // tap would still trigger. setTimeout(0) defers the reset to
        // the next macrotask, after the entire event dispatch is done.
        setTimeout(() => { this._dragMoved = false; }, 0);
      }
    };

    wrapper.addEventListener('pointerdown', onPointerDown);
    wrapper.addEventListener('pointermove', onPointerMove);
    wrapper.addEventListener('pointerup', onPointerEnd);
    wrapper.addEventListener('pointercancel', onPointerEnd);

    // ── Indicator click ───────────────────────────────────────────────
    // stopPropagation prevents the action handler (bound on ha-card)
    // from interpreting the indicator click as a card-level tap.
    const stepBy = 0.85; // scroll about one viewport, leave a hint of overlap
    const onLeftClick = (ev) => {
      ev.stopPropagation();
      wrapper.scrollBy({ left: -wrapper.clientWidth * stepBy, behavior: 'smooth' });
    };
    const onRightClick = (ev) => {
      ev.stopPropagation();
      wrapper.scrollBy({ left: wrapper.clientWidth * stepBy, behavior: 'smooth' });
    };
    const stopDown = (ev) => ev.stopPropagation();
    if (leftBtn) {
      leftBtn.addEventListener('click', onLeftClick);
      leftBtn.addEventListener('pointerdown', stopDown);
    }
    if (rightBtn) {
      rightBtn.addEventListener('click', onRightClick);
      rightBtn.addEventListener('pointerdown', stopDown);
    }

    // ── Indicator visibility on scroll ───────────────────────────────
    const onScroll = () => this._updateScrollIndicators();
    wrapper.addEventListener('scroll', onScroll, { passive: true });
    this._updateScrollIndicators();

    this._scrollUxTeardown = () => {
      wrapper.removeEventListener('pointerdown', onPointerDown);
      wrapper.removeEventListener('pointermove', onPointerMove);
      wrapper.removeEventListener('pointerup', onPointerEnd);
      wrapper.removeEventListener('pointercancel', onPointerEnd);
      wrapper.removeEventListener('scroll', onScroll);
      if (leftBtn) {
        leftBtn.removeEventListener('click', onLeftClick);
        leftBtn.removeEventListener('pointerdown', stopDown);
      }
      if (rightBtn) {
        rightBtn.removeEventListener('click', onRightClick);
        rightBtn.removeEventListener('pointerdown', stopDown);
      }
      wrapper.classList.remove('dragging');
      wrapper._wsScrollUxBound = false;
    };
  }

  _updateScrollIndicators() {
    const block = this.shadowRoot && this.shadowRoot.querySelector('.forecast-scroll-block');
    if (!block) return;
    const wrapper = block.querySelector('.forecast-scroll.scrolling');
    if (!wrapper) return;
    const left = block.querySelector('.scroll-indicator-left');
    const right = block.querySelector('.scroll-indicator-right');
    if (left && right) {
      const slop = 1; // sub-pixel rounding tolerance
      const max = wrapper.scrollWidth - wrapper.clientWidth;
      if (wrapper.scrollLeft > slop) left.removeAttribute('hidden');
      else left.setAttribute('hidden', '');
      if (wrapper.scrollLeft < max - slop) right.removeAttribute('hidden');
      else right.setAttribute('hidden', '');
    }
    // Jump-to-now visibility — hidden when current scrollLeft is within
    // ~10% of one viewport width of the canonical "now" position. The
    // threshold is relative so it scales with display size; phones get a
    // tighter band than desktops in absolute pixels.
    const jump = block.querySelector('.jump-to-now');
    if (jump) {
      const target = computeInitialScrollLeft({
        stationCount: this._stationCount || 0,
        forecastCount: this._forecastCount || 0,
        contentWidth: wrapper.scrollWidth,
        viewportWidth: wrapper.clientWidth,
      });
      const offset = Math.abs(wrapper.scrollLeft - target);
      const threshold = Math.max(20, wrapper.clientWidth * 0.1);
      if (offset > threshold) jump.removeAttribute('hidden');
      else jump.setAttribute('hidden', '');
    }
    this._updateScrollDateStamps(block, wrapper);
  }

  // Renders the daily ↔ hourly mode toggle as a small circular button
  // overlaid at the top-left of the forecast-scroll-block. Only visible
  // when there's a forecast block to switch (otherwise the toggle has
  // no effect — the station block alone runs at the configured forecast
  // type but the user can't see the difference without forecast data
  // to compare against).
  renderModeToggle() {
    const cfg = this.config || {};
    // forecast.type drives both MeasuredDataSource (period: hour|day)
    // and ForecastDataSource (forecast_type) — toggling is meaningful
    // whenever ANY block renders, including station-only.
    const showsStation = cfg.show_station !== false;
    const showsForecast = cfg.show_forecast === true && !!cfg.weather_entity;
    if (!showsStation && !showsForecast) return '';
    const isHourly = (cfg.forecast || {}).type === 'hourly';
    const icon = isHourly ? 'mdi:calendar-month-outline' : 'mdi:clock-time-eight-outline';
    const label = isHourly ? 'Switch to daily forecast' : 'Switch to hourly forecast';
    return html`
      <button class="mode-toggle" aria-label="${label}" title="${label}"
              @click=${this._onModeToggleClick}>
        <ha-icon icon=${icon}></ha-icon>
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

  _onJumpToNowClick(ev) {
    if (ev) ev.stopPropagation();
    const wrapper = this.shadowRoot && this.shadowRoot.querySelector('.forecast-scroll.scrolling');
    if (!wrapper) return;
    const target = computeInitialScrollLeft({
      stationCount: this._stationCount || 0,
      forecastCount: this._forecastCount || 0,
      contentWidth: wrapper.scrollWidth,
      viewportWidth: wrapper.clientWidth,
    });
    wrapper.scrollTo({ left: target, behavior: 'smooth' });
  }

  // At hourly: surface the date of the leftmost and rightmost visible
  // bar by overlaying it directly above the corresponding tick — same
  // visual style as the chart's own midnight marker (e.g. "May 6"
  // above "00:00"). The chart only prints a date at midnight ticks,
  // so a viewport that doesn't span 00:00 would otherwise leave the
  // user without context which day they're looking at.
  //
  // When the leftmost / rightmost visible IS a midnight, the chart
  // already shows the date there — we hide our overlay to avoid
  // a duplicate.
  _updateScrollDateStamps(block, wrapper) {
    const leftEl = block.querySelector('.scroll-date-left');
    const rightEl = block.querySelector('.scroll-date-right');
    if (!leftEl || !rightEl) return;

    const total = (this.forecasts || []).length;
    if (!total || wrapper.scrollWidth <= 0) {
      leftEl.setAttribute('hidden', '');
      rightEl.setAttribute('hidden', '');
      return;
    }

    const barWidth = wrapper.scrollWidth / total;
    if (barWidth <= 0) return;

    // floor(scrollLeft / barWidth) is the leftmost partially-visible
    // bar; floor((scrollLeft + clientWidth - 1) / barWidth) is the
    // rightmost. Each bar's tick label sits centred at (idx + 0.5) ×
    // barWidth in canvas-pixel coordinates; subtract scrollLeft to
    // map to viewport-pixel coordinates.
    const leftIdx = Math.max(0, Math.min(total - 1, Math.floor(wrapper.scrollLeft / barWidth)));
    const rightIdx = Math.max(0, Math.min(total - 1, Math.floor((wrapper.scrollLeft + wrapper.clientWidth - 1) / barWidth)));
    const leftCenterX = (leftIdx + 0.5) * barWidth - wrapper.scrollLeft;
    const rightCenterX = (rightIdx + 0.5) * barWidth - wrapper.scrollLeft;

    const lang = this.config.locale || this.language || 'en';
    const fmt = (idx) => {
      const item = this.forecasts[idx];
      if (!item || !item.datetime) return { date: '', isMidnight: false };
      try {
        const d = new Date(item.datetime);
        const isMidnight = d.getHours() === 0 && d.getMinutes() === 0;
        return {
          date: d.toLocaleDateString(lang, { day: 'numeric', month: 'short' }),
          isMidnight,
        };
      } catch (_) {
        return { date: '', isMidnight: false };
      }
    };

    // Collect the dates of every midnight tick that's currently inside
    // the viewport — those dates are already drawn by the chart's own
    // tick callback as a "May 6" stamp above the 00:00 tick. If our
    // edge overlay would show the same date, it's redundant.
    const visibleMidnightDates = new Set();
    for (let i = leftIdx; i <= rightIdx; i++) {
      const info = fmt(i);
      if (info.isMidnight) visibleMidnightDates.add(info.date);
    }

    const leftInfo = fmt(leftIdx);
    const rightInfo = fmt(rightIdx);

    const apply = (el, info, centerX) => {
      if (!info.date || info.isMidnight || visibleMidnightDates.has(info.date)) {
        el.setAttribute('hidden', '');
        return;
      }
      el.textContent = info.date;
      el.style.left = `${Math.round(centerX)}px`;
      el.removeAttribute('hidden');
    };
    apply(leftEl, leftInfo, leftCenterX);
    if (rightIdx === leftIdx) rightEl.setAttribute('hidden', '');
    else apply(rightEl, rightInfo, rightCenterX);
  }

  // Apply the "scroll to now" position once per render generation.
  // A generation changes when forecast.type or number_of_forecasts
  // change — outside those, we leave scrollLeft alone so the user's
  // manual scroll position survives data refreshes (which fire every
  // hour from MeasuredDataSource).
  _maybeApplyInitialScroll(changedProperties) {
    const wrapper = this.shadowRoot && this.shadowRoot.querySelector('.forecast-scroll.scrolling');
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

  _runAction(actionConfig) {
    if (!actionConfig || !actionConfig.action || actionConfig.action === 'none') return;
    const hass = this._hass;
    const fallbackEntity = (this.config && this.config.sensors && this.config.sensors.temperature) || '';
    const action = actionConfig.action;

    if (action === 'more-info') {
      const entityId = actionConfig.entity || fallbackEntity;
      if (entityId) this._fire('hass-more-info', { entityId });
      return;
    }
    if (action === 'navigate') {
      if (!actionConfig.navigation_path) return;
      window.history.pushState(null, '', actionConfig.navigation_path);
      // HA listens for `location-changed` on window to drive the router;
      // bubbles:true so it reaches the panel regardless of who fired it.
      const ev = new Event('location-changed', { bubbles: true, composed: true, cancelable: false });
      ev.detail = { replace: actionConfig.navigation_replace === true };
      window.dispatchEvent(ev);
      return;
    }
    if (action === 'url') {
      if (!actionConfig.url_path) return;
      window.open(actionConfig.url_path);
      return;
    }
    if (action === 'toggle') {
      const entityId = actionConfig.entity || fallbackEntity;
      if (!entityId || !hass) return;
      const domain = entityId.split('.')[0];
      hass.callService(domain, 'toggle', { entity_id: entityId });
      return;
    }
    if (action === 'perform-action' || action === 'call-service') {
      // HA renamed `service` → `perform_action` in 2024.8; keep both for
      // backwards compatibility with older YAML.
      const svc = actionConfig.perform_action || actionConfig.service;
      if (!svc || !hass) return;
      const dot = svc.indexOf('.');
      if (dot < 0) return;
      const domain = svc.slice(0, dot);
      const service = svc.slice(dot + 1);
      const data = actionConfig.data || actionConfig.service_data || {};
      const target = actionConfig.target;
      hass.callService(domain, service, data, target);
      return;
    }
    if (action === 'assist') {
      this._fire('hass-action-assist', actionConfig);
      return;
    }
    if (action === 'fire-dom-event') {
      this._fire('ll-custom', actionConfig);
      return;
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
