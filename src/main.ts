// main.ts — integration boundary file. ~1500 LOC of LitElement +
// Home Assistant + Chart.js wiring. Type-checked under `tsc --strict`
// since v1.8 (#33). HA-shaped fields use the `HassMain` extension of
// the data-source `HassLike` type below — full HomeAssistant type
// would pull in too many UI deps. Anything where the HA frontend
// type-shape isn't documented (synthesised `weather`, editor-callback
// payloads) is `any`-typed, with eslint-disable lines limited to
// those exact slots.
//
// Why the opt-out: this class touches ~30 instance fields (forecasts,
// weather, current sensor readings, scroll-ux teardowns, animation
// controllers, …), most of which were declared implicitly via runtime
// assignment in `set hass` / `setConfig`. Strict-typing them all means
// porting half a dozen HA frontend type imports we don't currently
// depend on, mocking them where the types are missing, and threading
// `HassLike` through the entire render path. None of that adds value
// to the v1.2 milestone, which is "the codebase compiles under TS and
// downstream contributors get types when they import from us".
//
// The boundary modules main.ts pulls in (data-source, chart/*,
// sunshine-source, openmeteo-source, scroll-ux, action-handler,
// editor/*) ARE all strictly typed — anyone importing from this card
// gets typed exports. Tightening main.ts itself is tracked as future
// follow-up.

import locale from './locale.js';
import {
  cardinalDirectionsIcon,
  weatherIcons,
  weatherIconsDay,
  weatherIconsNight,
} from './const.js';
import { DEFAULTS, DEFAULTS_FORECAST, DEFAULTS_UNITS } from './defaults.js';
import {LitElement, html} from 'lit';
import './weather-station-card-editor.js';
import { MeasuredDataSource, ForecastDataSource, type HassLike } from './data-source.js';
import { classifyDay, clearSkyLuxAt } from './condition-classifier.js';
import { computeInitialScrollLeft } from './format-utils.js';
import {
  hourlyTempSeries,
  normalizeForecastMode,
  startOfTodayMs,
  filterMidnightStaleForecast,
  dropEmptyStationToday,
  aggregateThreeHour,
  nextForecastType,
  stationFetchKey,
  forecastFetchKey,
  forecastsEqual,
} from './forecast-utils.js';
import { overlayFromOpenMeteo, sunshineFractions } from './sunshine-source.js';
import { OpenMeteoSunshineSource } from './openmeteo-source.js';
import { safeQuery } from './utils/safe-query.js';
import { parseNumericSafe } from './utils/numeric.js';
import { setupScrollUx } from './scroll-ux.js';
import { setupActionHandler } from './action-handler.js';
import { TeardownRegistry } from './teardown-registry.js';
import { drawChartUnsafe } from './chart/orchestrator.js';
import { cardStyles } from './chart/styles.js';
import {Chart, registerables} from 'chart.js';
import ChartDataLabels from 'chartjs-plugin-datalabels';
Chart.register(...registerables, ChartDataLabels);

/** Card-side extension of `HassLike`. main.ts reads two fields the
 *  data-sources don't (`language`, `selectedLanguage`) — they pick
 *  the locale for `Intl` formatters in the live-condition / clock
 *  paths. */
interface HassMain extends HassLike {
  language?: string;
  selectedLanguage?: string;
}

/** Sub-shapes used inside `set hass`: a single HA entity state from
 *  `hass.states[eid]`. Defined here rather than in HassLike so the
 *  data-source layer doesn't need it. */
interface HassEntityState {
  state: string;
  attributes?: Record<string, unknown>;
}

/** Augment the global Window so `window.customCards` (HA's card-list
 *  registry) is typed wherever main.ts touches it. */
declare global {
  interface Window {
    // deno-lint-ignore no-explicit-any
    customCards?: any[];
  }
}

