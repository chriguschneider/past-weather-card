// Editor render partial — Section 2: "Wettervorhersage" (Weather forecast).
// Pure data source: just the weather entity picker via <ha-form> with
// an entity selector (matches the pattern used by the sensors block
// and the unit dropdowns). Forecast-window settings (forecast_days,
// forecast.type, visible columns) live with the rest of the chart
// configuration in render-chart.ts; the sunshine availability hint
// sits next to the Sunshine Bar toggle in the chart-rows subsection.
//
// Visible only when mode = forecast or combination.

import { html, type TemplateResult } from 'lit';
import type { EditorLike, EditorContext } from './types.js';
import { renderSectionHeader } from './section-header.js';

const WEATHER_SCHEMA = [{
  name: 'weather_entity',
  required: true,
  selector: {
    entity: { domain: 'weather' },
  },
}];

export function renderForecastSection(editor: EditorLike, ctx: EditorContext): TemplateResult {
  const { t, cfg } = ctx;

  const handleChanged = (event: CustomEvent<{ value: { weather_entity: string } }>): void => {
    const next = event.detail.value?.weather_entity ?? '';
    editor._valueChanged({ target: { value: next } }, 'weather_entity');
  };

  return html`
    ${renderSectionHeader({ editor, title: t('weather_forecast_heading'), sectionKey: 'weather_forecast', resetLabel: t('reset_section') })}
    <div class="textfield-container">
      <ha-form
        .data=${{ weather_entity: cfg.weather_entity || '' }}
        .schema=${WEATHER_SCHEMA}
        .hass=${editor.hass}
        .computeLabel=${() => t('weather_entity')}
        @value-changed=${handleChanged}
      ></ha-form>
    </div>
  `;
}
