// Editor render partial — Section C: Layout.
// Master toggles for the main panel, the attributes row, and the
// chart rows. Each master expands its sub-fields only when ON; in YAML
// the sub-keys are evaluated regardless.

import { html } from 'lit';

export function renderLayoutSection(editor, ctx) {
  const { t, cfg, fcfg, hasSensor } = ctx;
  const valueChanged = (e, key) => editor._valueChanged(e, key);

  return html`
    <!-- ─── C. Layout ───────────────────────────────────────────── -->
    <h3 class="section">${t('layout_heading')}</h3>

    <h4 class="subsection">${t('main_panel_heading')}</h4>
    <div class="switch-container">
      <ha-switch
        @change="${(e) => valueChanged(e, 'show_main')}"
        .checked="${cfg.show_main === true}"
      ></ha-switch>
      <label class="switch-label">${t('show_main')}</label>
    </div>
    ${cfg.show_main === true ? html`
      <div class="switch-container">
        <ha-switch
          @change="${(e) => valueChanged(e, 'show_temperature')}"
          .checked="${cfg.show_temperature !== false}"
        ></ha-switch>
        <label class="switch-label">${t('show_temperature')}</label>
      </div>
      <div class="switch-container">
        <ha-switch
          @change="${(e) => valueChanged(e, 'show_current_condition')}"
          .checked="${cfg.show_current_condition !== false}"
        ></ha-switch>
        <label class="switch-label">${t('show_current_condition')}</label>
      </div>
      <div class="switch-container">
        <ha-switch
          @change="${(e) => valueChanged(e, 'show_time')}"
          .checked="${cfg.show_time === true}"
        ></ha-switch>
        <label class="switch-label">${t('show_time')}</label>
      </div>
      ${cfg.show_time === true ? html`
        <div class="switch-container" style="padding-left:20px;">
          <ha-switch
            @change="${(e) => valueChanged(e, 'show_time_seconds')}"
            .checked="${cfg.show_time_seconds === true}"
          ></ha-switch>
          <label class="switch-label">${t('show_time_seconds')}</label>
        </div>
        <div class="switch-container" style="padding-left:20px;">
          <ha-switch
            @change="${(e) => valueChanged(e, 'use_12hour_format')}"
            .checked="${cfg.use_12hour_format === true}"
          ></ha-switch>
          <label class="switch-label">${t('use_12hour_format')}</label>
        </div>
      ` : ''}
      <div class="switch-container">
        <ha-switch
          @change="${(e) => valueChanged(e, 'show_day')}"
          .checked="${cfg.show_day === true}"
        ></ha-switch>
        <label class="switch-label">${t('show_day')}</label>
      </div>
      <div class="switch-container">
        <ha-switch
          @change="${(e) => valueChanged(e, 'show_date')}"
          .checked="${cfg.show_date === true}"
        ></ha-switch>
        <label class="switch-label">${t('show_date')}</label>
      </div>
    ` : ''}

    <h4 class="subsection">${t('attributes_heading')}</h4>
    <div class="switch-container">
      <ha-switch
        @change="${(e) => valueChanged(e, 'show_attributes')}"
        .checked="${cfg.show_attributes === true}"
      ></ha-switch>
      <label class="switch-label">${t('show_attributes')}</label>
    </div>
    ${cfg.show_attributes === true ? html`
      ${hasSensor('humidity') ? html`
        <div class="switch-container">
          <ha-switch
            @change="${(e) => valueChanged(e, 'show_humidity')}"
            .checked="${cfg.show_humidity !== false}"
          ></ha-switch>
          <label class="switch-label">${t('show_humidity')}</label>
        </div>
      ` : ''}
      ${hasSensor('pressure') ? html`
        <div class="switch-container">
          <ha-switch
            @change="${(e) => valueChanged(e, 'show_pressure')}"
            .checked="${cfg.show_pressure !== false}"
          ></ha-switch>
          <label class="switch-label">${t('show_pressure')}</label>
        </div>
      ` : ''}
      ${hasSensor('dew_point') ? html`
        <div class="switch-container">
          <ha-switch
            @change="${(e) => valueChanged(e, 'show_dew_point')}"
            .checked="${cfg.show_dew_point === true}"
          ></ha-switch>
          <label class="switch-label">${t('show_dew_point')}</label>
        </div>
      ` : ''}
      ${hasSensor('wind_direction') ? html`
        <div class="switch-container">
          <ha-switch
            @change="${(e) => valueChanged(e, 'show_wind_direction')}"
            .checked="${cfg.show_wind_direction !== false}"
          ></ha-switch>
          <label class="switch-label">${t('show_wind_direction')}</label>
        </div>
      ` : ''}
      ${hasSensor('wind_speed') ? html`
        <div class="switch-container">
          <ha-switch
            @change="${(e) => valueChanged(e, 'show_wind_speed')}"
            .checked="${cfg.show_wind_speed !== false}"
          ></ha-switch>
          <label class="switch-label">${t('show_wind_speed')}</label>
        </div>
      ` : ''}
      ${hasSensor('gust_speed') ? html`
        <div class="switch-container">
          <ha-switch
            @change="${(e) => valueChanged(e, 'show_wind_gust_speed')}"
            .checked="${cfg.show_wind_gust_speed === true}"
          ></ha-switch>
          <label class="switch-label">${t('show_wind_gust_speed')}</label>
        </div>
      ` : ''}
      <div class="switch-container">
        <ha-switch
          @change="${(e) => valueChanged(e, 'show_sun')}"
          .checked="${cfg.show_sun === true}"
        ></ha-switch>
        <label class="switch-label">${t('show_sun')}</label>
      </div>
    ` : ''}

    <h4 class="subsection">${t('chart_rows_heading')}</h4>
    <div class="switch-container">
      <ha-switch
        @change="${(e) => valueChanged(e, 'forecast.condition_icons')}"
        .checked="${fcfg.condition_icons !== false}"
      ></ha-switch>
      <label class="switch-label">${t('show_chart_icons')}</label>
    </div>
    <div class="switch-container">
      <ha-switch
        @change="${(e) => valueChanged(e, 'forecast.show_wind_forecast')}"
        .checked="${fcfg.show_wind_forecast !== false}"
      ></ha-switch>
      <label class="switch-label">${t('show_chart_wind')}</label>
    </div>
    ${fcfg.show_wind_forecast !== false ? html`
      <div class="switch-container" style="padding-left:20px;">
        <ha-switch
          @change="${(e) => valueChanged(e, 'forecast.show_wind_arrow')}"
          .checked="${fcfg.show_wind_arrow !== false}"
        ></ha-switch>
        <label class="switch-label">${t('show_chart_wind_arrow')}</label>
      </div>
    ` : ''}
    <div class="switch-container">
      <ha-switch
        @change="${(e) => valueChanged(e, 'forecast.show_date')}"
        .checked="${fcfg.show_date !== false}"
      ></ha-switch>
      <label class="switch-label">${t('show_chart_date')}</label>
    </div>
    <div class="switch-container">
      <ha-switch
        @change="${(e) => valueChanged(e, 'forecast.show_sunshine')}"
        .checked="${fcfg.show_sunshine === true}"
      ></ha-switch>
      <label class="switch-label">${t('show_chart_sunshine')}</label>
    </div>
    ${fcfg.show_sunshine === true ? html`
      <div class="hint" style="padding-left:20px; margin-bottom:8px;">
        ${t('show_chart_sunshine_hint')}
      </div>
    ` : ''}
  `;
}
