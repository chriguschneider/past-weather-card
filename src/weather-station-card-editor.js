import { LitElement, html } from 'lit';
import locale from './locale.js';
import { readCachedAvailability } from './openmeteo-source.js';
import { renderSetupSection } from './editor/render-setup.js';
import { renderSensorsSection } from './editor/render-sensors.js';
import { renderLayoutSection } from './editor/render-layout.js';
import { renderStyleSection } from './editor/render-style.js';
import { renderUnitsSection } from './editor/render-units.js';
import { renderAdvancedSection } from './editor/render-advanced.js';

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

  // Render an inline hint under the forecast_days field showing what
  // Open-Meteo currently has cached for this location — and a warning
  // when the configured forecast_days exceeds what's actually
  // available. Only relevant when the sunshine row is enabled (no other
  // editor field depends on this cache).
  _renderSunshineAvailabilityHint(cfg, t) {
    if (!cfg || !cfg.forecast || cfg.forecast.show_sunshine !== true) return '';
    const hass = this.hass;
    const lat = hass && hass.config ? hass.config.latitude : null;
    const lon = hass && hass.config ? hass.config.longitude : null;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return '';

    const av = readCachedAvailability(lat, lon);
    if (!av) {
      // Cache empty — fetch hasn't completed yet (or localStorage is
      // disabled). Don't show stale or misleading numbers.
      return html`<div class="hint" style="margin-top:4px;">
        ${t('sunshine_availability_pending')}
      </div>`;
    }

    const requested = parseInt(cfg.forecast_days != null ? cfg.forecast_days : (cfg.days || 7), 10);
    const overshoots = Number.isFinite(requested) && av.forecastDays > 0 && requested > av.forecastDays;
    const baseLine = (t('sunshine_availability') || 'Sunshine: {past} past, {future} forecast days available')
      .replace('{past}', String(av.pastDays))
      .replace('{future}', String(av.forecastDays));

    return html`
      <div class="hint" style="margin-top:4px; ${overshoots ? 'color: var(--warning-color);' : ''}">
        ${baseLine}
        ${overshoots ? html`<br/>${(t('sunshine_availability_warning') || 'Configured forecast_days ({req}) exceeds available — last {gap} columns will have empty sunshine bars.')
          .replace('{req}', String(requested))
          .replace('{gap}', String(requested - av.forecastDays))}` : ''}
      </div>
    `;
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
  // Thin orchestrator. Each section A–F lives in its own partial under
  // src/editor/. The styles below are global to the whole editor surface
  // (every partial expects to find them in scope) — keeping them here
  // means the partials don't carry their own scoped CSS, which would
  // duplicate the same .switch-container / .flex-container / .radio-group
  // rules across files.
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

    const ctx = {
      t, cfg, fcfg, sensorsConfig, unitsConfig, cmap,
      mode, showsStation, showsForecast,
      hasSensor,
    };

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
        ${renderSetupSection(this, ctx)}
        ${renderSensorsSection(this, ctx)}
        ${renderLayoutSection(this, ctx)}
        ${renderStyleSection(this, ctx)}
        ${renderUnitsSection(this, ctx)}
        ${renderAdvancedSection(this, ctx)}
      </div>
    `;
  }
}

customElements.define("weather-station-card-editor", WeatherStationCardEditor);