// Field-declaration block for the WeatherStationCard class. HA-shaped
// fields are typed as `any` (or HassMain where threaded) — the full
// HomeAssistant type pulls in HA frontend deps we don't otherwise
// need. Reactive Lit properties are declared as plain fields here
// and referenced in `static get properties()` below; Lit's runtime
// decoration syncs the two without further gymnastics.
class WeatherStationCard extends LitElement {
  // --- Reactive properties (referenced in static get properties()) ---
  // Hass is stored as `_hass` per HA's pattern; the public `hass` is
  // a setter that stamps `_hass` and also derives sensor-state values.
  /** Home Assistant state object. Card-side `HassMain` extends the
   *  data-source `HassLike` with the extra locale fields the live-
   *  condition / clock formatters read. */
  _hass: HassMain | null = null;
  // deno-lint-ignore no-explicit-any
  config: any = null;
  language: string = 'en';
  // deno-lint-ignore no-explicit-any
  sun: any = null;
  // deno-lint-ignore no-explicit-any
  weather: any = null;
  // deno-lint-ignore no-explicit-any
  temperature: any;
  // deno-lint-ignore no-explicit-any
  humidity: any;
  // deno-lint-ignore no-explicit-any
  pressure: any;
  // deno-lint-ignore no-explicit-any
  windSpeed: any;
  // deno-lint-ignore no-explicit-any
  windDirection: any;
  // deno-lint-ignore no-explicit-any
  forecastChart: any = null;
  // deno-lint-ignore no-explicit-any
  forecastItems: any;
  // deno-lint-ignore no-explicit-any
  forecasts: any[] | null = null;

  // --- Sensor state (read from `set hass`) ---
  // deno-lint-ignore no-explicit-any
  uv_index: any;
  // deno-lint-ignore no-explicit-any
  dew_point: any;
  // deno-lint-ignore no-explicit-any
  wind_gust_speed: any;
  unitSpeed: string | undefined;
  unitPressure: string | undefined;
  baseIconPath: string | undefined;

  // --- Caching / live-condition memo ---
  _liveConditionKey: string | undefined;
  _liveCondition: string | undefined;

  // --- Data-source state ---
  _dataSource: MeasuredDataSource | null = null;
  _dataUnsubscribe: (() => void) | null = null;
  _forecastSource: ForecastDataSource | null = null;
  _forecastUnsubscribe: (() => void) | null = null;
  // deno-lint-ignore no-explicit-any
  _stationData: any[] = [];
  // deno-lint-ignore no-explicit-any
  _forecastData: any[] = [];
  _stationError: string | null = null;
  _forecastError: string | null = null;
  _stationCount: number = 0;
  _forecastCount: number = 0;
  _missingSensors: string[] = [];
  // Lazy-cache for #10 mode-toggle.
  // deno-lint-ignore no-explicit-any
  _stationCache: Record<string, any[]> = {};
  // deno-lint-ignore no-explicit-any
  _forecastCache: Record<string, any[]> = {};
  // deno-lint-ignore no-explicit-any
  _sunshineSource: any = null;

