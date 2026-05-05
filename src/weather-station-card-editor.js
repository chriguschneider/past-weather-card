import { LitElement, html } from 'lit';
import locale from './locale.js';

// Per-metric sensor field list. Most filter by `device_class`; wind
// direction has no canonical class but a stable unit (degrees) so it
// gets a runtime predicate. UV index has neither a class nor a universal
// unit and gets a name/id pattern match.
//
// Each entry's `key` is the YAML key under `sensors:` and doubles as the
// i18n key (see locale.js `editor` blocks). The candidate list narrows
// the entity-picker dropdown to plausible matches; if no candidates were
// found we leave the picker unfiltered so a manual selection still works.
//
// Used by both buildSensorsSchema (drives ha-form) and the editor's
// custom rendering paths.
function buildSensorFields(hass) {
  const all = hass ? Object.entries(hass.states) : [];
  const byDeviceClass = (classes) => all
    .filter(([id, s]) => id.startsWith('sensor.') &&
      classes.includes(s.attributes && s.attributes.device_class))
    .map(([id]) => id);

  const directionEntities = all
    .filter(([id, s]) => id.startsWith('sensor.') &&
      (s.attributes.unit_of_measurement === '°' ||
       s.attributes.unit_of_measurement === 'deg'))
    .map(([id]) => id);

  const uvRegex = /(?:^|[._-])uv(?:[._-]|index|$)/i;
  const uvNameRegex = /\buv[\s_-]?index\b|\buv\b/i;
  const uvEntities = all
    .filter(([id, s]) => {
      if (!id.startsWith('sensor.')) return false;
      const name = (s.attributes && s.attributes.friendly_name) || '';
      return uvRegex.test(id) || uvNameRegex.test(name);
    })
    .map(([id]) => id);

  return [
    { key: 'temperature',    candidates: byDeviceClass(['temperature']) },
    { key: 'humidity',       candidates: byDeviceClass(['humidity']) },
    { key: 'illuminance',    candidates: byDeviceClass(['illuminance']) },
    { key: 'precipitation',  candidates: byDeviceClass(['precipitation']) },
    { key: 'pressure',       candidates: byDeviceClass(['atmospheric_pressure', 'pressure']) },
    { key: 'wind_speed',     candidates: byDeviceClass(['wind_speed', 'speed']) },
    { key: 'gust_speed',     candidates: byDeviceClass(['wind_speed', 'speed']) },
    { key: 'wind_direction', candidates: directionEntities },
    { key: 'uv_index',       candidates: uvEntities },
    { key: 'dew_point',      candidates: byDeviceClass(['temperature']) },
  ];
}

// ha-form schema derived from buildSensorFields. The selector forces
// the entity-picker to filter by our candidate list (fall back to all
// sensors when no candidates were found, so manual picks still work).
// Going through ha-form also ensures ha-entity-picker is registered —
// using <ha-entity-picker> standalone fails to render in some HA builds
// because the lazy-loaded element isn't pulled in until ha-selector
// requests it.
function buildSensorsSchema(hass) {
  return buildSensorFields(hass).map((f) => ({
    name: f.key,
    selector: {
      entity: f.candidates.length > 0
        ? { include_entities: f.candidates }
        : { domain: 'sensor' },
    },
  }));
}

// Resolve a localized editor string. Falls back along
// language → base-language → English → key.
function tEditor(hass, key) {
  const lang = (hass && hass.language) || 'en';
  const baseLang = lang.split('-')[0];
  for (const l of [lang, baseLang, 'en']) {
    const block = locale[l] && locale[l].editor;
    if (block && typeof block[key] === 'string') return block[key];
  }
  return key;
}

