// Editor render partial — Section 2: "Wettervorhersage" (Weather forecast).
// weather_entity, forecast_days, forecast.type radio,
// number_of_forecasts, sunshine availability hint.
//
// Visible only when mode = forecast or combination.

import { html, type TemplateResult } from 'lit';
import type { EditorLike, EditorContext } from './types.js';

export function renderForecastSection(editor: EditorLike, ctx: EditorContext): TemplateResult {
  const { t, cfg, fcfg } = ctx;
  return html`
    <h3 class="section">${t('weather_forecast_heading')}</h3>
    <div class="textfield-container">
      <ha-entity-picker
        .hass=${editor.hass}
        .value=${cfg.weather_entity || ''}
        .includeDomains=${['weather']}
        label="${t('weather_entity')}"
        allow-custom-entity
        @value-changed=${(e: CustomEvent<{ value: string }>) => editor._valueChanged({ target: { value: e.detail.value } }, 'weather_entity')}
      ></ha-entity-picker>

      <ha-textfield
        label="${t('forecast_days')}"
        type="number" min="1" max="14"
        .value="${cfg.forecast_days != null ? cfg.forecast_days : (cfg.days || 7)}"
        @change="${(e: Event) => editor._valueChanged(e as unknown as { target: { value: string } }, 'forecast_days')}"
      ></ha-textfield>

      ${editor._renderSunshineAvailabilityHint(cfg, t)}

      <div class="radio-group">
        <span style="margin-right:8px;font-weight:500;">${t('forecast_type_label')}:</span>
        ${[
          ['daily', 'forecast_type_daily'],
          ['today', 'forecast_type_today'],
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
        @change="${(e: Event) => editor._valueChanged(e as unknown as { target: { value: string } }, 'forecast.number_of_forecasts')}"
      ></ha-textfield>
      <p class="hint">${t('number_of_forecasts_hint')}</p>
    </div>
  `;
}
