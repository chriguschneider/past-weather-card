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
import { lightenColor, computeBlockSeparatorPositions } from './format-utils.js';
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
    autoscroll: false,
    forecast: {
      precipitation_type: 'rainfall',
      show_probability: false,
      labels_font_size: '11',
      precip_bar_size: '100',
      style: 'style1',
      show_wind_forecast: true,
      condition_icons: true,
      show_date: true,
      round_temp: false,
      type: 'daily',
      number_of_forecasts: '0',
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
    ...config,
    forecast: {
      precipitation_type: 'rainfall',
      show_probability: false,
      labels_font_size: 11,
      chart_height: 180,
      precip_bar_size: 100,
      style: 'style1',
      temperature1_color: 'rgba(255, 152, 0, 1.0)',
      temperature2_color: 'rgba(68, 115, 158, 1.0)',
      precipitation_color: 'rgba(132, 209, 253, 1.0)',
      condition_icons: true,
      show_wind_forecast: true,
      show_date: true,
      round_temp: false,
      type: 'daily',
      number_of_forecasts: '0',
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
  }, this.config.condition_mapping || {});

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

  if (wantStation) {
    if (!this._dataSource) {
      this._dataSource = new MeasuredDataSource(hass, this.config);
      this._dataUnsubscribe = this._dataSource.subscribe((event) => {
        this._stationData = event.forecast || [];
        this._stationError = event.error || null;
        this._refreshForecasts();
      });
    } else {
      this._dataSource.setHass(hass);
    }
  } else if (this._dataSource) {
    if (this._dataUnsubscribe) this._dataUnsubscribe();
    this._dataUnsubscribe = null;
    this._dataSource = null;
    this._stationData = [];
    this._stationError = null;
  }

  if (wantForecast) {
    if (!this._forecastSource) {
      this._forecastSource = new ForecastDataSource(hass, this.config);
      this._forecastUnsubscribe = this._forecastSource.subscribe((event) => {
        this._forecastData = event.forecast || [];
        this._forecastError = event.error || null;
        this._refreshForecasts();
      });
    } else {
      this._forecastSource.setHass(hass);
    }
  } else if (this._forecastSource) {
    if (this._forecastUnsubscribe) this._forecastUnsubscribe();
    this._forecastUnsubscribe = null;
    this._forecastSource = null;
    this._forecastData = [];
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
    if (this._dataUnsubscribe) {
      this._dataUnsubscribe();
      this._dataUnsubscribe = null;
    }
    this._dataSource = null;
    if (this._forecastUnsubscribe) {
      this._forecastUnsubscribe();
      this._forecastUnsubscribe = null;
    }
    this._forecastSource = null;
    if (this._clockTimer) {
      clearInterval(this._clockTimer);
      this._clockTimer = null;
    }
    if (this.autoscrollTimeout) {
      clearTimeout(this.autoscrollTimeout);
      this.autoscrollTimeout = null;
    }
  }

  _refreshForecasts() {
    const station = this.config.show_station !== false ? (this._stationData || []) : [];
    let forecast = [];
    if (this.config.show_forecast === true && this.config.weather_entity) {
      const cap = parseInt(this.config.forecast_days, 10);
      const limit = cap > 0
        ? cap
        : (parseInt(this.config.days, 10) || 7);
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
    this.measureCard();
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
  // Data callbacks can call _refreshForecasts → measureCard before Lit's
  // first render has created the shadow root. Bail out cleanly; the next
  // firstUpdated tick (or a later data arrival) will redraw.
  if (!this.shadowRoot) {
    return;
  }
  const card = this.shadowRoot.querySelector('ha-card');
  let fontSize = this.config.forecast.labels_font_size;
  const numberOfForecasts = this.config.forecast.number_of_forecasts || 0;

  if (!card) {
    return;
  }

  if (numberOfForecasts > 0) {
    this.forecastItems = numberOfForecasts;
  } else if (this.forecasts && this.forecasts.length) {
    // With station + forecast merged, "today" appears twice on purpose.
    // Width-based auto-fit would risk cropping that — show every column the
    // user explicitly configured via days + forecast_days instead.
    this.forecastItems = this.forecasts.length;
  } else {
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

  if (this.config.autoscroll) {
    this.autoscroll();
  }
}


async updated(changedProperties) {
  await this.updateComplete;

  if (changedProperties.has('config')) {
    const oldConfig = changedProperties.get('config');

    const sensorsChanged = oldConfig && JSON.stringify(this.config.sensors) !== JSON.stringify(oldConfig.sensors);
    const daysChanged = oldConfig && this.config.days !== oldConfig.days;
    const stationToggled = oldConfig && (this.config.show_station !== false) !== (oldConfig.show_station !== false);
    const forecastToggled = oldConfig && (this.config.show_forecast === true) !== (oldConfig.show_forecast === true);
    const weatherEntityChanged = oldConfig && this.config.weather_entity !== oldConfig.weather_entity;
    const forecastTypeChanged = oldConfig && (this.config.forecast || {}).type !== (oldConfig.forecast || {}).type;
    const forecastDaysChanged = oldConfig && this.config.forecast_days !== oldConfig.forecast_days;
    const autoscrollChanged = oldConfig && this.config.autoscroll !== oldConfig.autoscroll;

    // Tear down sources whose driving config changed; the next `set hass`
    // tick re-creates them with the new config, then _refreshForecasts
    // re-merges. This avoids the old direct `this.forecasts = …` write
    // that would clobber the station+forecast merge.
    if (sensorsChanged || daysChanged || stationToggled) {
      if (this._dataUnsubscribe) { this._dataUnsubscribe(); this._dataUnsubscribe = null; }
      this._dataSource = null;
      this._stationData = [];
    }
    if (forecastToggled || weatherEntityChanged || forecastTypeChanged) {
      if (this._forecastUnsubscribe) { this._forecastUnsubscribe(); this._forecastUnsubscribe = null; }
      this._forecastSource = null;
      this._forecastData = [];
    }

    // Pure render-only config changes (round_temp, colours, labels, …)
    // just need a chart redraw against the existing merged forecasts.
    if (this.forecasts && this.forecasts.length) {
      try { this._refreshForecasts(); } catch (e) { console.error('[weather-station-card] redraw failed', e); }
    } else if (forecastDaysChanged) {
      // forecast_days only crops what we already have; no resubscribe needed.
      try { this._refreshForecasts(); } catch (e) { console.error('[weather-station-card] redraw failed', e); }
    }

    if (autoscrollChanged) {
      if (!this.config.autoscroll) {
        this.autoscroll();
      } else {
        this.cancelAutoscroll();
      }
    }
  }

  if (changedProperties.has('weather')) {
    this.updateChart();
  }
}

autoscroll() {
  if (this.autoscrollTimeout) {
    // Autscroll already set, nothing to do
    return;
  }

  const updateChartOncePerHour = () => {
    const now = new Date();
    const nextHour = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
        now.getHours()+1,
    );
    this.autoscrollTimeout = setTimeout(() => {
      this.autoscrollTimeout = null;
      this.updateChart();
      updateChartOncePerHour();
    }, nextHour - now);
  };

  updateChartOncePerHour();
}

cancelAutoscroll() {
  if (this.autoscrollTimeout) {
    clearTimeout(this.autoscrollTimeout);
  }
}

drawChart(args) {
  try {
    return this._drawChartUnsafe(args);
  } catch (e) {
    console.error('[weather-station-card] drawChart failed', e);
    if (this.forecastChart) {
      try { this.forecastChart.destroy(); } catch (_) { /* already gone */ }
      this.forecastChart = null;
    }
  }
}

_drawChartUnsafe({ config, language, weather, forecastItems } = this) {
  if (!this.forecasts || !this.forecasts.length) {
    return [];
  }

  const chartCanvas = this.renderRoot && this.renderRoot.querySelector('#forecastChart');
  if (!chartCanvas) {
    console.error('Canvas element not found:', this.renderRoot);
    return;
  }

  if (this.forecastChart) {
    this.forecastChart.destroy();
  }
  var tempUnit = this._hass.config.unit_system.temperature;
  var lengthUnit = this._hass.config.unit_system.length;
  if (config.forecast.precipitation_type === 'probability') {
    var precipUnit = '%';
  } else {
    var precipUnit = lengthUnit === 'km' ? this.ll('units')['mm'] : this.ll('units')['in'];
  }
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

  if (config.forecast.precipitation_type === 'probability') {
    precipMax = 100;
  } else {
    if (config.forecast.type === 'hourly') {
      precipMax = lengthUnit === 'km' ? 4 : 1;
    } else {
      precipMax = lengthUnit === 'km' ? 20 : 1;
    }
  }

  Chart.defaults.color = textColor;
  Chart.defaults.scale.grid.color = dividerColor;
  Chart.defaults.elements.line.fill = false;
  Chart.defaults.elements.line.tension = 0.3;
  Chart.defaults.elements.line.borderWidth = 1.5;
  Chart.defaults.elements.point.radius = 2;
  Chart.defaults.elements.point.hitRadius = 10;

  // Suppress the line segment that would otherwise connect station-today
  // (rightmost station column) to forecast-today (leftmost forecast column).
  // Conceptually: measured value vs. predicted value — different sources,
  // shouldn't visually flow into each other. Markers (dots) stay visible.
  const stationCountForGap = this._stationCount || 0;
  const forecastCountForGap = this._forecastCount || 0;
  const hasBothBlocks = stationCountForGap > 0 && forecastCountForGap > 0;
  const gapStartIdx = stationCountForGap - 1;
  const segmentSkip = (ctx) => {
    if (!hasBothBlocks) return undefined;
    if (ctx.p0DataIndex === gapStartIdx && ctx.p1DataIndex === gapStartIdx + 1) {
      return 'transparent';
    }
    return undefined;
  };
  // Dash forecast segments to mark "predicted, not measured". A segment is
  // entirely in the forecast block when its left endpoint is at or past
  // the first forecast index (stationCount). The boundary segment is
  // already hidden by segmentSkip, so it doesn't matter whether it's dashed.
  const segmentDash = (ctx) => {
    if (ctx.p0DataIndex >= stationCountForGap && forecastCountForGap > 0) {
      return [6, 4];
    }
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
      // datalabels handled by precipLabelPlugin so the unit can render at
      // a smaller font next to the number. Keep formatter+display defined
      // so `forecast.show_probability` overlay still works through the
      // same pipeline when needed (the plugin reads them).
      datalabels: {
        display: function (context) {
          // Suppress the default chartjs-datalabels render — our plugin
          // draws number + unit with mixed font sizes instead.
          return false;
        },
      formatter: function (value, context) {
        const precipitationType = config.forecast.precipitation_type;

        const rainfall = context.dataset.data[context.dataIndex];
        const probability = data.forecast[context.dataIndex].precipitation_probability;

        let formattedValue;
        if (precipitationType === 'rainfall') {
          if (probability !== undefined && probability !== null && config.forecast.show_probability) {
	    formattedValue = `${rainfall > 9 ? Math.round(rainfall) : rainfall.toFixed(1)} ${precipUnit}\n${Math.round(probability)}%`;
          } else {
            formattedValue = `${rainfall > 9 ? Math.round(rainfall) : rainfall.toFixed(1)} ${precipUnit}`;
          }
        } else {
          formattedValue = `${rainfall > 9 ? Math.round(rainfall) : rainfall.toFixed(1)} ${precipUnit}`;
        }

        formattedValue = formattedValue.replace('\n', '\n\n');

        return formattedValue;
      },
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

  // Plugin: frames "today" with vertical separators.
  //
  // Both blocks active: today appears as a doubled column (station-today |
  // forecast-today). Draw a line on the LEFT of station-today and on the
  // RIGHT of forecast-today, but NOT between them — keeps Soll/Ist visually
  // grouped as one "today" block.
  //
  // Station-only: line at the left edge of today (rightmost column), so
  // today stays enclosed between the line and the chart's right border.
  //
  // Forecast-only: today is leftmost; the chart's left border already
  // encloses it, so a line on the right of today is enough.
  const stationCount = this._stationCount || 0;
  const forecastCount = this._forecastCount || 0;
  const separatorPlugin = {
    id: 'blockSeparator',
    afterDraw(chart) {
      const xScale = chart.scales.x;
      if (!xScale || !xScale.ticks) return;
      const ticks = xScale.ticks.length;
      const positions = computeBlockSeparatorPositions(stationCount, forecastCount, ticks);
      if (!positions.length) return;
      const c = chart.ctx;
      const { top, bottom } = chart.chartArea;
      const strokeColor = style.getPropertyValue('--secondary-text-color') || dividerColor;
      c.save();
      c.strokeStyle = strokeColor;
      c.lineWidth = 2;
      for (const [leftIdx, rightIdx] of positions) {
        const x = (xScale.getPixelForTick(leftIdx) + xScale.getPixelForTick(rightIdx)) / 2;
        c.beginPath();
        c.moveTo(x, top);
        c.lineTo(x, bottom);
        c.stroke();
      }
      c.restore();
    },
  };

  // Plugin: replaces Chart.js's daily tick labels with our own so we can
  // colour weekday and date differently. Chart.js still draws the labels
  // first (we need it to, otherwise it doesn't reserve axis height).
  // The plugin then masks the whole label area for each tick and
  // repaints weekday on top in the primary text colour, date below in
  // --secondary-text-color.
  const showDateRow = config.forecast.show_date !== false;
  const doubledToday = stationCount > 0 && forecastCount > 0;
  const dailyTickLabelsPlugin = {
    id: 'dailyTickLabels',
    afterDraw(chart) {
      if (config.forecast.type === 'hourly') return;
      const xScale = chart.scales.x;
      if (!xScale || !xScale.ticks) return;
      const c = chart.ctx;
      const fontSize = parseInt(config.forecast.labels_font_size) || 11;
      const lineH = Math.ceil(fontSize * 1.3);
      const weekdayColor = config.forecast.chart_datetime_color || textColor;
      const dateColor = style.getPropertyValue('--secondary-text-color') || weekdayColor;
      const todayMs = (() => { const t = new Date(); t.setHours(0,0,0,0); return t.getTime(); })();
      c.save();
      c.textAlign = 'center';
      c.textBaseline = 'bottom';
      for (let i = 0; i < xScale.ticks.length; i++) {
        const x = xScale.getPixelForTick(i);
        const datetime = data.dateTime[i];
        if (!datetime) continue;
        const d = new Date(datetime);
        const dKey = (() => { const k = new Date(d); k.setHours(0,0,0,0); return k.getTime(); })();
        const isToday = dKey === todayMs;
        const weekday = d.toLocaleString(language, { weekday: 'short' }).toUpperCase();
        const colW = (xScale.width / xScale.ticks.length);
        c.fillStyle = backgroundColor;
        c.fillRect(x - colW / 2, xScale.top, colW, xScale.bottom - xScale.top);

        // Today is a doubled column when both blocks are active. Skip the
        // station-today label (i = stationCount - 1) and draw a single
        // centered label at the boundary in the forecast-today pass.
        if (doubledToday && i === stationCount - 1) continue;
        const labelX = (doubledToday && i === stationCount)
          ? (xScale.getPixelForTick(i - 1) + x) / 2
          : x;

        c.font = `${fontSize}px Helvetica, Arial, sans-serif`;
        if (showDateRow) {
          const dateLabel = d.toLocaleDateString(language, {
            day: '2-digit',
            month: '2-digit',
          });
          c.fillStyle = dateColor;
          c.fillText(dateLabel, labelX, xScale.bottom - 2);
        }
        c.font = `${isToday ? 'bold ' : ''}${fontSize}px Helvetica, Arial, sans-serif`;
        c.fillStyle = weekdayColor;
        const weekdayY = showDateRow ? xScale.bottom - 2 - lineH : xScale.bottom - 2;
        c.fillText(weekday, labelX, weekdayY);
      }
      c.restore();
    },
  };

  // Plugin: renders precipitation labels with the value at the regular
  // labels_font_size and the unit at ~65 % so "mm" / "in" doesn't dominate
  // narrow bars. Replaces the chart's own datalabel for the precip dataset
  // (display:false above), and reproduces the boxed look (chart-bg fill,
  // bar-coloured 1.5 px border).
  const precipLabelPlugin = {
    id: 'precipLabel',
    afterDatasetsDraw(chart) {
      const meta = chart.getDatasetMeta(2); // tempHigh, tempLow, precip
      if (!meta || !meta.data) return;
      const c = chart.ctx;
      const baseSize = parseInt(config.forecast.labels_font_size) || 11;
      const smallSize = Math.max(6, Math.round(baseSize * 0.5));
      const padX = 3;
      const padY = 2;
      const gap = 2;
      const fontFamily = 'Helvetica, Arial, sans-serif';
      const showProb = config.forecast.precipitation_type === 'rainfall'
        && config.forecast.show_probability;
      // All labels share a fixed Y line just above the precipitation
      // axis baseline, so they sit in a row at the chart bottom regardless
      // of bar height (matches the original datalabels look).
      const precipAxis = chart.scales.PrecipAxis;
      const baselineY = precipAxis ? precipAxis.getPixelForValue(0) : chart.chartArea.bottom;
      c.save();
      c.textBaseline = 'middle';
      meta.data.forEach((bar, i) => {
        const value = data.precip[i];
        if (value == null || value <= 0) return;
        const number = value > 9 ? `${Math.round(value)}` : value.toFixed(1);
        const probability = data.forecast[i] && data.forecast[i].precipitation_probability;
        const showThisProb = showProb && probability !== undefined && probability !== null;

        c.font = `${baseSize}px ${fontFamily}`;
        const numberW = c.measureText(number).width;
        c.font = `${smallSize}px ${fontFamily}`;
        const unitW = c.measureText(precipUnit).width;
        const lineW = numberW + gap + unitW;

        let probLine = '';
        let probW = 0;
        if (showThisProb) {
          probLine = `${Math.round(probability)} %`;
          c.font = `${smallSize}px ${fontFamily}`;
          probW = c.measureText(probLine).width;
        }

        const contentW = Math.max(lineW, probW);
        const lineH = baseSize;
        const linesGap = showThisProb ? 2 : 0;
        const contentH = lineH + (showThisProb ? smallSize + linesGap : 0);

        const boxW = contentW + 2 * padX;
        const boxH = contentH + 2 * padY;
        const cx = bar.x;
        const boxLeft = cx - boxW / 2;
        // Centre the box on the precip-axis baseline so the zero-line
        // runs through the middle of every label.
        const boxTop = baselineY - boxH / 2;

        c.fillStyle = backgroundColor;
        c.strokeStyle = bar.options && bar.options.borderColor
          ? bar.options.borderColor
          : (precipPerBarColor[i] || precipColor);
        c.lineWidth = 1.5;
        c.fillRect(boxLeft, boxTop, boxW, boxH);
        c.strokeRect(boxLeft, boxTop, boxW, boxH);

        c.fillStyle = chart_text_color || textColor;
        c.textAlign = 'left';
        const lineCenterY = boxTop + padY + lineH / 2;
        const numberX = cx - lineW / 2;
        c.font = `${baseSize}px ${fontFamily}`;
        c.fillText(number, numberX, lineCenterY);
        c.font = `${smallSize}px ${fontFamily}`;
        c.fillText(precipUnit, numberX + numberW + gap, lineCenterY);

        if (showThisProb) {
          c.textAlign = 'center';
          c.fillText(probLine, cx, lineCenterY + lineH / 2 + linesGap + smallSize / 2);
        }
      });
      c.restore();
    },
  };

  this.forecastChart = new Chart(ctx, {
    type: 'bar',
    plugins: [separatorPlugin, dailyTickLabelsPlugin, precipLabelPlugin],
    data: {
      labels: data.dateTime,
      datasets: datasets,
    },
    options: {
      maintainAspectRatio: false,
      animation: config.forecast.disable_animation === true ? { duration: 0 } : {},
      layout: {
        padding: {
          bottom: 10,
        },
      },
      scales: {
        x: {
          position: 'top',
          border: {
            width: 0,
          },
          grid: {
            drawTicks: false,
            // Suppress only the gridline between station-today and
            // forecast-today (it sits inside the doubled-today framing);
            // keep the others as visual day separators.
            color: (ctx) => (doubledToday && ctx.index === stationCount)
              ? 'transparent'
              : dividerColor,
          },
          ticks: {
              maxRotation: 0,
              color: config.forecast.chart_datetime_color || textColor,
              padding: config.forecast.precipitation_type === 'rainfall' && config.forecast.show_probability && config.forecast.type !== 'hourly' ? 4 : 10,
              callback: function (value, index, values) {
                  var datetime = this.getLabelForValue(value);
                  var dateObj = new Date(datetime);
        
                  var timeFormatOptions = {
                      hour12: config.use_12hour_format,
                      hour: 'numeric',
                      ...(config.use_12hour_format ? {} : { minute: 'numeric' }),
                  };

                  var time = dateObj.toLocaleTimeString(language, timeFormatOptions);

                  if (dateObj.getHours() === 0 && dateObj.getMinutes() === 0 && config.forecast.type === 'hourly') {
                      var dateFormatOptions = {
                          day: 'numeric',
                          month: 'short',
                      };
                      var date = dateObj.toLocaleDateString(language, dateFormatOptions);
                      time = time.replace('a.m.', 'AM').replace('p.m.', 'PM');
                      return [date, time];
                  }

                  if (config.forecast.type !== 'hourly') {
                      var weekday = dateObj.toLocaleString(language, { weekday: 'short' }).toUpperCase();
                      // When the date row is hidden, return a single
                      // string so Chart.js only reserves one line of
                      // tick height and the chart reclaims the gap.
                      if (config.forecast.show_date === false) {
                          return weekday;
                      }
                      var dateLabel = dateObj.toLocaleDateString(language, { day: '2-digit', month: '2-digit' });
                      return [weekday, dateLabel];
                  }

                  time = time.replace('a.m.', 'AM').replace('p.m.', 'PM');
                  return time;
              },
          },
          reverse: document.dir === 'rtl' ? true : false,
        },
        TempAxis: {
          position: 'left',
          beginAtZero: false,
          suggestedMin: Math.min(...data.tempHigh, ...data.tempLow) - 5,
          suggestedMax: Math.max(...data.tempHigh, ...data.tempLow) + 6,
          border: {
            width: 0,
          },
          grid: {
            display: false,
            drawTicks: false,
          },
          ticks: {
            display: false,
          },
        },
        PrecipAxis: {
          position: 'right',
          suggestedMax: precipMax,
          border: {
            // No outer chart border on either side — today's framing is
            // carried by blockSeparatorPlugin alone.
            width: 0,
            color: style.getPropertyValue('--secondary-text-color') || dividerColor,
          },
          grid: {
            display: false,
            drawTicks: false,
          },
          ticks: {
            display: false,
          },
        },
      },
      plugins: {
        legend: {
          display: false,
        },
        datalabels: {
          backgroundColor: backgroundColor,
          borderColor: context => context.dataset.backgroundColor,
          borderRadius: 0,
          borderWidth: 1.5,
          padding: config.forecast.precipitation_type === 'rainfall' && config.forecast.show_probability && config.forecast.type !== 'hourly' ? 3 : 4,
          color: chart_text_color || textColor,
          font: function (context) {
            const dt = data.dateTime[context.dataIndex];
            const k = dt ? new Date(dt) : null;
            if (k) k.setHours(0, 0, 0, 0);
            const t = new Date(); t.setHours(0, 0, 0, 0);
            const isToday = k && k.getTime() === t.getTime();
            return {
              size: parseInt(config.forecast.labels_font_size) || 11,
              lineHeight: 0.7,
              weight: isToday ? 'bold' : 'normal',
            };
          },
          formatter: function (value, context) {
            return context.dataset.data[context.dataIndex] + '°';
          },
        },
        tooltip: {
          caretSize: 0,
          caretPadding: 15,
          callbacks: {
            title: function (TooltipItem) {
              var datetime = TooltipItem[0].label;
              return new Date(datetime).toLocaleDateString(language, {
                month: 'short',
                day: 'numeric',
                weekday: 'short',
                hour: 'numeric',
                minute: 'numeric',
                hour12: config.use_12hour_format,
              });
            },
    label: function (context) {
      var label = context.dataset.label;
      var value = context.formattedValue;
      var probability = data.forecast[context.dataIndex].precipitation_probability;
      var unit = context.datasetIndex === 2 ? precipUnit : tempUnit;

      if (config.forecast.precipitation_type === 'rainfall' && context.datasetIndex === 2 && config.forecast.show_probability && probability !== undefined && probability !== null) {
        return label + ': ' + value + ' ' + precipUnit + ' / ' + Math.round(probability) + '%';
      } else {
        return label + ': ' + value + ' ' + unit;
      }
            },
          },
        },
      },
    },
  });
}

computeForecastData({ config, forecastItems } = this) {
  var forecast = this.forecasts ? this.forecasts.slice(0, forecastItems) : [];
  var roundTemp = config.forecast.round_temp == true;
  var dateTime = [];
  var tempHigh = [];
  var tempLow = [];
  var precip = [];

  for (var i = 0; i < forecast.length; i++) {
    var d = forecast[i];
    if (config.autoscroll) {
      const cutoff = (config.forecast.type === 'hourly' ? 1 : 24) * 60 * 60 * 1000;
      if (new Date() - new Date(d.datetime) > cutoff) {
        continue;
      }
    }
    dateTime.push(d.datetime);
    tempHigh.push(d.temperature);
    if (typeof d.templow !== 'undefined') {
      tempLow.push(d.templow);
    }

    if (roundTemp) {
      tempHigh[i] = Math.round(tempHigh[i]);
      if (typeof d.templow !== 'undefined') {
        tempLow[i] = Math.round(tempLow[i]);
      }
    }
    if (config.forecast.precipitation_type === 'probability') {
      precip.push(d.precipitation_probability);
    } else {
      precip.push(d.precipitation);
    }
  }

  return {
    forecast,
    dateTime,
    tempHigh,
    tempLow,
    precip,
  }
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
    return html`
      <style>
        ha-icon {
          color: var(--paper-item-icon-color);
        }
        img {
          width: ${config.icons_size}px;
          height: ${config.icons_size}px;
        }
        .card {
          padding-top: ${config.title ? '0px' : '16px'};
          padding-right: 16px;
          padding-bottom: 16px;
          padding-left: 16px;
        }
        .main {
          display: flex;
          align-items: center;
          font-size: ${config.current_temp_size}px;
          margin-bottom: 10px;
        }
        .main ha-icon {
          --mdc-icon-size: 50px;
          margin-right: 14px;
          margin-inline-start: initial;
          margin-inline-end: 14px;
        }
        .main img {
          width: ${config.icons_size * 2}px;
          height: ${config.icons_size * 2}px;
          margin-right: 14px;
          margin-inline-start: initial;
          margin-inline-end: 14px;
        }
        .main div {
          line-height: 0.9;
        }
        .main span {
          font-size: 18px;
          color: var(--secondary-text-color);
        }
        .attributes {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 6px;
      	  font-weight: 300;
          direction: ltr;
        }
        .chart-container {
          position: relative;
          height: ${config.forecast.chart_height}px;
          width: 100%;
          direction: ltr;
        }
        .conditions {
          display: flex;
          justify-content: space-around;
          align-items: center;
          margin: 0px 5px 0px 5px;
      	  cursor: pointer;
        }
        .forecast-item {
          display: flex;
          flex-direction: column;
          align-items: center;
          margin: 1px;
        }
        .wind-details {
          display: flex;
          justify-content: space-around;
          align-items: center;
          font-weight: 300;
        }
        .wind-detail {
          display: flex;
          align-items: center;
          margin: 1px;
        }
        .wind-detail ha-icon {
          --mdc-icon-size: 15px;
          margin-right: 1px;
          margin-inline-start: initial;
          margin-inline-end: 1px;
        }
        .wind-icon {
          margin-right: 1px;
          margin-inline-start: initial;
          margin-inline-end: 1px;
          position: relative;
	        bottom: 1px;
        }
        .wind-speed {
          font-size: 11px;
          margin-right: 1px;
          margin-inline-start: initial;
          margin-inline-end: 1px;
        }
        .wind-unit {
          font-size: 9px;
          margin-left: 1px;
          margin-inline-start: 1px;
          margin-inline-end: initial;
        }
        .current-time {
          position: absolute;
          top: 20px;
          right: 16px;
          inset-inline-start: initial;
          inset-inline-end: 16px;
          font-size: ${config.time_size}px;
        }
        .date-text {
          font-size: ${config.day_date_size}px;
          color: var(--secondary-text-color);
        }
      </style>

      <ha-card header="${config.title}">
        <div class="card">
          ${this.renderErrorBanner()}
          ${this.renderMain()}
          ${this.renderAttributes()}
          <div class="chart-container">
            <canvas id="forecastChart"></canvas>
          </div>
          ${this.renderForecastConditionIcons()}
          ${this.renderWind()}
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
    <div class="conditions" @click="${(e) => this.showMoreInfo(config.sensors && config.sensors.temperature)}">
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

  if (!showWindForecast) {
    return html``;
  }

  const forecast = this.forecasts ? this.forecasts.slice(0, forecastItems) : [];

  return html`
    <div class="wind-details">
      ${showWindForecast ? html`
        ${forecast.map((item) => {
          const raw = item.wind_gust_speed != null ? item.wind_gust_speed : item.wind_speed;
          const dWindSpeed = this._convertWindSpeed(raw);

          return html`
            <div class="wind-detail">
              <ha-icon class="wind-icon" icon="hass:${this.getWindDirIcon(item.wind_bearing)}"></ha-icon>
              <span class="wind-speed">${dWindSpeed ?? ''}</span>
              <span class="wind-unit">${this.ll('units')[this.unitSpeed]}</span>
            </div>
          `;
        })}
      ` : ''}
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

  showMoreInfo(entity) {
    this._fire('hass-more-info', { entityId: entity });
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