// condition_mapping override schema. Each row knows its unit (rendered as
// a suffix in the input label) so users don't need to consult the README
// to remember whether `windy_threshold` is m/s or km/h.
const CONDITION_MAPPING_FIELDS = [
  { key: 'rainy_threshold_mm',      unit: 'mm',  defaultValue: 0.5 },
  { key: 'pouring_threshold_mm',    unit: 'mm',  defaultValue: 10 },
  { key: 'exceptional_gust_ms',     unit: 'm/s', defaultValue: 24.5 },
  { key: 'exceptional_precip_mm',   unit: 'mm',  defaultValue: 50 },
  { key: 'snow_max_c',              unit: '°C',  defaultValue: 0 },
  { key: 'snow_rain_max_c',         unit: '°C',  defaultValue: 3 },
  { key: 'fog_humidity_pct',        unit: '%',   defaultValue: 95 },
  { key: 'fog_dewpoint_spread_c',   unit: '°C',  defaultValue: 1 },
  { key: 'fog_wind_max_ms',         unit: 'm/s', defaultValue: 3 },
  { key: 'windy_threshold_ms',      unit: 'm/s', defaultValue: 10.8 },
  { key: 'windy_mean_threshold_ms', unit: 'm/s', defaultValue: 8.0 },
  { key: 'sunny_cloud_ratio',       unit: 'ratio', defaultValue: 0.70 },
  { key: 'partly_cloud_ratio',      unit: 'ratio', defaultValue: 0.30 },
];

const LOCALE_OPTIONS = [
  ['',   'HA Default'],
  ['bg', 'Bulgarian'], ['ca', 'Catalan'], ['cs', 'Czech'], ['da', 'Danish'],
  ['nl', 'Dutch'],     ['en', 'English'], ['fi', 'Finnish'], ['fr', 'French'],
  ['de', 'German'],    ['el', 'Greek'],   ['hu', 'Hungarian'], ['it', 'Italian'],
  ['lt', 'Lithuanian'], ['no', 'Norwegian'], ['pl', 'Polish'], ['pt', 'Portuguese'],
  ['ro', 'Romanian'],  ['ru', 'Russian'], ['sk', 'Slovak'], ['es', 'Spanish'],
  ['sv', 'Swedish'],   ['uk', 'Ukrainian'], ['ko', '한국어'],
];

class WeatherStationCardEditor extends LitElement {
  static get properties() {
    return {
      _config: { type: Object },
      hass: { type: Object },
    };
  }

  setConfig(config) {
    if (!config) {
      throw new Error("Invalid configuration");
    }
    this._config = config;
    this.requestUpdate();
  }

  get config() {
    return this._config;
  }

  // ── Mode (UI-only abstraction over show_station / show_forecast) ──────
  // The YAML schema keeps the two booleans for backwards compatibility;
  // the editor projects them onto a single radio so users pick a mode
  // up-front instead of inferring it from two unrelated toggles.
  get _mode() {
    const wantStation = this._config.show_station !== false;
    const wantForecast = this._config.show_forecast === true;
    if (wantStation && wantForecast) return 'combination';
    if (wantForecast) return 'forecast';
    return 'station';
  }

  _setMode(value) {
    const newConfig = { ...this._config };
    switch (value) {
      case 'station':
        newConfig.show_station = true;
        newConfig.show_forecast = false;
        break;
      case 'forecast':
        newConfig.show_station = false;
        newConfig.show_forecast = true;
        break;
      case 'combination':
        newConfig.show_station = true;
        newConfig.show_forecast = true;
        break;
    }
    this.configChanged(newConfig);
    this.requestUpdate();
  }

  // ── Event plumbing ────────────────────────────────────────────────────
  configChanged(newConfig) {
    const event = new Event("config-changed", { bubbles: true, composed: true });
    event.detail = { config: newConfig };
    this.dispatchEvent(event);
  }

  _sensorsChanged(event) {
    if (!this._config) return;
    if (event.target.tagName.toLowerCase() !== 'ha-form') return;
    this.configChanged({ ...this._config, sensors: event.detail.value });
    this.requestUpdate();
  }

  // Per-picker handler used now that the sensors block uses explicit
  // ha-entity-picker elements (instead of one ha-form). Empty value
  // removes the key from the YAML so unset sensors don't appear as
  // empty strings.
  _sensorPickerChanged(key, value) {
    if (!this._config) return;
    const newSensors = { ...(this._config.sensors || {}) };
    if (value === '' || value === null || value === undefined) {
      delete newSensors[key];
    } else {
      newSensors[key] = value;
    }
    this.configChanged({ ...this._config, sensors: newSensors });
    this.requestUpdate();
  }

