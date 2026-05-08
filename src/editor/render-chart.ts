// Editor render partial — Section 4: "Diagramm" (Chart).
// Single home for everything chart-related: time range / resolution,
// which rows render, visual style, sizes, and the collapsed colours
// override block. Replaces the chart-rows portion of the old "Was wird
// angezeigt?" section and the chart-related portions of the old
// "Aussehen" section.
//
// Always visible — the chart renders in every mode (station = past
// chart, forecast = future chart, combination = both side-by-side).

import { html, type TemplateResult } from 'lit';
import type { EditorLike, EditorContext, ChangeEvt } from './types.js';

export function renderChartSection(editor: EditorLike, ctx: EditorContext): TemplateResult {
  const { t, cfg, fcfg, showsStation, showsForecast } = ctx;
  const valueChanged = (e: ChangeEvt | { target: { value: string } }, key: string): void =>
    editor._valueChanged(e, key);

  return html`
    <h3 class="section">${t('chart_section_heading')}</h3>

    <div class="textfield-container">
      <ha-textfield
        label="${t('title')}"
        .value="${cfg.title || ''}"
        @change="${(e: Event) => valueChanged(e as ChangeEvt, 'title')}"
      ></ha-textfield>
    </div>

    <!-- ─── Zeitraum & Auflösung ──────────────────────────────────── -->
    <h4 class="subsection">${t('chart_time_range_heading')}</h4>
    <div class="textfield-container">
      <div class="flex-container">
        ${showsStation ? html`
          <ha-textfield
            label="${t('days')}"
            type="number" min="1" max="14"
            .value="${cfg.days || 7}"
            @change="${(e: Event) => valueChanged(e as ChangeEvt, 'days')}"
          ></ha-textfield>
        ` : ''}
        ${showsForecast ? html`
          <ha-textfield
            label="${t('forecast_days')}"
            type="number" min="1" max="14"
            .value="${cfg.forecast_days ?? (cfg.days || 7)}"
            @change="${(e: Event) => valueChanged(e as ChangeEvt, 'forecast_days')}"
          ></ha-textfield>
        ` : ''}
      </div>
      <ha-textfield
        label="${t('number_of_forecasts')}"
        type="number" min="0"
        .value="${fcfg.number_of_forecasts ?? ''}"
        @change="${(e: Event) => valueChanged(e as ChangeEvt, 'forecast.number_of_forecasts')}"
      ></ha-textfield>
      <p class="hint">${t('number_of_forecasts_hint')}</p>
    </div>

    <!-- ─── Diagramm-Zeilen ───────────────────────────────────────── -->
    <h4 class="subsection">${t('chart_rows_heading')}</h4>
    <div class="switch-container">
      <ha-switch
        @change="${(e: Event) => valueChanged(e as ChangeEvt, 'forecast.condition_icons')}"
        .checked="${fcfg.condition_icons !== false}"
      ></ha-switch>
      <label class="switch-label">${t('show_chart_icons')}</label>
    </div>
    <div class="switch-container">
      <ha-switch
        @change="${(e: Event) => valueChanged(e as ChangeEvt, 'forecast.show_wind_arrow')}"
        .checked="${fcfg.show_wind_arrow !== false}"
      ></ha-switch>
      <label class="switch-label">${t('show_chart_wind_direction')}</label>
    </div>
    <div class="switch-container">
      <ha-switch
        @change="${(e: Event) => valueChanged(e as ChangeEvt, 'forecast.show_wind_speed')}"
        .checked="${fcfg.show_wind_speed !== false}"
      ></ha-switch>
      <label class="switch-label">${t('show_chart_wind_speed')}</label>
    </div>
    <div class="switch-container">
      <ha-switch
        @change="${(e: Event) => valueChanged(e as ChangeEvt, 'forecast.show_date')}"
        .checked="${fcfg.show_date !== false}"
      ></ha-switch>
      <label class="switch-label">${t('show_chart_date')}</label>
    </div>
    <div class="switch-container">
      <ha-switch
        @change="${(e: Event) => valueChanged(e as ChangeEvt, 'forecast.show_sunshine')}"
        .checked="${fcfg.show_sunshine === true}"
      ></ha-switch>
      <label class="switch-label">${t('show_chart_sunshine')}</label>
    </div>
    ${fcfg.show_sunshine === true ? html`
      <div class="hint" style="padding-left:20px; margin-bottom:8px;">
        ${t('show_chart_sunshine_hint')}
      </div>
      <div style="padding-left:20px; margin-bottom:8px;">
        ${editor._renderSunshineAvailabilityHint(cfg, t)}
      </div>
    ` : ''}

    <!-- ─── Stil ──────────────────────────────────────────────────── -->
    <h4 class="subsection">${t('chart_appearance_heading')}</h4>
    <div class="textfield-container">
      <ha-form
        .data=${{ style: fcfg.style || 'style2' }}
        .schema=${[{
          name: 'style',
          selector: {
            select: {
              mode: 'dropdown',
              options: [
                { value: 'style2', label: t('chart_style_without_boxes') },
                { value: 'style1', label: t('chart_style_with_boxes') },
              ],
            },
          },
        }]}
        .hass=${editor.hass}
        .computeLabel=${() => t('chart_style')}
        @value-changed=${(e: CustomEvent<{ value: { style: string } }>) => {
          const next = e.detail.value?.style;
          if (next && next !== fcfg.style) {
            valueChanged({ target: { value: next } }, 'forecast.style');
          }
        }}
      ></ha-form>
      <div class="switch-container">
        <ha-switch
          @change="${(e: Event) => valueChanged(e as ChangeEvt, 'forecast.round_temp')}"
          .checked="${fcfg.round_temp === true}"
        ></ha-switch>
        <label class="switch-label">${t('round_temp')}</label>
      </div>
      <div class="switch-container">
        <ha-switch
          @change="${(e: Event) => valueChanged(e as ChangeEvt, 'forecast.disable_animation')}"
          .checked="${fcfg.disable_animation === true}"
        ></ha-switch>
        <label class="switch-label">${t('disable_animation')}</label>
      </div>
    </div>

    <!-- Chart sizes (chart_height, labels_font_size, precip_bar_size)
         and colour overrides (temperature1/2_color, precipitation_color,
         sunshine_color, chart_text_color, chart_datetime_color) live in
         DEFAULTS + YAML only — colours are theme-aware out of the box,
         sizes rarely need adjustment, and the editor surface stays
         cleaner without them. -->
  `;
}
