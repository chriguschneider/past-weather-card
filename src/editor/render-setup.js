// Editor render partial — Section A: Setup.
// Title, mode radio, days / forecast_days, weather_entity, forecast.type,
// number_of_forecasts, plus the Actions sub-section (tap/hold/double_tap).
//
// Coupling: editor._valueChanged, editor._setMode, editor._actionChanged,
// editor._renderSunshineAvailabilityHint, editor.hass.

import { html } from 'lit';

export function renderSetupSection(editor, ctx) {
  const { t, cfg, fcfg, mode, showsStation, showsForecast } = ctx;

  return html`
    <!-- ─── A. Setup ─────────────────────────────────────────────── -->
    <h3 class="section">${t('setup_heading')}</h3>
    <div class="textfield-container">
      <ha-textfield
        label="${t('title')}"
        .value="${cfg.title || ''}"
        @change="${(e) => editor._valueChanged(e, 'title')}"
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
              @change=${() => editor._setMode(value)}
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
            @change="${(e) => editor._valueChanged(e, 'days')}"
          ></ha-textfield>
        ` : ''}
        ${showsForecast ? html`
          <ha-textfield
            label="${t('forecast_days')}"
            type="number" min="1" max="14"
            .value="${cfg.forecast_days != null ? cfg.forecast_days : (cfg.days || 7)}"
            @change="${(e) => editor._valueChanged(e, 'forecast_days')}"
          ></ha-textfield>
        ` : ''}
      </div>
      ${editor._renderSunshineAvailabilityHint(cfg, t)}
      ${showsForecast ? html`
        <ha-entity-picker
          .hass=${editor.hass}
          .value=${cfg.weather_entity || ''}
          .includeDomains=${['weather']}
          label="${t('weather_entity')}"
          allow-custom-entity
          @value-changed=${(e) => editor._valueChanged({ target: { value: e.detail.value } }, 'weather_entity')}
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
              @change=${() => editor._valueChanged({ target: { value } }, 'forecast.type')}
            ></ha-radio>
            <label>${t(key)}</label>
          </div>
        `)}
      </div>
      <ha-textfield
        label="${t('number_of_forecasts')}"
        type="number" min="0"
        .value="${fcfg.number_of_forecasts != null ? fcfg.number_of_forecasts : ''}"
        @change="${(e) => editor._valueChanged(e, 'forecast.number_of_forecasts')}"
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
          .hass=${editor.hass}
          .selector=${{ ui_action: {} }}
          .value=${cfg[key]}
          .label=${t(labelKey)}
          @value-changed=${(e) => editor._actionChanged(key, e.detail.value)}
        ></ha-selector>
      `)}
    </div>
  `;
}