  _unitsChanged(event) {
    if (!this._config) return;
    if (event.target.tagName.toLowerCase() !== 'ha-form') return;
    this.configChanged({ ...this._config, units: event.detail.value });
    this.requestUpdate();
  }

  _valueChanged(event, key) {
    if (!this._config) return;

    const newConfig = { ...this._config };
    const newValue = event.target.checked !== undefined
      ? event.target.checked
      : event.target.value;

    if (key.includes('.')) {
      const parts = key.split('.');
      let level = newConfig;
      for (let i = 0; i < parts.length - 1; i++) {
        level[parts[i]] = { ...level[parts[i]] };
        level = level[parts[i]];
      }
      level[parts[parts.length - 1]] = newValue;
    } else {
      newConfig[key] = newValue;
    }
    this.configChanged(newConfig);
    this.requestUpdate();
  }

  // ha-selector with the ui_action selector returns either an action
  // config object or undefined (when the picker is reset). Persist the
  // value as-is so HA's standard handle-action helper can read it back
  // unchanged — same shape Bubble / Mushroom / built-in cards consume.
  _actionChanged(key, value) {
    if (!this._config) return;
    const newConfig = { ...this._config };
    if (value === undefined || value === null) {
      delete newConfig[key];
    } else {
      newConfig[key] = value;
    }
    this.configChanged(newConfig);
    this.requestUpdate();
  }

  // condition_mapping override editor: empty input = use default (key
  // removed from the YAML); any value coerces to a number.
  _conditionMappingChanged(event, key) {
    if (!this._config) return;
    const raw = event.target.value;
    const newMapping = { ...(this._config.condition_mapping || {}) };
    if (raw === '' || raw === null || raw === undefined) {
      delete newMapping[key];
    } else {
      const n = parseFloat(raw);
      if (Number.isFinite(n)) newMapping[key] = n;
    }
    const newConfig = { ...this._config };
    if (Object.keys(newMapping).length === 0) {
      delete newConfig.condition_mapping;
    } else {
      newConfig.condition_mapping = newMapping;
    }
    this.configChanged(newConfig);
    this.requestUpdate();
  }