  // --- Chart / scroll lifecycle ---
  _chartError: unknown = null;
  _chartPhase: string | null = null;
  // deno-lint-ignore no-explicit-any
  resizeObserver: any = null;
  resizeInitialized: boolean = false;
  _resizeRaf: number | null = null;
  // deno-lint-ignore no-explicit-any
  _initialScrollObserver: any = null;
  _initialScrollApplied: boolean = false;
  _pendingScrollFrame: number | null = null;
  _lastScrollGeneration: string | undefined;
  _scrollUxTeardown: (() => void) | null = null;
  _actionHandlerTeardown: (() => void) | null = null;
  _clockTimer: ReturnType<typeof setInterval> | null = null;
  // Cross-module shared flag (scroll-ux ↔ action-handler): a swipe /
  // drag sets this so a trailing tap doesn't fire the card-level
  // tap_action. Owned by scroll-ux but lives on the card so the
  // action-handler can read it.
  _dragMoved: boolean = false;
  // deno-lint-ignore no-explicit-any
  _teardownRegistry: any;

static getConfigElement() {
  return document.createElement("weather-station-card-editor");
}

static getStubConfig(hass: HassMain | null, _unusedEntities: string[], allEntities: string[]) {
  // Auto-detect station sensors by device_class. Fall back to entity-id
  // pattern matching for the precipitation case (no standard device_class
  // for cumulative rain on every integration).
  const findByClass = (cls: string): string | undefined => {
    const all = allEntities || [];
    return all.find((eid: string) => {
      if (!eid.startsWith('sensor.')) return false;
      const st = hass?.states?.[eid];
      return st?.attributes?.device_class === cls;
    });
  };
  const findByPattern = (re: RegExp): string | undefined => {
    const all = allEntities || [];
    return all.find((eid: string) => eid.startsWith('sensor.') && re.test(eid));
  };

  return {
    ...DEFAULTS,
    // Picker preview renders this stub before any recorder data is
    // available, so the past chart would otherwise come up empty and
    // HA falls back to a description-only tile. The live now-panel
    // (driven by hass.states, no recorder dependency) gives the picker
    // an immediate, honest visual — no synthetic NaN values needed.
    // New users adding the card via the picker also benefit from a
    // richer default than just the chart row.
    show_main: true,
    show_current_condition: true,
    show_attributes: true,
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

// HA passes the card's user-edited YAML as a fresh object on every
// `setConfig`. The shape is fully user-controlled so we type it as
// `any` and let `cardConfig` apply defaults and structural normalisation.
// deno-lint-ignore no-explicit-any
setConfig(config: any) {
  const cardConfig = {
    ...DEFAULTS,
    ...config,
    forecast: {
      ...DEFAULTS_FORECAST,
      ...(config.forecast || {}),
    },
    units: {
      ...DEFAULTS_UNITS,
      ...(config.units || {}),
    },
    sensors: {
      ...(config.sensors || {}),
    },
  };

  cardConfig.units.speed = config.speed ? config.speed : cardConfig.units.speed;

  // Live-condition memoization (set hass) keys partly off `condition_mapping`;
  // wipe the cached entry so the next hass tick reclassifies with the new
  // mapping instead of returning a stale label.
  this._liveConditionKey = undefined;
  this._liveCondition = undefined;

  this.baseIconPath = cardConfig.icon_style === 'style2' ?
    'https://cdn.jsdelivr.net/gh/chriguschneider/weather-station-card/dist/icons2/':
    'https://cdn.jsdelivr.net/gh/chriguschneider/weather-station-card/dist/icons/' ;

  this.config = cardConfig;

  // Mode-aware validation. Each enabled block has its own required key:
  //   show_station    → needs sensors.temperature (the past-data chart)
  //   show_forecast   → needs weather_entity      (the future-data chart)
  // A pure forecast-only card needs no station sensors; a pure station
  // card needs no weather entity. Combination needs both.
  if (cardConfig.show_station && !cardConfig.sensors?.temperature) {
    throw new Error('Station mode needs at least sensors.temperature in the card config');
  }
  if (cardConfig.show_forecast && !cardConfig.weather_entity) {
    throw new Error('Forecast mode needs a weather.* entity in weather_entity');
  }
}

set hass(hass: HassMain) {
  this._hass = hass;
  this.language = this.config.locale || hass.selectedLanguage || hass.language || 'en';
  this.sun = (hass.states && 'sun.sun' in hass.states) ? hass.states['sun.sun'] : null;

  const sensors = this.config.sensors || {};
  const stateOf = (eid: string | undefined): HassEntityState | null =>
    (eid && hass.states?.[eid]) ? (hass.states[eid] as HassEntityState) : null;
  const valueOf = (eid: string | undefined): string | undefined => {
    const s = stateOf(eid);
    return s ? s.state : undefined;
  };
  const attrOf = (eid: string | undefined, attr: string): unknown => {
    const s = stateOf(eid);
    return s?.attributes?.[attr];
  };

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
  this.windDirection = sensors.wind_direction && hass.states?.[sensors.wind_direction]
    ? parseFloat(hass.states[sensors.wind_direction]!.state)
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
  const precipUnitRaw = attrOf(sensors.precipitation, 'unit_of_measurement');
  const precipUnit = typeof precipUnitRaw === 'string' ? precipUnitRaw : '';
  const precipIsRate = /\/(h|hr|hour)$/i.test(precipUnit);
  const precipRateNow = precipIsRate ? parseNumericSafe(valueOf(sensors.precipitation)) : null;
  const lat = hass.config?.latitude;
  const lon = hass.config?.longitude;

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
          const newData = event.forecast || [];
          const newError = event.error || null;
          // Skip the re-render path when HA's WS layer fan-outs an
          // identical payload (#55) — common when a sibling card on
          // the same dashboard resubscribes against the same recorder
          // bucket and HA broadcasts the cached state to every
          // subscriber. The error string flips equally rarely so an
          // identical-data + identical-error event is a true no-op.
          if (forecastsEqual(this._stationData, newData) && this._stationError === newError) {
            return;
          }
          this._stationData = newData;
          this._stationCache[stationFetchKey(this.config)] = this._stationData;
          this._stationError = newError;
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
          const newData = event.forecast || [];
          const newError = event.error || null;
          // Same fan-out suppression as the station path above (#55).
          // weather/subscribe_forecast in HA fan-outs the entity's
          // current forecast to every active subscriber whenever
          // any one of them (re)subscribes — without this guard, a
          // mode-toggle on Card A would visibly redraw Card B's
          // chart on the same dashboard.
          if (forecastsEqual(this._forecastData, newData) && this._forecastError === newError) {
            return;
          }
          this._forecastData = newData;
          this._forecastCache[forecastFetchKey(this.config)] = this._forecastData;
          this._forecastError = newError;
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
    if (!eid || typeof eid !== 'string') continue;
    const s = hass.states?.[eid];
    if (!s || s.state === 'unavailable' || s.state === 'unknown') {
      this._missingSensors.push(`${key} (${eid})`);
    }
  }
}

  constructor() {
    super();
    this.resizeObserver = null;
    this.resizeInitialized = false;
    this._teardownRegistry = new TeardownRegistry();
    // Lazy-cache (#10): when forecast.type changes, save the current
    // data under the OLD fetch-key and restore the NEW key from cache
    // for an instant render. Fresh data lands on the resubscribe
    // callback and overwrites the cached entry.
    //   _stationCache  → keyed by recorder period: 'day' | 'hour'
    //   _forecastCache → keyed by subscribe forecast_type: 'daily' | 'hourly'
    // 'today' shares 'hour' / 'hourly' with the dedicated hourly mode
    // because both fetch the same buckets — the difference is purely
    // render-time aggregation. Toggling hourly↔today therefore needs
    // no teardown at all.
    this._stationCache = {};
    this._forecastCache = {};
  }

  connectedCallback() {
    super.connectedCallback();
    if (!this.resizeInitialized) {
      this.delayedAttachResizeObserver();
    }
    this._registerLifecycleTeardowns();
  }

  // Wire every disconnect-time cleanup site through the single
  // TeardownRegistry. Closures dereference `this._foo` at drain time,
  // so resources that get replaced during the card's lifetime
  // (e.g. _clockTimer rebuilt on settings change) are still torn down
  // correctly. Registration is gated on registry.size to keep
  // reconnect-after-disconnect idempotent.
  _registerLifecycleTeardowns() {
    if (this._teardownRegistry.size > 0) return;
    const r = this._teardownRegistry;
    r.add(() => this.detachResizeObserver());
    r.add(() => this._teardownStation());
    r.add(() => this._teardownForecast());
    r.add(() => this._teardownInitialScrollObserver());
    r.add(() => {
      if (this._sunshineSource) {
        this._sunshineSource.abort();
        this._sunshineSource = null;
      }
    });
    r.add(() => {
      if (this._scrollUxTeardown) {
        this._scrollUxTeardown();
        this._scrollUxTeardown = null;
      }
    });
    r.add(() => {
      if (this._actionHandlerTeardown) {
        this._actionHandlerTeardown();
        this._actionHandlerTeardown = null;
      }
    });
    r.add(() => {
      if (this._clockTimer) {
        clearInterval(this._clockTimer);
        this._clockTimer = null;
      }
    });
  }

  delayedAttachResizeObserver() {
    setTimeout(() => {
      this.attachResizeObserver();
      this.resizeInitialized = true;
    }, 0);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._teardownRegistry.drain();
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
    const fcType = effectiveCfg.forecast.type;
    const isToday = fcType === 'today';
    if (effectiveCfg.show_forecast === true && effectiveCfg.weather_entity) {
      // `days` / `forecast_days` are the data-loading window in days for
      // both modes; at hourly each day expands to 24 buckets.
      //
      // 'today' caps the forecast slice at end-of-today (tomorrow's
      // local midnight). Combined with the data source's
      // today-midnight-to-now station window, the chart shows exactly
      // today's 24 hours — no yesterday spill, no tomorrow spill.
      const isHourlyish = fcType === 'hourly' || isToday;
      const slotsPerUnit = isHourlyish ? 24 : 1;
      const cap = parseInt(effectiveCfg.forecast_days, 10);
      const dayLimit = cap > 0 ? cap : (parseInt(effectiveCfg.days, 10) || 7);
      // 'today': in COMBINATION the forecast block carries 12 hours
      // forward (paired with 12 station hours back). In FORECAST-ONLY
      // (no station block) the forecast expands to the full 24 hours
      // forward so the user still sees a one-day view.
      const isForecastOnly = isToday && effectiveCfg.show_station === false;
      const limit = isToday ? (isForecastOnly ? 24 : 12) : dayLimit * slotsPerUnit;
      forecast = filterMidnightStaleForecast(this._forecastData || [], todayStartMs)
        .slice(0, limit);
    }
    station = [...dropEmptyStationToday(station, todayStartMs)];
    this._ensureSunshineSource(effectiveCfg);
    if (isToday) {
      // 'today' flow:
      //   1. Apply HOURLY sunshine to each entry (per-hour value).
      //   2. 3-hour aggregate: temp/wind/etc. mean, precip+sunshine
      //      SUM, condition mode. Day-length stays at hourly
      //      semantics (1h per block × 3 = 3h denominator).
      //   3. Recompute day_length to 3 (3 hours per block).
      const merged = overlayFromOpenMeteo(
        [...station, ...forecast],
        this._hass,
        this._sunshineSource,
        'hourly',
      );
      const stationLen = station.length;
      const stationWithSun = merged.slice(0, stationLen);
      const forecastWithSun = merged.slice(stationLen);
      station = aggregateThreeHour(stationWithSun);
      forecast = aggregateThreeHour(forecastWithSun);
      // Each 3h block represents 3 hours of "day". Used as the
      // denominator for the sunshine fraction (sunshine_h / 3).
      for (const e of station) e.day_length = 3;
      for (const e of forecast) e.day_length = 3;
      this._stationCount = station.length;
      this._forecastCount = forecast.length;
      this.forecasts = [...station, ...forecast];
    } else {
      this._stationCount = station.length;
      this._forecastCount = forecast.length;
      const granularity = fcType === 'hourly' ? 'hourly' : 'daily';
      // F3 fallback (#6): when neither sensor.sunshine_duration nor
      // Open-Meteo resolves a forecast value, the configured exponent
      // (default 1.7, tunable via condition_mapping.sunshine_cloud_exponent)
      // lets attachSunshine derive the value from forecast.cloud_coverage
      // via the Kasten formula. Setting the exponent to null disables
      // F3 entirely.
      const cm = effectiveCfg.condition_mapping || {};
      const cloudExp = (cm.sunshine_cloud_exponent != null && Number.isFinite(cm.sunshine_cloud_exponent))
        ? Number(cm.sunshine_cloud_exponent)
        : 1.7;
      this.forecasts = overlayFromOpenMeteo(
        [...station, ...forecast],
        this._hass,
        this._sunshineSource,
        granularity,
        granularity === 'daily' ? cloudExp : null,
      );
    }
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
  // deno-lint-ignore no-explicit-any
  _ensureSunshineSource(effectiveCfg: any) {
    const enabled = effectiveCfg?.forecast?.show_sunshine === true;
    if (!enabled) {
      if (this._sunshineSource) {
        this._sunshineSource.abort();
        this._sunshineSource = null;
      }
      return;
    }
    const cfg = this._hass?.config;
    const lat = cfg && Number.isFinite(cfg.latitude) ? cfg.latitude : null;
    const lon = cfg && Number.isFinite(cfg.longitude) ? cfg.longitude : null;
    if (lat == null || lon == null) return;

    // 'today' uses hourly Open-Meteo data (per-hour bars), same as
    // 'hourly' mode. Daily-only modes don't need the hourly fetch.
    const includeHourly = effectiveCfg.forecast.type === 'hourly'
      || effectiveCfg.forecast.type === 'today';

    // Re-create when location or hourly-mode flag changes — the
    // includeHourly flag determines whether the request URL carries
    // `hourly=…`, so flipping it requires a fresh fetch.
    const same = this._sunshineSource?.latitude === lat
      && this._sunshineSource?.longitude === lon
      && this._sunshineSource?.includeHourly === includeHourly;
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
      this._sunshineSource.setListener((event: { ok: boolean; error?: string } | null) => {
        // On a successful refresh, recompute the forecasts so the new
        // sunshine values land on the entries — and redraw the chart.
        if (event?.ok) this._refreshForecasts();
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
    const card = this.shadowRoot?.querySelector('ha-card');
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
  if (this.forecasts?.length) {
    this.forecastItems = this.forecasts.length;
  } else {
    const fontSize = this.config.forecast.labels_font_size;
    this.forecastItems = Math.round((card as HTMLElement).offsetWidth / (fontSize * 6));
  }
  this.drawChart();
}

// deno-lint-ignore no-explicit-any
ll(str: string): any {
  const selectedLocale: string = this.config.locale || this.language || 'en';

  // deno-lint-ignore no-explicit-any
  const localeAny = locale as Record<string, Record<string, any>>;
  if (localeAny[selectedLocale] === undefined) {
    return localeAny.en[str];
  }

  return localeAny[selectedLocale][str];
}

  // HA masonry-view layout uses getCardSize() to reserve space.
  // Each unit ≈ 50 px. The chart row is the dominant block; the
  // optional main panel adds 1–2 (with/without time); the attributes
  // row adds 1. Floor at 1 to keep the picker preview from collapsing.
  getCardSize() {
    let size = 0;
    if (this.config?.show_main) size += this.config.show_time ? 2 : 1;
    if (this.config?.show_attributes) size += 1;
    if (this.config?.show_station || this.config?.show_forecast) size += 3;
    return Math.max(size, 1);
  }

  getUnit(unit: string): string {
    const us = this._hass?.config && (this._hass.config as { unit_system?: Record<string, string> }).unit_system;
    return us?.[unit] || '';
  }

  getWeatherIcon(condition: string, sun: string | undefined): string {
    const condKey = condition as keyof typeof weatherIcons;
    if (this.config.animated_icons === true) {
      const iconName = sun === 'below_horizon' ? weatherIconsNight[condKey] : weatherIconsDay[condKey];
      return `${this.baseIconPath}${iconName}.svg`;
    } else if (this.config.icons) {
      const iconName = sun === 'below_horizon' ? weatherIconsNight[condKey] : weatherIconsDay[condKey];
      return `${this.config.icons}${iconName}.svg`;
    }
    return weatherIcons[condKey];
  }

getWindDirIcon(deg: number | string): string {
  if (typeof deg === 'number') {
    return cardinalDirectionsIcon[Math.floor((deg + 22.5) / 45.0)];
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

getWindDir(deg: number | string): string {
  if (typeof deg === 'number') {
    return this.ll('cardinalDirections')[Math.floor((deg + 11.25) / 22.5)];
  } else {
    return deg;
  }
}

calculateBeaufortScale(windSpeed: number) {
  const unitConversion = {
    'km/h': 1,
    'm/s': 3.6,
    'mph': 1.60934,
  };

  const wind_speed_unit = this.weather?.attributes
    ? this.weather.attributes.wind_speed_unit
    : null;
  const conversionFactor = unitConversion[wind_speed_unit as keyof typeof unitConversion] || unitConversion['m/s'];
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

async firstUpdated(changedProperties: Map<PropertyKey, unknown>) {
  super.firstUpdated(changedProperties);
  this.measureCard();
  await new Promise(resolve => setTimeout(resolve, 0));
  this.drawChart();
}


async updated(changedProperties: Map<PropertyKey, unknown>) {
  await this.updateComplete;

  // Re-attempt action-handler binding after every render. Lit can swap
  // the <ha-card> element when the render branch changes (the
  // weather-undefined fallback uses a different template than the
  // populated branch); the per-element _wsActionHandlerBound flag
  // makes this idempotent on stable elements.
  // The card class has all the fields these helpers need (verified at
  // runtime by the v0.6 extraction); the structural-mismatch errors come
  // from the helpers' tighter `forecasts: ForecastEntry[]` and config
  // shapes. Cast through `unknown` to keep tsc happy while preserving
  // the runtime assumption.
  setupActionHandler(this as unknown as Parameters<typeof setupActionHandler>[0]);
  this._maybeApplyInitialScroll(changedProperties);
  setupScrollUx(this as unknown as Parameters<typeof setupScrollUx>[0]);

  if (changedProperties.has('config')) {
    const oldConfig = changedProperties.get('config');
    if (oldConfig) {
      this._invalidateStaleSources(oldConfig);

      // Pure render-only config changes (round_temp, colours, labels, …)
      // re-merge against existing forecasts; teardowns above will refill
      // anyway via the next `set hass` tick. forecast_days alone only
      // crops what we already have, so trigger refresh even with no data
      // currently merged.
      const forecastDaysChanged = this.config.forecast_days !== (oldConfig as { forecast_days?: unknown })?.forecast_days;
      if ((this.forecasts?.length) || forecastDaysChanged) {
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
//
// Mode-toggle lazy-cache (#10): when only forecast.type changed and the
// underlying recorder/subscribe fetch-key is the same (e.g. hourly↔today
// share period='hour' and forecast_type='hourly'), no teardown is needed
// at all — the displayed data is already correct, only the render-time
// aggregation differs. When the fetch-key DOES change, the previous data
// is preserved in `_stationCache` / `_forecastCache` and restored from
// cache for the new mode if available — so a daily→hourly→daily cycle
// re-displays the daily data immediately while the new subscribe is
// in-flight, and again when the user goes back to hourly.
// deno-lint-ignore no-explicit-any
_invalidateStaleSources(oldConfig: any) {
  // deno-lint-ignore no-explicit-any
  const get = (obj: any, path: string) => path.split('.').reduce<any>(
    (o, k) => (o == null ? undefined : o[k]),
    obj,
  );
  const stale = (key: string) => JSON.stringify(get(this.config, key)) !== JSON.stringify(get(oldConfig, key));
  // forecast.type also drives MeasuredDataSource (hourly station
  // aggregates use period:'hour'), so toggling it can rebuild both
  // sources; lazy-cache below decides whether the rebuild is needed.
  const STATION_KEYS = ['sensors', 'days', 'show_station', 'forecast.type'];
  const FORECAST_KEYS = ['show_forecast', 'weather_entity', 'forecast.type'];

  const stationStale = STATION_KEYS.some(stale);
  const forecastStale = FORECAST_KEYS.some(stale);
  if (!stationStale && !forecastStale) return;

  const oldStationKey = stationFetchKey(oldConfig);
  const newStationKey = stationFetchKey(this.config);
  const oldForecastKey = forecastFetchKey(oldConfig);
  const newForecastKey = forecastFetchKey(this.config);

  // The only mode-toggle case that doesn't need a refetch: forecast.type
  // changed but the underlying fetch keys did NOT (hourly ↔ today). In
  // that case `stale` flagged forecast.type but the data we have is
  // still correct — just refresh the render.
  const onlyForecastTypeChanged =
    stale('forecast.type') &&
    !STATION_KEYS.filter((k) => k !== 'forecast.type').some(stale) &&
    !FORECAST_KEYS.filter((k) => k !== 'forecast.type').some(stale);
  if (onlyForecastTypeChanged && oldStationKey === newStationKey && oldForecastKey === newForecastKey) {
    return;
  }

  // Everything else needs at least one teardown. Try to surface cached
  // data for the new mode immediately so the chart doesn't go blank
  // while the resubscribe is in flight.
  if (stationStale) {
    this._teardownStation();
    if (oldStationKey !== newStationKey) {
      const cached = this._stationCache[newStationKey];
      if (cached?.length) this._stationData = cached.slice();
    }
  }
  if (forecastStale) {
    this._teardownForecast();
    if (oldForecastKey !== newForecastKey) {
      const cached = this._forecastCache[newForecastKey];
      if (cached?.length) this._forecastData = cached.slice();
    }
  }

  // Re-run the data-source-creation path proactively. Without this the
  // chart waits for HA's next state push (1-3 s on a Pi) before
  // subscribing — defeating the lazy-cache UX.
  if (this._hass) this.hass = this._hass;
  this._refreshForecasts();
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

// deno-lint-ignore no-explicit-any
drawChart(args?: any): unknown[] | undefined {
  try {
    const result = drawChartUnsafe(this as unknown as Parameters<typeof drawChartUnsafe>[0], args);
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
    const err = e as { message?: string } | null;
    const msg = String(err?.message ? err.message : e);
    this._chartError = `${phase}: ${msg}`;
    this._chartPhase = null;
    this.requestUpdate();
    return undefined;
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
  if (!forecasts?.length) {
    return;
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
  const type = cfg.forecast?.type;
  // 3-way cycle: daily → today → hourly → daily.
  // Icon shows the NEXT mode you'd land on, so users can predict the
  // click. "today" is signified by mdi:clock-time-eight-outline (the
  // hour-clock face); "hourly" by mdi:weather-sunset (the multi-hour
  // strip); "daily" by mdi:calendar-month-outline (the multi-day grid).
  let icon, label;
  if (type === 'today') {
    icon = 'mdi:weather-sunset';
    label = 'Switch to hourly (7-day) forecast';
  } else if (type === 'hourly') {
    icon = 'mdi:calendar-month-outline';
    label = 'Switch to daily forecast';
  } else {
    icon = 'mdi:clock-time-eight-outline';
    label = 'Switch to today (24-hour) forecast';
  }
  return html`
    <button type="button" class="mode-toggle" aria-label="${label}"
            title="${label}"
            @click=${this._onModeToggleClick}>
      <ha-icon icon=${icon} aria-hidden="true"></ha-icon>
    </button>
  `;
}

// Cycle through daily → today → hourly → daily via the same setConfig
// path the editor radio uses. _invalidateStaleSources picks up the
// forecast.type change and rebuilds both station and forecast data
// sources, so the new mode's data loads on demand. The mutation does
// NOT persist to the user's saved YAML — refresh resets to whatever
// they configured. For permanent changes, the editor's radio.
_onModeToggleClick(ev?: Event) {
  if (ev) ev.stopPropagation();
  const cfg = this.config || {};
  const fcfg = cfg.forecast || {};
  this.setConfig({ ...cfg, forecast: { ...fcfg, type: nextForecastType(fcfg.type) } });
}

  render({config, _hass, weather} = this) {
    if (!config || !_hass) {
      return html``;
    }
    // Match the mm-unit sizing rule from precipLabelPlugin so the wind unit
    // ("km/h", "m/s", …) renders at the same compact size as the precip unit
    // alongside its number.
    const labelsBaseSize = parseInt(config?.forecast?.labels_font_size) || 11;
    const labelsSmallSize = Math.max(6, Math.round(labelsBaseSize * 0.5));
    if (!weather?.attributes) {
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
    //
    // 'today' is 3-hour-aggregated to exactly 8 bars (00-02, 03-05,
    // …, 21-23) so the default 8-bar viewport fits the whole day
    // with no scroll.
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
  if (this._missingSensors?.length) {
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
    const currentTime = currentDate.toLocaleTimeString(this.language, timeOptions as Intl.DateTimeFormatOptions);
    const currentDayOfWeek = currentDate.toLocaleString(this.language, { weekday: 'long' }).toUpperCase();
    const currentDateFormatted = currentDate.toLocaleDateString(this.language, { month: 'long', day: 'numeric' });

    const mainDiv = this.shadowRoot?.querySelector('.main');
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
            <ha-icon icon="hass:gauge"></ha-icon> ${dPressure} ${this.unitPressure ? this.ll('units')[this.unitPressure] : ''} <br>
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
              ${this.renderSun({ sun, language } as unknown as this)}
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
            ${dWindSpeed} ${this.unitSpeed ? this.ll('units')[this.unitSpeed] : ''} <br>
          ` : ''}
          ${showWindgustspeed && wind_gust_speed !== undefined ? html`
            <ha-icon icon="hass:weather-windy-variant"></ha-icon>
            ${this._convertWindSpeed(parseFloat(wind_gust_speed))} ${this.unitSpeed ? this.ll('units')[this.unitSpeed] : ''}
          ` : ''}
        </div>
      ` : ''}
    </div>
`;
}

renderSun({ sun, language } = this) {
  if (sun == undefined) {
    return html``;
  }

const use12HourFormat = this.config.use_12hour_format;
const timeOptions = {
    hour12: use12HourFormat,
    hour: 'numeric',
    minute: 'numeric'
} as Intl.DateTimeFormatOptions;

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

        const condKey = condition as keyof typeof weatherIcons;
        if (config.animated_icons || config.icons) {
          const iconSrc = config.animated_icons ?
            `${this.baseIconPath}${weatherIcons[condKey]}.svg` :
            `${this.config.icons}${weatherIcons[condKey]}.svg`;
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

renderWind({ config, forecastItems } = this) {
  const showWindForecast = config.forecast.show_wind_forecast !== false;
  if (!showWindForecast) return html``;

  // Per-column wind direction arrow can be hidden via forecast.show_wind_arrow
  // (default true). When kept on but the column gets too narrow for arrow +
  // speed side-by-side, .wind-detail's flex-wrap drops the speed below the
  // arrow — see chart/styles.js.
  const showArrow = config.forecast.show_wind_arrow !== false;
  const forecast = this.forecasts ? this.forecasts.slice(0, forecastItems) : [];
  const unit = this.unitSpeed ? this.ll('units')[this.unitSpeed] : '';

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

_convertWindSpeed(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'number') return null;
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

  _fire(type: string, detail: unknown, options?: { bubbles?: boolean; cancelable?: boolean; composed?: boolean }) {
    const node = this.shadowRoot;
    const opts = options || {};
    const eventDetail = (detail === null || detail === undefined) ? {} : detail;
    const event = new Event(type, {
      bubbles: opts.bubbles === undefined ? true : opts.bubbles,
      cancelable: Boolean(opts.cancelable),
      composed: opts.composed === undefined ? true : opts.composed,
    });
    (event as Event & { detail?: unknown }).detail = eventDetail;
    node?.dispatchEvent(event);
    return event;
  }

  // Apply the "scroll to now" position once per render generation.
  // A generation changes when forecast.type or number_of_forecasts
  // change — outside those, we leave scrollLeft alone so the user's
  // manual scroll position survives data refreshes (which fire every
  // hour from MeasuredDataSource).
  _maybeApplyInitialScroll(changedProperties: Map<PropertyKey, unknown>) {
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
    if (changedProperties?.has('config') && this._lastScrollGeneration
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
