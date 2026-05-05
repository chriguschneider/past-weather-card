import { LitElement, html } from 'lit';
import locale from './locale.js';

// Per-metric sensor pickers. Most filter by `device_class`; wind direction
// has no canonical class but a stable unit (degrees) so it gets a runtime
// include-list keyed off `hass.states`. UV index has neither a class nor a
// universal unit and stays unfiltered.
//
// `name` doubles as the i18n key — see locale.js `editor` blocks. The
// English `label` here is the runtime fallback when the user's HA
// language has no translation registered.
function buildSensorsSchema(hass) {
  const directionEntities = hass
    ? Object.entries(hass.states)
        .filter(([id, s]) =>
          id.startsWith('sensor.') &&
          (s.attributes.unit_of_measurement === '°' ||
           s.attributes.unit_of_measurement === 'deg'))
        .map(([id]) => id)
    : [];

  // UV: no canonical device_class and no universal unit. Match either
  // 'uv' as a separator-bounded token (uv_index, uvindex, foo_uv) or a
  // friendly_name containing 'uv index' / 'uv-index'.
  const uvRegex = /(?:^|[._-])uv(?:[._-]|index|$)/i;
  const uvNameRegex = /\buv[\s_-]?index\b|\buv\b/i;
  const uvEntities = hass
    ? Object.entries(hass.states)
        .filter(([id, s]) => {
          if (!id.startsWith('sensor.')) return false;
          const name = (s.attributes && s.attributes.friendly_name) || '';
          return uvRegex.test(id) || uvNameRegex.test(name);
        })
        .map(([id]) => id)
    : [];

  return [
    { name: "temperature",    label: "Temperature",
      selector: { entity: { domain: 'sensor', device_class: 'temperature' } } },
    { name: "humidity",       label: "Humidity",
      selector: { entity: { domain: 'sensor', device_class: 'humidity' } } },
    { name: "illuminance",    label: "Illuminance",
      selector: { entity: { domain: 'sensor', device_class: 'illuminance' } } },
    { name: "precipitation",  label: "Precipitation",
      selector: { entity: { domain: 'sensor', device_class: 'precipitation' } } },
    { name: "pressure",       label: "Pressure",
      selector: { entity: { domain: 'sensor', device_class: ['atmospheric_pressure', 'pressure'] } } },
    { name: "wind_speed",     label: "Wind speed",
      selector: { entity: { domain: 'sensor', device_class: ['wind_speed', 'speed'] } } },
    { name: "gust_speed",     label: "Gust speed",
      selector: { entity: { domain: 'sensor', device_class: ['wind_speed', 'speed'] } } },
    { name: "wind_direction", label: "Wind direction",
      selector: { entity: { include_entities: directionEntities } } },
    { name: "uv_index",       label: "UV index",
      selector: { entity: { include_entities: uvEntities } } },
    { name: "dew_point",      label: "Dew point",
      selector: { entity: { domain: 'sensor', device_class: 'temperature' } } },
  ];
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

class WeatherStationCardEditor extends LitElement {
  static get properties() {
    return {
      _config: { type: Object },
      hass: { type: Object },
    };
  }

  constructor() {
    super();
    this._formValueChanged = this._formValueChanged.bind(this);
  }

  setConfig(config) {
    if (!config) {
      throw new Error("Invalid configuration");
    }
    this._config = config;
    const sensors = config.sensors || {};
    // Surface toggles only make sense if the corresponding sensor is configured.
    this.hasDewpoint = !!sensors.dew_point;
    this.hasWindgustspeed = !!sensors.gust_speed;
    this.requestUpdate();
  }

  get config() {
    return this._config;
  }

  updated(changedProperties) {
    // No weather-entity dependency to watch for in this fork.
  }

  _sensorsChanged(event) {
    if (!this._config) return;
    if (event.target.tagName.toLowerCase() !== 'ha-form') return;
    const newConfig = { ...this._config, sensors: event.detail.value };
    this.configChanged(newConfig);
    this.requestUpdate();
  }

  _unitsChanged(event) {
    if (!this._config) return;
    if (event.target.tagName.toLowerCase() !== 'ha-form') return;
    const newConfig = { ...this._config, units: event.detail.value };
    this.configChanged(newConfig);
    this.requestUpdate();
  }

  configChanged(newConfig) {
    const event = new Event("config-changed", {
      bubbles: true,
      composed: true,
    });
    event.detail = { config: newConfig };
    this.dispatchEvent(event);
  }

  _valueChanged(event, key) {
    if (!this._config) {
      return;
    }

    let newConfig = { ...this._config };

    if (key.includes('.')) {
      const parts = key.split('.');
      let currentLevel = newConfig;

      for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i];

        currentLevel[part] = { ...currentLevel[part] };

        currentLevel = currentLevel[part];
      }

      const finalKey = parts[parts.length - 1];
      if (event.target.checked !== undefined) {
        currentLevel[finalKey] = event.target.checked;
      } else {
        currentLevel[finalKey] = event.target.value;
      }
    } else {
      if (event.target.checked !== undefined) {
        newConfig[key] = event.target.checked;
      } else {
        newConfig[key] = event.target.value;
      }
    }

    this.configChanged(newConfig);
    this.requestUpdate();
  }

  _handleStyleChange(event) {
    if (!this._config) {
      return;
    }
    const newConfig = JSON.parse(JSON.stringify(this._config));
    newConfig.forecast.style = event.target.value;
    this.configChanged(newConfig);
    this.requestUpdate();
  }

  _handleTypeChange(event) {
    if (!this._config) {
      return;
    }
    const newConfig = JSON.parse(JSON.stringify(this._config));
    newConfig.forecast.type = event.target.value;
    this.configChanged(newConfig);
    this.requestUpdate();
  }

  _handleIconStyleChange(event) {
    if (!this._config) {
      return;
    }
    const newConfig = JSON.parse(JSON.stringify(this._config));
    newConfig.icon_style = event.target.value;
    this.configChanged(newConfig);
    this.requestUpdate();
  }

  _handlePrecipitationTypeChange(e) {
    const newValue = e.target.value;
    this.config.forecast.precipitation_type = newValue;
  }

  _formValueChanged(event) {
    if (event.target.tagName.toLowerCase() === 'ha-form') {
      const newConfig = event.detail.value;
      this.configChanged(newConfig);
      this.requestUpdate();
    }
  }

  render() {
    const forecastConfig = this._config.forecast || {};
    const unitsConfig = this._config.units || {};
    const sensorsConfig = this._config.sensors || {};
    const isShowTimeOn = this._config.show_time !== false;


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
        h3.section:first-of-type {
          margin-top: 0;
        }
        .switch-label {
          padding-left: 14px;
        }
        .switch-container {
          margin-bottom: 12px;
        }
        .time-container {
          display: flex;
          flex-direction: row;
          margin-bottom: 12px;
        }
        .icon-container {
          display: flex;
          flex-direction: row;
          margin-bottom: 12px;
        }
        .switch-right {
          display: flex;
          flex-direction: row;
          align-items: center;
        }
        .checkbox-container {
          display: flex;
          align-items: center;
          gap: 5px;
        }
        .textfield-container {
          display: flex;
          flex-direction: column;
          margin-bottom: 10px;
          gap: 20px;
        }
        .radio-container {
          display: flex;
          align-items: center;
          gap: 5px;
        }
        .radio-group {
          display: flex;
          align-items: center;
        }
        .radio-group label {
          margin-left: 4px;
        }
        .flex-container {
          display: flex;
          flex-direction: row;
          gap: 20px;
        }
        .flex-container ha-textfield {
          flex-basis: 50%;
          flex-grow: 1;
        }
      </style>
      <div>

        <h3 class="section">${tEditor(this.hass, 'sensors_heading')}</h3>
        <div class="textfield-container">
          <ha-form
            .data=${sensorsConfig}
            .schema=${buildSensorsSchema(this.hass)}
            .hass=${this.hass}
            .computeLabel=${(s) => tEditor(this.hass, s.name)}
            @value-changed=${this._sensorsChanged}
          ></ha-form>
        </div>

        <h3 class="section">${tEditor(this.hass, 'card_heading')}</h3>
        <div class="textfield-container">
          <ha-textfield
            label="${tEditor(this.hass, 'title')}"
            .value="${this._config.title || ''}"
            @change="${(e) => this._valueChanged(e, 'title')}"
          ></ha-textfield>
          <ha-textfield
            label="${tEditor(this.hass, 'days')}"
            type="number"
            min="1"
            max="14"
            .value="${this._config.days || 7}"
            @change="${(e) => this._valueChanged(e, 'days')}"
          ></ha-textfield>
        </div>

        <h3 class="section">Forecast block</h3>
        <div>
          <div class="switch-container">
            <ha-switch
              @change="${(e) => this._valueChanged(e, 'show_station')}"
              .checked="${this._config.show_station !== false}"
            ></ha-switch>
            <label class="switch-label">
              Show station history (left block)
            </label>
          </div>
          <div class="switch-container">
            <ha-switch
              @change="${(e) => this._valueChanged(e, 'show_forecast')}"
              .checked="${this._config.show_forecast === true}"
            ></ha-switch>
            <label class="switch-label">
              Show forecast (right block)
            </label>
          </div>
          <div class="textfield-container">
            <ha-entity-picker
              .hass=${this.hass}
              .value=${this._config.weather_entity || ''}
              .includeDomains=${['weather']}
              label="Weather entity (forecast)"
              allow-custom-entity
              @value-changed=${(e) => this._valueChanged({ target: { value: e.detail.value } }, 'weather_entity')}
            ></ha-entity-picker>
            <ha-textfield
              label="Forecast days"
              type="number"
              min="1"
              max="14"
              .value="${this._config.forecast_days != null ? this._config.forecast_days : (this._config.days || 7)}"
              @change="${(e) => this._valueChanged(e, 'forecast_days')}"
            ></ha-textfield>
          </div>
        </div>

        <h3 class="section">${tEditor(this.hass, 'display_heading')}</h3>
        <div>
          <div class="switch-container">
            <ha-switch
              @change="${(e) => this._valueChanged(e, 'show_main')}"
              .checked="${this._config.show_main !== false}"
            ></ha-switch>
            <label class="switch-label">
              Show Main
            </label>
          </div>
          <div class="switch-container">
            <ha-switch
              @change="${(e) => this._valueChanged(e, 'show_temperature')}"
              .checked="${this._config.show_temperature !== false}"
            ></ha-switch>
            <label class="switch-label">
              Show Current Temperature
            </label>
          </div>
          <div class="switch-container">
            <ha-switch
              @change="${(e) => this._valueChanged(e, 'show_current_condition')}"
              .checked="${this._config.show_current_condition !== false}"
            ></ha-switch>
            <label class="switch-label">
              Show Current Weather Condition
            </label>
          </div>
          <div class="switch-container">
            <ha-switch
              @change="${(e) => this._valueChanged(e, 'show_attributes')}"
              .checked="${this._config.show_attributes !== false}"
            ></ha-switch>
            <label class="switch-label">
              Show Attributes
            </label>
          </div>
          <div class="switch-container">
            <ha-switch
              @change="${(e) => this._valueChanged(e, 'show_humidity')}"
              .checked="${this._config.show_humidity !== false}"
            ></ha-switch>
            <label class="switch-label">
              Show Humidity
            </label>
          </div>
          <div class="switch-container">
            <ha-switch
              @change="${(e) => this._valueChanged(e, 'show_pressure')}"
              .checked="${this._config.show_pressure !== false}"
            ></ha-switch>
            <label class="switch-label">
              Show Pressure
            </label>
          </div>
          <div class="switch-container">
            <ha-switch
              @change="${(e) => this._valueChanged(e, 'show_sun')}"
              .checked="${this._config.show_sun !== false}"
            ></ha-switch>
            <label class="switch-label">
              Show Sun
            </label>
          </div>
          <div class="switch-container">
            <ha-switch
              @change="${(e) => this._valueChanged(e, 'show_wind_direction')}"
              .checked="${this._config.show_wind_direction !== false}"
            ></ha-switch>
            <label class="switch-label">
              Show Wind Direction
            </label>
          </div>
          <div class="switch-container">
            <ha-switch
              @change="${(e) => this._valueChanged(e, 'show_wind_speed')}"
              .checked="${this._config.show_wind_speed !== false}"
            ></ha-switch>
            <label class="switch-label">
              Show Wind Speed
            </label>
	  </div>
      <div class="switch-container">
        ${this.hasDewpoint ? html`
          <ha-switch
            @change="${(e) => this._valueChanged(e, 'show_dew_point')}"
            .checked="${this._config.show_dew_point !== false}"
          ></ha-switch>
          <label class="switch-label">
            Show Dew Point
          </label>
        ` : ''}
      </div>
      <div class="switch-container">
        ${this.hasWindgustspeed ? html`
          <ha-switch
            @change="${(e) => this._valueChanged(e, 'show_wind_gust_speed')}"
            .checked="${this._config.show_wind_gust_speed !== false}"
          ></ha-switch>
          <label class="switch-label">
            Show Wind Gust Speed
          </label>
        ` : ''}
      </div>
          <div class="switch-container">
            <ha-switch
              @change="${(e) => this._valueChanged(e, 'use_12hour_format')}"
              .checked="${this._config.use_12hour_format !== false}"
            ></ha-switch>
            <label class="switch-label">
              Use 12-Hour Format
            </label>
          </div>
          <div class="switch-container">
            <ha-switch
              @change="${(e) => this._valueChanged(e, 'autoscroll')}"
              .checked="${this._config.autoscroll !== false}"
            ></ha-switch>
            <label class="switch-label">
              Autoscroll
            </label>
          </div>
          <div class="time-container">
            <div class="switch-right">
              <ha-switch
                @change="${(e) => this._valueChanged(e, 'show_time')}"
                .checked="${this._config.show_time !== false}"
              ></ha-switch>
              <label class="switch-label">
                Show Current Time
              </label>
            </div>
            <div class="switch-right checkbox-container" style="${this._config.show_time ? 'display: flex;' : 'display: none;'}">
              <ha-checkbox
                @change="${(e) => this._valueChanged(e, 'show_time_seconds')}"
                .checked="${this._config.show_time_seconds !== false}"
              ></ha-checkbox>
              <label class="check-label">
                Show Seconds
              </label>
            </div>
            <div class="switch-right checkbox-container" style="${this._config.show_time ? 'display: flex;' : 'display: none;'}">
              <ha-checkbox
                @change="${(e) => this._valueChanged(e, 'show_day')}"
                .checked="${this._config.show_day !== false}"
              ></ha-checkbox>
              <label class="check-label">
                Show Day
              </label>
            </div>
            <div class="switch-right checkbox-container" style="${this._config.show_time ? 'display: flex;' : 'display: none;'}">
              <ha-checkbox
                @change="${(e) => this._valueChanged(e, 'show_date')}"
                .checked="${this._config.show_date !== false}"
              ></ha-checkbox>
              <label class="check-label">
                Show Date
              </label>
            </div>
          </div>
            <div class="flex-container" style="${this._config.show_time ? 'display: flex;' : 'display: none;'}">
              <ha-textfield
                label="Time text size"
                type="number"
                .value="${this._config.time_size || '26'}"
                @change="${(e) => this._valueChanged(e, 'time_size')}"
              ></ha-textfield>
              <ha-textfield
                label="Day and date text size"
                type="number"
                .value="${this._config.day_date_size || '15'}"
                @change="${(e) => this._valueChanged(e, 'day_date_size')}"
              ></ha-textfield>
              </div>
            <div class="icon-container">
              <div class="switch-right">
                <ha-switch
                  @change="${(e) => this._valueChanged(e, 'animated_icons')}"
                  .checked="${this._config.animated_icons === true}"
                ></ha-switch>
                <label class="switch-label">
                  Use Animated Icons
                </label>
              </div>
              <div class="switch-right radio-container" style="${this._config.animated_icons ? 'display: flex;' : 'display: none;'}">
                  <ha-radio
                    name="icon_style"
                    value="style1"
                    @change="${this._handleIconStyleChange}"
                    .checked="${this._config.icon_style === 'style1'}"
                  ></ha-radio>
                  <label class="check-label">
                    Style 1
                  </label>
                </div>
              <div class="switch-right radio-container" style="${this._config.animated_icons ? 'display: flex;' : 'display: none;'}">
                  <ha-radio
                    name="icon_style"
                    value="style2"
                    @change="${this._handleIconStyleChange}"
                    .checked="${this._config.icon_style === 'style2'}"
                  ></ha-radio>
                  <label class="check-label">
                    Style 2
                  </label>
                </div>
              </div>
       <div class="textfield-container">
         <ha-textfield
           label="Icon Size for animated or custom icons"
           type="number"
           .value="${this._config.icons_size || '25'}"
           @change="${(e) => this._valueChanged(e, 'icons_size')}"
         ></ha-textfield>
          <ha-textfield
            label="Curent temperature Font Size"
           type="number"
            .value="${this._config.current_temp_size || '28'}"
            @change="${(e) => this._valueChanged(e, 'current_temp_size')}"
          ></ha-textfield>
        <ha-textfield
          label="Custom icon path"
          .value="${this._config.icons || ''}"
          @change="${(e) => this._valueChanged(e, 'icons')}"
        ></ha-textfield>
         <ha-select
           naturalMenuWidth
           fixedMenuPosition
           label="Select custom language"
           .configValue=${''}
           .value=${this._config.locale}
           @change=${(e) => this._valueChanged(e, 'locale')}
           @closed=${(ev) => ev.stopPropagation()}
         >
           <ha-list-item .value=${''}>HA Default</ha-list-item>
           <ha-list-item .value=${'bg'}>Bulgarian</ha-list-item>
           <ha-list-item .value=${'ca'}>Catalan</ha-list-item>
           <ha-list-item .value=${'cs'}>Czech</ha-list-item>
           <ha-list-item .value=${'da'}>Danish</ha-list-item>
           <ha-list-item .value=${'nl'}>Dutch</ha-list-item>
           <ha-list-item .value=${'en'}>English</ha-list-item>
           <ha-list-item .value=${'fi'}>Finnish</ha-list-item>
           <ha-list-item .value=${'fr'}>French</ha-list-item>
           <ha-list-item .value=${'de'}>German</ha-list-item>
           <ha-list-item .value=${'el'}>Greek</ha-list-item>
           <ha-list-item .value=${'hu'}>Hungarian</ha-list-item>
           <ha-list-item .value=${'it'}>Italian</ha-list-item>
           <ha-list-item .value=${'lt'}>Lithuanian</ha-list-item>
           <ha-list-item .value=${'no'}>Norwegian</ha-list-item>
           <ha-list-item .value=${'pl'}>Polish</ha-list-item>
           <ha-list-item .value=${'pt'}>Portuguese</ha-list-item>
           <ha-list-item .value=${'ro'}>Romanian</ha-list-item>
           <ha-list-item .value=${'ru'}>Russian</ha-list-item>
           <ha-list-item .value=${'sk'}>Slovak</ha-list-item>
           <ha-list-item .value=${'es'}>Spanish</ha-list-item>
           <ha-list-item .value=${'sv'}>Swedish</ha-list-item>
	   <ha-list-item .value=${'uk'}>Ukrainian</ha-list-item>
    	   <ha-list-item .value=${'ko'}>한국어</ha-list-item>
        </ha-select>
        </div>
      </div>

        <h3 class="section">${tEditor(this.hass, 'chart_heading')}</h3>
        <div class="radio-container" style="margin-bottom: 12px;">
          <div class="switch-right">
            <ha-radio
              name="style"
              value="style1"
              @change="${this._handleStyleChange}"
              .checked="${forecastConfig.style === 'style1'}"
            ></ha-radio>
            <label class="check-label">Chart style 1</label>
          </div>
          <div class="switch-right">
            <ha-radio
              name="style"
              value="style2"
              @change="${this._handleStyleChange}"
              .checked="${forecastConfig.style === 'style2'}"
            ></ha-radio>
            <label class="check-label">Chart style 2</label>
          </div>
        </div>
        <div>
          <div class="switch-container">
            <ha-switch
              @change="${(e) => this._valueChanged(e, 'forecast.condition_icons')}"
              .checked="${forecastConfig.condition_icons !== false}"
            ></ha-switch>
            <label class="switch-label">
              Show Condition Icons
            </label>
          </div>
          <div class="switch-container">
            <ha-switch
              @change="${(e) => this._valueChanged(e, 'forecast.show_date')}"
              .checked="${forecastConfig.show_date !== false}"
            ></ha-switch>
            <label class="switch-label">
              Show date row in chart
            </label>
          </div>
          <div class="switch-container">
            <ha-switch
              @change="${(e) => this._valueChanged(e, 'forecast.show_wind_forecast')}"
              .checked="${forecastConfig.show_wind_forecast !== false}"
            ></ha-switch>
            <label class="switch-label">
              Show Wind Forecast
            </label>
          </div>
          <div class="switch-container">
            <ha-switch
              @change="${(e) => this._valueChanged(e, 'forecast.round_temp')}"
              .checked="${forecastConfig.round_temp !== false}"
            ></ha-switch>
            <label class="switch-label">
              Rounding Temperatures
            </label>
          </div>
          <div class="switch-container">
            <ha-switch
              @change="${(e) => this._valueChanged(e, 'forecast.disable_animation')}"
              .checked="${forecastConfig.disable_animation !== false}"
            ></ha-switch>
            <label class="switch-label">
              Disable Chart Animation
            </label>
          </div>
	  <div class="textfield-container">
          <ha-select
            naturalMenuWidth
            fixedMenuPosition
            label="Precipitation Type (Probability if supported by the weather entity)"
            .configValue=${'forecast.precipitation_type'}
            .value=${forecastConfig.precipitation_type}
            @change=${(e) => this._valueChanged(e, 'forecast.precipitation_type')}
            @closed=${(ev) => ev.stopPropagation()}
          >
            <ha-list-item .value=${'rainfall'}>Rainfall</ha-list-item>
            <ha-list-item .value=${'probability'}>Probability</ha-list-item>
          </ha-select>
         <div class="switch-container" ?hidden=${forecastConfig.precipitation_type !== 'rainfall'}>
             <ha-switch
               @change="${(e) => this._valueChanged(e, 'forecast.show_probability')}"
               .checked="${forecastConfig.show_probability !== false}"
             ></ha-switch>
             <label class="switch-label">
               Show precipitation probability
             </label>
         </div>
          <div class="textfield-container">
            <div class="flex-container">
              <ha-textfield
                label="Precipitation Bar Size %"
                type="number"
                max="100"
                min="0"
                .value="${forecastConfig.precip_bar_size || '100'}"
                @change="${(e) => this._valueChanged(e, 'forecast.precip_bar_size')}"
              ></ha-textfield>
              <ha-textfield
                label="Labels Font Size"
                type="number"
                .value="${forecastConfig.labels_font_size || '11'}"
                @change="${(e) => this._valueChanged(e, 'forecast.labels_font_size')}"
              ></ha-textfield>
              </div>
	    <div class="flex-container">
              <ha-textfield
                label="Chart height"
                type="number"
                .value="${forecastConfig.chart_height || '180'}"
                @change="${(e) => this._valueChanged(e, 'forecast.chart_height')}"
              ></ha-textfield>
              <ha-textfield
                label="Number of forecasts"
                type="number"
                .value="${forecastConfig.number_of_forecasts || '0'}"
                @change="${(e) => this._valueChanged(e, 'forecast.number_of_forecasts')}"
              ></ha-textfield>
              </div>
            </div>
          </div>
        </div>

        <h3 class="section">${tEditor(this.hass, 'units_heading')}</h3>
        <div class="textfield-container">
          <ha-form
            .data=${unitsConfig}
            .schema=${UNITS_SCHEMA}
            .hass=${this.hass}
            .computeLabel=${(s) => UNIT_LABELS[s.name] || s.name}
            @value-changed=${this._unitsChanged}
          ></ha-form>
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