  // ── Render ────────────────────────────────────────────────────────────
  render() {
    const t = (k) => tEditor(this.hass, k);
    const cfg = this._config;
    const fcfg = cfg.forecast || {};
    const sensorsConfig = cfg.sensors || {};
    const unitsConfig = cfg.units || {};
    const mode = this._mode;
    const isStation = mode === 'station';
    const isForecast = mode === 'forecast';
    const isCombo = mode === 'combination';
    const showsForecast = isForecast || isCombo;
    const showsStation = isStation || isCombo;
    const hasSensor = (key) => !!sensorsConfig[key];
    const cmap = cfg.condition_mapping || {};

    return html`
      <style>
        h3.section {
          font-size: 1rem;
          font-weight: 500;
          color: var(--primary-text-color);
          margin: 24px 0 12px;
          padding-bottom: 4px;
          border-bottom: 1px solid var(--divider-color);
        }
        h3.section:first-of-type { margin-top: 0; }
        h4.subsection {
          font-size: 0.9rem;
          font-weight: 500;
          color: var(--secondary-text-color);
          margin: 18px 0 8px;
        }
        details.advanced {
          margin-top: 8px;
          border: 1px solid var(--divider-color);
          border-radius: 4px;
          padding: 8px 12px;
        }
        details.advanced > summary {
          cursor: pointer;
          color: var(--primary-text-color);
          font-weight: 500;
        }
        details.advanced[open] > summary {
          margin-bottom: 12px;
        }
        .switch-label { padding-left: 14px; }
        .switch-container { margin-bottom: 12px; display: flex; align-items: center; }
        .textfield-container {
          display: flex; flex-direction: column; margin-bottom: 10px; gap: 16px;
        }
        .flex-container { display: flex; flex-direction: row; gap: 20px; }
        .flex-container ha-textfield { flex-basis: 50%; flex-grow: 1; }
        .radio-group { display: flex; gap: 16px; align-items: center; margin-bottom: 12px; }
        .radio-item { display: flex; align-items: center; }
        .radio-item label { margin-left: 4px; }
        .hint {
          font-size: 0.85rem;
          color: var(--secondary-text-color);
          margin: 4px 0 12px;
        }
        .cmap-row {
          display: grid;
          grid-template-columns: 1fr 80px 60px;
          gap: 8px;
          align-items: center;
          margin-bottom: 6px;
        }
        .cmap-default {
          font-size: 0.8rem;
          color: var(--secondary-text-color);
        }
        .cmap-unit {
          font-size: 0.85rem;
          color: var(--secondary-text-color);
        }
      </style>

      <div>

        <!-- ─── A. Setup ─────────────────────────────────────────────── -->
        <h3 class="section">${t('setup_heading')}</h3>
        <div class="textfield-container">
          <ha-textfield
            label="${t('title')}"
            .value="${cfg.title || ''}"
            @change="${(e) => this._valueChanged(e, 'title')}"
          ></ha-textfield>

          <div class="radio-group">
            <span style="margin-right:8px;font-weight:500;">${t('mode_label')}:</span>
            ${[
              ['station', 'mode_station'],
              ['forecast', 'mode_forecast'],
              ['combination', 'mode_combination'],
            ].map(([value, key]) => html`
              <div class="radio-item">
                <ha-radio
                  name="ws-mode"
                  .value=${value}
                  .checked=${mode === value}
                  @change=${() => this._setMode(value)}
                ></ha-radio>
                <label>${t(key)}</label>
              </div>
            `)}
          </div>

          <div class="flex-container">
            ${showsStation ? html`
              <ha-textfield
                label="${t('days')}"
                type="number" min="1" max="14"
                .value="${cfg.days || 7}"
                @change="${(e) => this._valueChanged(e, 'days')}"
              ></ha-textfield>
            ` : ''}
            ${showsForecast ? html`
              <ha-textfield
                label="${t('forecast_days')}"
                type="number" min="1" max="14"
                .value="${cfg.forecast_days != null ? cfg.forecast_days : (cfg.days || 7)}"
                @change="${(e) => this._valueChanged(e, 'forecast_days')}"
              ></ha-textfield>
            ` : ''}
          </div>
          ${showsForecast ? html`
            <ha-entity-picker
              .hass=${this.hass}
              .value=${cfg.weather_entity || ''}
              .includeDomains=${['weather']}
              label="${t('weather_entity')}"
              allow-custom-entity
              @value-changed=${(e) => this._valueChanged({ target: { value: e.detail.value } }, 'weather_entity')}
            ></ha-entity-picker>
          ` : ''}
          <!-- forecast.type drives both the forecast subscription and the
               station aggregation period (daily → period:'day', hourly →
               period:'hour'), so the radio belongs outside the showsForecast
               gate — it's relevant in any non-empty mode. -->
          <div class="radio-group">
            <span style="margin-right:8px;font-weight:500;">${t('forecast_type_label')}:</span>
            ${[
              ['daily', 'forecast_type_daily'],
              ['hourly', 'forecast_type_hourly'],
            ].map(([value, key]) => html`
              <div class="radio-item">
                <ha-radio
                  name="ws-forecast-type"
                  .value=${value}
                  .checked=${(fcfg.type || 'daily') === value}
                  @change=${() => this._valueChanged({ target: { value } }, 'forecast.type')}
                ></ha-radio>
                <label>${t(key)}</label>
              </div>
            `)}
          </div>
          <ha-textfield
            label="${t('number_of_forecasts')}"
            type="number" min="0"
            .value="${fcfg.number_of_forecasts != null ? fcfg.number_of_forecasts : ''}"
            @change="${(e) => this._valueChanged(e, 'forecast.number_of_forecasts')}"
          ></ha-textfield>
          <p class="hint">${t('number_of_forecasts_hint')}</p>
        </div>

        <h4 class="subsection">${t('actions_heading')}</h4>
        <div class="textfield-container">
          ${[
            ['tap_action', 'tap_action_label'],
            ['hold_action', 'hold_action_label'],
            ['double_tap_action', 'double_tap_action_label'],
          ].map(([key, labelKey]) => html`
            <ha-selector
              .hass=${this.hass}
              .selector=${{ ui_action: {} }}
              .value=${cfg[key]}
              .label=${t(labelKey)}
              @value-changed=${(e) => this._actionChanged(key, e.detail.value)}
            ></ha-selector>
          `)}
        </div>

        <!-- ─── B. Sensors ──────────────────────────────────────────── -->
        <!-- No heading: ha-form renders each picker with its label as a
             Material floating label inside the field, so the section is
             self-explanatory. We keep ha-form (vs. explicit pickers) so
             ha-entity-picker is registered through the selector pipeline
             — direct use renders blank in some HA builds. -->
        <div class="textfield-container" style="margin-top:24px;">
          <ha-form
            .data=${sensorsConfig}
            .schema=${buildSensorsSchema(this.hass)}
            .hass=${this.hass}
            .computeLabel=${(s) => t(s.name)}
            @value-changed=${this._sensorsChanged}
          ></ha-form>
        </div>

        <!-- ─── C. Layout ───────────────────────────────────────────── -->
        <h3 class="section">${t('layout_heading')}</h3>

        <h4 class="subsection">${t('main_panel_heading')}</h4>
        <div class="switch-container">
          <ha-switch
            @change="${(e) => this._valueChanged(e, 'show_main')}"
            .checked="${cfg.show_main === true}"
          ></ha-switch>
          <label class="switch-label">${t('show_main')}</label>
        </div>
        ${cfg.show_main === true ? html`
          <div class="switch-container">
            <ha-switch
              @change="${(e) => this._valueChanged(e, 'show_temperature')}"
              .checked="${cfg.show_temperature !== false}"
            ></ha-switch>
            <label class="switch-label">${t('show_temperature')}</label>
          </div>
          <div class="switch-container">
            <ha-switch
              @change="${(e) => this._valueChanged(e, 'show_current_condition')}"
              .checked="${cfg.show_current_condition !== false}"
            ></ha-switch>
            <label class="switch-label">${t('show_current_condition')}</label>
          </div>
          <div class="switch-container">
            <ha-switch
              @change="${(e) => this._valueChanged(e, 'show_time')}"
              .checked="${cfg.show_time === true}"
            ></ha-switch>
            <label class="switch-label">${t('show_time')}</label>
          </div>
          ${cfg.show_time === true ? html`
            <div class="switch-container" style="padding-left:20px;">
              <ha-switch
                @change="${(e) => this._valueChanged(e, 'show_time_seconds')}"
                .checked="${cfg.show_time_seconds === true}"
              ></ha-switch>
              <label class="switch-label">${t('show_time_seconds')}</label>
            </div>
            <div class="switch-container" style="padding-left:20px;">
              <ha-switch
                @change="${(e) => this._valueChanged(e, 'use_12hour_format')}"
                .checked="${cfg.use_12hour_format === true}"
              ></ha-switch>
              <label class="switch-label">${t('use_12hour_format')}</label>
            </div>
          ` : ''}
          <div class="switch-container">
            <ha-switch
              @change="${(e) => this._valueChanged(e, 'show_day')}"
              .checked="${cfg.show_day === true}"
            ></ha-switch>
            <label class="switch-label">${t('show_day')}</label>
          </div>
          <div class="switch-container">
            <ha-switch
              @change="${(e) => this._valueChanged(e, 'show_date')}"
              .checked="${cfg.show_date === true}"
            ></ha-switch>
            <label class="switch-label">${t('show_date')}</label>
          </div>
        ` : ''}

        <h4 class="subsection">${t('attributes_heading')}</h4>
        <div class="switch-container">
          <ha-switch
            @change="${(e) => this._valueChanged(e, 'show_attributes')}"
            .checked="${cfg.show_attributes === true}"
          ></ha-switch>
          <label class="switch-label">${t('show_attributes')}</label>
        </div>
        ${cfg.show_attributes === true ? html`
          ${hasSensor('humidity') ? html`
            <div class="switch-container">
              <ha-switch
                @change="${(e) => this._valueChanged(e, 'show_humidity')}"
                .checked="${cfg.show_humidity !== false}"
              ></ha-switch>
              <label class="switch-label">${t('show_humidity')}</label>
            </div>
          ` : ''}
          ${hasSensor('pressure') ? html`
            <div class="switch-container">
              <ha-switch
                @change="${(e) => this._valueChanged(e, 'show_pressure')}"
                .checked="${cfg.show_pressure !== false}"
              ></ha-switch>
              <label class="switch-label">${t('show_pressure')}</label>
            </div>
          ` : ''}
          ${hasSensor('dew_point') ? html`
            <div class="switch-container">
              <ha-switch
                @change="${(e) => this._valueChanged(e, 'show_dew_point')}"
                .checked="${cfg.show_dew_point === true}"
              ></ha-switch>
              <label class="switch-label">${t('show_dew_point')}</label>
            </div>
          ` : ''}
          ${hasSensor('wind_direction') ? html`
            <div class="switch-container">
              <ha-switch
                @change="${(e) => this._valueChanged(e, 'show_wind_direction')}"
                .checked="${cfg.show_wind_direction !== false}"
              ></ha-switch>
              <label class="switch-label">${t('show_wind_direction')}</label>
            </div>
          ` : ''}
          ${hasSensor('wind_speed') ? html`
            <div class="switch-container">
              <ha-switch
                @change="${(e) => this._valueChanged(e, 'show_wind_speed')}"
                .checked="${cfg.show_wind_speed !== false}"
              ></ha-switch>
              <label class="switch-label">${t('show_wind_speed')}</label>
            </div>
          ` : ''}
          ${hasSensor('gust_speed') ? html`
            <div class="switch-container">
              <ha-switch
                @change="${(e) => this._valueChanged(e, 'show_wind_gust_speed')}"
                .checked="${cfg.show_wind_gust_speed === true}"
              ></ha-switch>
              <label class="switch-label">${t('show_wind_gust_speed')}</label>
            </div>
          ` : ''}
          <div class="switch-container">
            <ha-switch
              @change="${(e) => this._valueChanged(e, 'show_sun')}"
              .checked="${cfg.show_sun === true}"
            ></ha-switch>
            <label class="switch-label">${t('show_sun')}</label>
          </div>
        ` : ''}

        <h4 class="subsection">${t('chart_rows_heading')}</h4>
        <div class="switch-container">
          <ha-switch
            @change="${(e) => this._valueChanged(e, 'forecast.condition_icons')}"
            .checked="${fcfg.condition_icons !== false}"
          ></ha-switch>
          <label class="switch-label">${t('show_chart_icons')}</label>
        </div>
        <div class="switch-container">
          <ha-switch
            @change="${(e) => this._valueChanged(e, 'forecast.show_wind_forecast')}"
            .checked="${fcfg.show_wind_forecast !== false}"
          ></ha-switch>
          <label class="switch-label">${t('show_chart_wind')}</label>
        </div>
        ${fcfg.show_wind_forecast !== false ? html`
          <div class="switch-container" style="padding-left:20px;">
            <ha-switch
              @change="${(e) => this._valueChanged(e, 'forecast.show_wind_arrow')}"
              .checked="${fcfg.show_wind_arrow !== false}"
            ></ha-switch>
            <label class="switch-label">${t('show_chart_wind_arrow')}</label>
          </div>
        ` : ''}
        <div class="switch-container">
          <ha-switch
            @change="${(e) => this._valueChanged(e, 'forecast.show_date')}"
            .checked="${fcfg.show_date !== false}"
          ></ha-switch>
          <label class="switch-label">${t('show_chart_date')}</label>
        </div>

        <!-- ─── D. Style & Colours ──────────────────────────────────── -->
        <h3 class="section">${t('style_heading')}</h3>

        <h4 class="subsection">${t('chart_appearance_heading')}</h4>
        <div class="textfield-container">
          <div class="radio-group">
            <span style="margin-right:8px;font-weight:500;">${t('chart_style')}:</span>
            <div class="radio-item">
              <ha-radio
                name="ws-chart-style"
                .value=${'style2'}
                .checked=${(fcfg.style || 'style2') === 'style2'}
                @change=${() => this._valueChanged({ target: { value: 'style2' } }, 'forecast.style')}
              ></ha-radio>
              <label>${t('chart_style_without_boxes')}</label>
            </div>
            <div class="radio-item">
              <ha-radio
                name="ws-chart-style"
                .value=${'style1'}
                .checked=${fcfg.style === 'style1'}
                @change=${() => this._valueChanged({ target: { value: 'style1' } }, 'forecast.style')}
              ></ha-radio>
              <label>${t('chart_style_with_boxes')}</label>
            </div>
          </div>
          <!--
            forecast.precipitation_type ('rainfall' / 'probability') and
            forecast.show_probability are deliberately NOT rendered here
            while issue #4 is open. Station data has no probability, so
            the Probability mode produces empty bars for past columns and
            show_probability has nothing to overlay there. YAML still
            parses; restore once probability is wired correctly.
          -->
          <div class="switch-container">
            <ha-switch
              @change="${(e) => this._valueChanged(e, 'forecast.round_temp')}"
              .checked="${fcfg.round_temp === true}"
            ></ha-switch>
            <label class="switch-label">${t('round_temp')}</label>
          </div>
          <div class="switch-container">
            <ha-switch
              @change="${(e) => this._valueChanged(e, 'forecast.disable_animation')}"
              .checked="${fcfg.disable_animation === true}"
            ></ha-switch>
            <label class="switch-label">${t('disable_animation')}</label>
          </div>
        </div>

        <h4 class="subsection">${t('sizing_heading')}</h4>
        <div class="textfield-container">
          <div class="flex-container">
            <ha-textfield
              label="${t('icon_size')}" type="number"
              .value="${cfg.icons_size || '25'}"
              @change="${(e) => this._valueChanged(e, 'icons_size')}"
            ></ha-textfield>
            <ha-textfield
              label="${t('current_temp_size')}" type="number"
              .value="${cfg.current_temp_size || '28'}"
              @change="${(e) => this._valueChanged(e, 'current_temp_size')}"
            ></ha-textfield>
          </div>
          <div class="flex-container">
            <ha-textfield
              label="${t('time_size')}" type="number"
              .value="${cfg.time_size || '26'}"
              @change="${(e) => this._valueChanged(e, 'time_size')}"
            ></ha-textfield>
            <ha-textfield
              label="${t('day_date_size')}" type="number"
              .value="${cfg.day_date_size || '15'}"
              @change="${(e) => this._valueChanged(e, 'day_date_size')}"
            ></ha-textfield>
          </div>
          <div class="flex-container">
            <ha-textfield
              label="${t('labels_font_size')}" type="number"
              .value="${fcfg.labels_font_size || '11'}"
              @change="${(e) => this._valueChanged(e, 'forecast.labels_font_size')}"
            ></ha-textfield>
            <ha-textfield
              label="${t('chart_height')}" type="number"
              .value="${fcfg.chart_height || '180'}"
              @change="${(e) => this._valueChanged(e, 'forecast.chart_height')}"
            ></ha-textfield>
          </div>
          <ha-textfield
            label="${t('precip_bar_size')}" type="number" min="0" max="100"
            .value="${fcfg.precip_bar_size || '100'}"
            @change="${(e) => this._valueChanged(e, 'forecast.precip_bar_size')}"
          ></ha-textfield>
        </div>

        <h4 class="subsection">${t('icons_heading')}</h4>
        <div class="textfield-container">
          <div class="radio-group">
            <span style="margin-right:8px;font-weight:500;">${t('icon_style')}:</span>
            <div class="radio-item">
              <ha-radio
                name="ws-icon-style"
                .value=${'style1'}
                .checked=${(cfg.icon_style || 'style1') === 'style1'}
                @change=${() => this._valueChanged({ target: { value: 'style1' } }, 'icon_style')}
              ></ha-radio>
              <label>Style 1</label>
            </div>
            <div class="radio-item">
              <ha-radio
                name="ws-icon-style"
                .value=${'style2'}
                .checked=${cfg.icon_style === 'style2'}
                @change=${() => this._valueChanged({ target: { value: 'style2' } }, 'icon_style')}
              ></ha-radio>
              <label>Style 2</label>
            </div>
          </div>
          <div class="switch-container">
            <ha-switch
              @change="${(e) => this._valueChanged(e, 'animated_icons')}"
              .checked="${cfg.animated_icons === true}"
            ></ha-switch>
            <label class="switch-label">${t('animated_icons')}</label>
          </div>
          <ha-textfield
            label="${t('custom_icons_url')}"
            .value="${cfg.icons || ''}"
            @change="${(e) => this._valueChanged(e, 'icons')}"
          ></ha-textfield>
        </div>

        <details class="advanced">
          <summary>${t('colours_heading')}</summary>
          <div class="textfield-container" style="margin-top:12px;">
            <ha-textfield
              label="${t('temperature1_color')}"
              .value="${fcfg.temperature1_color || ''}"
              placeholder="rgba(255, 152, 0, 1.0)"
              @change="${(e) => this._valueChanged(e, 'forecast.temperature1_color')}"
            ></ha-textfield>
            <ha-textfield
              label="${t('temperature2_color')}"
              .value="${fcfg.temperature2_color || ''}"
              placeholder="rgba(68, 115, 158, 1.0)"
              @change="${(e) => this._valueChanged(e, 'forecast.temperature2_color')}"
            ></ha-textfield>
            <ha-textfield
              label="${t('precipitation_color')}"
              .value="${fcfg.precipitation_color || ''}"
              placeholder="rgba(132, 209, 253, 1.0)"
              @change="${(e) => this._valueChanged(e, 'forecast.precipitation_color')}"
            ></ha-textfield>
            <ha-textfield
              label="${t('chart_text_color')}"
              .value="${fcfg.chart_text_color || ''}"
              placeholder="auto"
              @change="${(e) => this._valueChanged(e, 'forecast.chart_text_color')}"
            ></ha-textfield>
            <ha-textfield
              label="${t('chart_datetime_color')}"
              .value="${fcfg.chart_datetime_color || ''}"
              placeholder="auto"
              @change="${(e) => this._valueChanged(e, 'forecast.chart_datetime_color')}"
            ></ha-textfield>
          </div>
        </details>

        <!-- ─── E. Units ────────────────────────────────────────────── -->
        <h3 class="section">${t('units_heading')}</h3>
        <div class="textfield-container">
          <ha-form
            .data=${unitsConfig}
            .schema=${UNITS_SCHEMA}
            .hass=${this.hass}
            .computeLabel=${(s) => UNIT_LABELS[s.name] || s.name}
            @value-changed=${this._unitsChanged}
          ></ha-form>
        </div>

        <!-- ─── F. Advanced ─────────────────────────────────────────── -->
        <!--
          autoscroll, forecast.precipitation_type and forecast.show_probability
          are deliberately NOT rendered here while issues #3 / #4 are open.
          The YAML keys still parse (values flow through); we just stop
          advertising broken or vestigial features.
          forecast.type and forecast.number_of_forecasts are wired again as
          of v0.8 — both sit in the Setup block above next to weather_entity.
        -->
        <h3 class="section">${t('advanced_heading')}</h3>
        <div class="textfield-container">
          <ha-select
            naturalMenuWidth fixedMenuPosition
            label="${t('locale')}"
            .value=${cfg.locale || ''}
            @change=${(e) => this._valueChanged(e, 'locale')}
            @closed=${(ev) => ev.stopPropagation()}
          >
            ${LOCALE_OPTIONS.map(([value, label]) => html`
              <ha-list-item .value=${value}>${label}</ha-list-item>
            `)}
          </ha-select>
        </div>

        <details class="advanced">
          <summary>${t('condition_mapping_heading')}</summary>
          <p class="hint">${t('condition_mapping_hint')}</p>
          ${CONDITION_MAPPING_FIELDS.map((field) => html`
            <div class="cmap-row">
              <span>${field.key}</span>
              <ha-textfield
                type="number" step="any"
                .value="${cmap[field.key] != null ? String(cmap[field.key]) : ''}"
                placeholder="${field.defaultValue}"
                @change="${(e) => this._conditionMappingChanged(e, field.key)}"
              ></ha-textfield>
              <span class="cmap-unit">${field.unit}</span>
            </div>
          `)}
        </details>

      </div>
    `;
  }
}

const UNITS_SCHEMA = [
  { name: "pressure",
    selector: { select: { mode: "dropdown", options: ["hPa", "mmHg", "inHg"] } } },
  { name: "speed",
    selector: { select: { mode: "dropdown", options: ["km/h", "m/s", "mph", "Bft"] } } },
];

const UNIT_LABELS = {
  pressure: "Convert pressure to",
  speed: "Convert wind speed to",
};

customElements.define("weather-station-card-editor", WeatherStationCardEditor);
