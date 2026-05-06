// Editor render partial — Section D: Style & Colours.
// Chart appearance (style radio + round_temp + disable_animation),
// sizing (icon / temp / time / day-date / labels-font / chart-height /
// precip-bar), icons (style radio + animated + custom URL), and the
// collapsed Colours sub-section.

import { html, type TemplateResult } from 'lit';
import type { EditorLike, EditorContext } from './types.js';

type ChangeEvt = Event & { target: HTMLInputElement };

export function renderStyleSection(editor: EditorLike, ctx: EditorContext): TemplateResult {
  const { t, cfg, fcfg } = ctx;
  const valueChanged = (e: ChangeEvt | { target: { value: string } }, key: string): void =>
    editor._valueChanged(e as { target: { value: string } }, key);

  return html`
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
            @change=${() => valueChanged({ target: { value: 'style2' } }, 'forecast.style')}
          ></ha-radio>
          <label>${t('chart_style_without_boxes')}</label>
        </div>
        <div class="radio-item">
          <ha-radio
            name="ws-chart-style"
            .value=${'style1'}
            .checked=${fcfg.style === 'style1'}
            @change=${() => valueChanged({ target: { value: 'style1' } }, 'forecast.style')}
          ></ha-radio>
          <label>${t('chart_style_with_boxes')}</label>
        </div>
      </div>
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

    <h4 class="subsection">${t('sizing_heading')}</h4>
    <div class="textfield-container">
      <div class="flex-container">
        <ha-textfield
          label="${t('icon_size')}" type="number"
          .value="${cfg.icons_size || '25'}"
          @change="${(e: Event) => valueChanged(e as ChangeEvt, 'icons_size')}"
        ></ha-textfield>
        <ha-textfield
          label="${t('current_temp_size')}" type="number"
          .value="${cfg.current_temp_size || '28'}"
          @change="${(e: Event) => valueChanged(e as ChangeEvt, 'current_temp_size')}"
        ></ha-textfield>
      </div>
      <div class="flex-container">
        <ha-textfield
          label="${t('time_size')}" type="number"
          .value="${cfg.time_size || '26'}"
          @change="${(e: Event) => valueChanged(e as ChangeEvt, 'time_size')}"
        ></ha-textfield>
        <ha-textfield
          label="${t('day_date_size')}" type="number"
          .value="${cfg.day_date_size || '15'}"
          @change="${(e: Event) => valueChanged(e as ChangeEvt, 'day_date_size')}"
        ></ha-textfield>
      </div>
      <div class="flex-container">
        <ha-textfield
          label="${t('labels_font_size')}" type="number"
          .value="${fcfg.labels_font_size || '11'}"
          @change="${(e: Event) => valueChanged(e as ChangeEvt, 'forecast.labels_font_size')}"
        ></ha-textfield>
        <ha-textfield
          label="${t('chart_height')}" type="number"
          .value="${fcfg.chart_height || '180'}"
          @change="${(e: Event) => valueChanged(e as ChangeEvt, 'forecast.chart_height')}"
        ></ha-textfield>
      </div>
      <ha-textfield
        label="${t('precip_bar_size')}" type="number" min="0" max="100"
        .value="${fcfg.precip_bar_size || '100'}"
        @change="${(e: Event) => valueChanged(e as ChangeEvt, 'forecast.precip_bar_size')}"
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
            @change=${() => valueChanged({ target: { value: 'style1' } }, 'icon_style')}
          ></ha-radio>
          <label>Style 1</label>
        </div>
        <div class="radio-item">
          <ha-radio
            name="ws-icon-style"
            .value=${'style2'}
            .checked=${cfg.icon_style === 'style2'}
            @change=${() => valueChanged({ target: { value: 'style2' } }, 'icon_style')}
          ></ha-radio>
          <label>Style 2</label>
        </div>
      </div>
      <div class="switch-container">
        <ha-switch
          @change="${(e: Event) => valueChanged(e as ChangeEvt, 'animated_icons')}"
          .checked="${cfg.animated_icons === true}"
        ></ha-switch>
        <label class="switch-label">${t('animated_icons')}</label>
      </div>
      <ha-textfield
        label="${t('custom_icons_url')}"
        .value="${cfg.icons || ''}"
        @change="${(e: Event) => valueChanged(e as ChangeEvt, 'icons')}"
      ></ha-textfield>
    </div>

    <details class="advanced">
      <summary>${t('colours_heading')}</summary>
      <div class="textfield-container" style="margin-top:12px;">
        <ha-textfield
          label="${t('temperature1_color')}"
          .value="${fcfg.temperature1_color || ''}"
          placeholder="rgba(255, 152, 0, 1.0)"
          @change="${(e: Event) => valueChanged(e as ChangeEvt, 'forecast.temperature1_color')}"
        ></ha-textfield>
        <ha-textfield
          label="${t('temperature2_color')}"
          .value="${fcfg.temperature2_color || ''}"
          placeholder="rgba(68, 115, 158, 1.0)"
          @change="${(e: Event) => valueChanged(e as ChangeEvt, 'forecast.temperature2_color')}"
        ></ha-textfield>
        <ha-textfield
          label="${t('precipitation_color')}"
          .value="${fcfg.precipitation_color || ''}"
          placeholder="rgba(132, 209, 253, 1.0)"
          @change="${(e: Event) => valueChanged(e as ChangeEvt, 'forecast.precipitation_color')}"
        ></ha-textfield>
        <ha-textfield
          label="${t('sunshine_color')}"
          .value="${fcfg.sunshine_color || ''}"
          placeholder="rgba(255, 193, 7, 1.0)"
          @change="${(e: Event) => valueChanged(e as ChangeEvt, 'forecast.sunshine_color')}"
        ></ha-textfield>
        <ha-textfield
          label="${t('chart_text_color')}"
          .value="${fcfg.chart_text_color || ''}"
          placeholder="auto"
          @change="${(e: Event) => valueChanged(e as ChangeEvt, 'forecast.chart_text_color')}"
        ></ha-textfield>
        <ha-textfield
          label="${t('chart_datetime_color')}"
          .value="${fcfg.chart_datetime_color || ''}"
          placeholder="auto"
          @change="${(e: Event) => valueChanged(e as ChangeEvt, 'forecast.chart_datetime_color')}"
        ></ha-textfield>
      </div>
    </details>
  `;
}
