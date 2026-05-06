// Editor render partial — Section F: Advanced.
// Locale override and the collapsed condition_mapping override block.
//
// Both source-of-truth lists (LOCALE_OPTIONS, CONDITION_MAPPING_FIELDS)
// live here since this is the only file that references them.

import { html, type TemplateResult } from 'lit';
import type { EditorLike, EditorContext } from './types.js';

const LOCALE_OPTIONS: ReadonlyArray<[string, string]> = [
  ['',   'HA Default'],
  ['bg', 'Bulgarian'], ['ca', 'Catalan'], ['cs', 'Czech'], ['da', 'Danish'],
  ['nl', 'Dutch'],     ['en', 'English'], ['fi', 'Finnish'], ['fr', 'French'],
  ['de', 'German'],    ['el', 'Greek'],   ['hu', 'Hungarian'], ['it', 'Italian'],
  ['lt', 'Lithuanian'], ['no', 'Norwegian'], ['pl', 'Polish'], ['pt', 'Portuguese'],
  ['ro', 'Romanian'],  ['ru', 'Russian'], ['sk', 'Slovak'], ['es', 'Spanish'],
  ['sv', 'Swedish'],   ['uk', 'Ukrainian'], ['ko', '한국어'],
];

// condition_mapping override schema. Each row knows its unit (rendered as
// a suffix in the input label) so users don't need to consult the README
// to remember whether `windy_threshold` is m/s or km/h.
interface ConditionMappingField {
  key: string;
  unit: string;
  defaultValue: number;
}

const CONDITION_MAPPING_FIELDS: ReadonlyArray<ConditionMappingField> = [
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

export function renderAdvancedSection(editor: EditorLike, ctx: EditorContext): TemplateResult {
  const { t, cfg, cmap } = ctx;
  return html`
    <!-- ─── F. Advanced ─────────────────────────────────────────── -->
    <!--
      forecast.type and forecast.number_of_forecasts are wired as of
      v0.8 — both sit in the Setup block above next to weather_entity.
    -->
    <h3 class="section">${t('advanced_heading')}</h3>
    <div class="textfield-container">
      <ha-select
        naturalMenuWidth fixedMenuPosition
        label="${t('locale')}"
        .value=${cfg.locale || ''}
        @change=${(e: Event) => editor._valueChanged(e as unknown as { target: { value: string } }, 'locale')}
        @closed=${(ev: Event) => ev.stopPropagation()}
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
            @change="${(e: Event) => editor._conditionMappingChanged(e as unknown as { target: { value: string } }, field.key)}"
          ></ha-textfield>
          <span class="cmap-unit">${field.unit}</span>
        </div>
      `)}
    </details>
  `;
}
