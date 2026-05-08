// Editor render partial — Section 5: "Live-Anzeige" (Live panel).
// The now-panel that sits above the chart: current temperature,
// condition, time, and the attributes row.
//
// Font-size knobs (current_temp_size, icons_size, time_size,
// day_date_size) are not exposed in the editor — they live in DEFAULTS
// + YAML only. Most users never touch them; the editor surface stays
// cleaner without them.
//
// Always visible — show_main is the gate for the panel itself; users
// can keep it off in pure forecast mode if they prefer the chart alone.

import { html, type TemplateResult } from 'lit';
import type { EditorLike, EditorContext, ChangeEvt } from './types.js';

export function renderLivePanelSection(editor: EditorLike, ctx: EditorContext): TemplateResult {
  const { t, cfg, hasSensor, hasLiveValue } = ctx;
  const valueChanged = (e: ChangeEvt | { target: { value: string } }, key: string): void =>
    editor._valueChanged(e, key);

  return html`
    <h3 class="section">${t('live_panel_heading')}</h3>

    <!-- ─── Hauptpanel ────────────────────────────────────────────── -->
    <h4 class="subsection">${t('main_panel_heading')}</h4>
    <div class="switch-container">
      <ha-switch
        @change="${(e: Event) => valueChanged(e as ChangeEvt, 'show_main')}"
        .checked="${cfg.show_main === true}"
      ></ha-switch>
      <label class="switch-label">${t('show_main')}</label>
    </div>
    ${cfg.show_main === true ? html`
      <div class="switch-container">
        <ha-switch
          @change="${(e: Event) => valueChanged(e as ChangeEvt, 'show_temperature')}"
          .checked="${cfg.show_temperature !== false}"
        ></ha-switch>
        <label class="switch-label">${t('show_temperature')}</label>
      </div>
      <div class="switch-container">
        <ha-switch
          @change="${(e: Event) => valueChanged(e as ChangeEvt, 'show_current_condition')}"
          .checked="${cfg.show_current_condition !== false}"
        ></ha-switch>
        <label class="switch-label">${t('show_current_condition')}</label>
      </div>
      <div class="switch-container">
        <ha-switch
          @change="${(e: Event) => valueChanged(e as ChangeEvt, 'show_time')}"
          .checked="${cfg.show_time === true}"
        ></ha-switch>
        <label class="switch-label">${t('show_time')}</label>
      </div>
      ${cfg.show_time === true ? html`
        <div class="switch-container" style="padding-left:20px;">
          <ha-switch
            @change="${(e: Event) => valueChanged(e as ChangeEvt, 'show_time_seconds')}"
            .checked="${cfg.show_time_seconds === true}"
          ></ha-switch>
          <label class="switch-label">${t('show_time_seconds')}</label>
        </div>
        <div class="switch-container" style="padding-left:20px;">
          <ha-switch
            @change="${(e: Event) => valueChanged(e as ChangeEvt, 'use_12hour_format')}"
            .checked="${cfg.use_12hour_format === true}"
          ></ha-switch>
          <label class="switch-label">${t('use_12hour_format')}</label>
        </div>
      ` : ''}
      <div class="switch-container">
        <ha-switch
          @change="${(e: Event) => valueChanged(e as ChangeEvt, 'show_day')}"
          .checked="${cfg.show_day === true}"
        ></ha-switch>
        <label class="switch-label">${t('show_day')}</label>
      </div>
      <div class="switch-container">
        <ha-switch
          @change="${(e: Event) => valueChanged(e as ChangeEvt, 'show_date')}"
          .checked="${cfg.show_date === true}"
        ></ha-switch>
        <label class="switch-label">${t('show_date')}</label>
      </div>
    ` : ''}

    <!-- ─── Attributzeile ─────────────────────────────────────────── -->
    <h4 class="subsection">${t('attributes_heading')}</h4>
    <div class="switch-container">
      <ha-switch
        @change="${(e: Event) => valueChanged(e as ChangeEvt, 'show_attributes')}"
        .checked="${cfg.show_attributes === true}"
      ></ha-switch>
      <label class="switch-label">${t('show_attributes')}</label>
    </div>
    ${cfg.show_attributes === true && hasLiveValue('humidity') ? html`
      <div class="switch-container">
        <ha-switch
          @change="${(e: Event) => valueChanged(e as ChangeEvt, 'show_humidity')}"
          .checked="${cfg.show_humidity !== false}"
        ></ha-switch>
        <label class="switch-label">${t('show_humidity')}</label>
      </div>
    ` : ''}
    ${cfg.show_attributes === true && hasLiveValue('pressure') ? html`
      <div class="switch-container">
        <ha-switch
          @change="${(e: Event) => valueChanged(e as ChangeEvt, 'show_pressure')}"
          .checked="${cfg.show_pressure !== false}"
        ></ha-switch>
        <label class="switch-label">${t('show_pressure')}</label>
      </div>
    ` : ''}
    ${cfg.show_attributes === true && hasLiveValue('dew_point') ? html`
      <div class="switch-container">
        <ha-switch
          @change="${(e: Event) => valueChanged(e as ChangeEvt, 'show_dew_point')}"
          .checked="${cfg.show_dew_point === true}"
        ></ha-switch>
        <label class="switch-label">${t('show_dew_point')}</label>
      </div>
    ` : ''}
    ${cfg.show_attributes === true && hasSensor('precipitation') ? html`
      <div class="switch-container">
        <ha-switch
          @change="${(e: Event) => valueChanged(e as ChangeEvt, 'show_precipitation')}"
          .checked="${cfg.show_precipitation === true}"
        ></ha-switch>
        <label class="switch-label">${t('show_precipitation')}</label>
      </div>
    ` : ''}
    ${cfg.show_attributes === true && hasLiveValue('uv_index') ? html`
      <div class="switch-container">
        <ha-switch
          @change="${(e: Event) => valueChanged(e as ChangeEvt, 'show_uv_index')}"
          .checked="${cfg.show_uv_index !== false}"
        ></ha-switch>
        <label class="switch-label">${t('show_uv_index')}</label>
      </div>
    ` : ''}
    ${cfg.show_attributes === true && hasSensor('illuminance') ? html`
      <div class="switch-container">
        <ha-switch
          @change="${(e: Event) => valueChanged(e as ChangeEvt, 'show_illuminance')}"
          .checked="${cfg.show_illuminance === true}"
        ></ha-switch>
        <label class="switch-label">${t('show_illuminance')}</label>
      </div>
    ` : ''}
    ${cfg.show_attributes === true && hasSensor('sunshine_duration') ? html`
      <div class="switch-container">
        <ha-switch
          @change="${(e: Event) => valueChanged(e as ChangeEvt, 'show_sunshine_duration')}"
          .checked="${cfg.show_sunshine_duration === true}"
        ></ha-switch>
        <label class="switch-label">${t('show_sunshine_duration')}</label>
      </div>
    ` : ''}
    ${cfg.show_attributes === true && hasLiveValue('wind_direction') ? html`
      <div class="switch-container">
        <ha-switch
          @change="${(e: Event) => valueChanged(e as ChangeEvt, 'show_wind_direction')}"
          .checked="${cfg.show_wind_direction !== false}"
        ></ha-switch>
        <label class="switch-label">${t('show_wind_direction')}</label>
      </div>
    ` : ''}
    ${cfg.show_attributes === true && hasLiveValue('wind_speed') ? html`
      <div class="switch-container">
        <ha-switch
          @change="${(e: Event) => valueChanged(e as ChangeEvt, 'show_wind_speed')}"
          .checked="${cfg.show_wind_speed !== false}"
        ></ha-switch>
        <label class="switch-label">${t('show_wind_speed')}</label>
      </div>
    ` : ''}
    ${cfg.show_attributes === true && hasLiveValue('gust_speed') ? html`
      <div class="switch-container">
        <ha-switch
          @change="${(e: Event) => valueChanged(e as ChangeEvt, 'show_wind_gust_speed')}"
          .checked="${cfg.show_wind_gust_speed === true}"
        ></ha-switch>
        <label class="switch-label">${t('show_wind_gust_speed')}</label>
      </div>
    ` : ''}
    ${cfg.show_attributes === true ? html`
      <div class="switch-container">
        <ha-switch
          @change="${(e: Event) => valueChanged(e as ChangeEvt, 'show_sun')}"
          .checked="${cfg.show_sun === true}"
        ></ha-switch>
        <label class="switch-label">${t('show_sun')}</label>
      </div>
    ` : ''}

    <!-- Font-size knobs (current_temp_size, icons_size, time_size,
         day_date_size) live in DEFAULTS + YAML only — most users never
         change them and the editor surface is cleaner without them. -->
  `;
}
