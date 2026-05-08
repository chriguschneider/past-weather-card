// @vitest-environment jsdom
// Smoketests for the v1.9.x "Live-Anzeige" (Live panel) editor
// partial. Same pattern as editor-render-chart.test.js — see that file
// for the rationale.
//
// What's specific here: the live panel has two master toggles
// (show_main + show_attributes) and a swarm of conditional sub-toggles
// gated on hasSensor / hasLiveValue. The tests verify that
//   1) defaults render without throwing
//   2) sub-toggles are hidden when the master is off
//   3) attribute-row sub-toggles surface only for sensors that report

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from 'lit';
import { renderLivePanelSection } from '../src/editor/render-live-panel.js';
import { DEFAULTS, DEFAULTS_FORECAST } from '../src/defaults.js';

function makeEditor() {
  return {
    hass: null,
    _config: null,
    _mode: 'combination',
    _setMode: vi.fn(),
    _valueChanged: vi.fn(),
    _sensorsChanged: vi.fn(),
    _sensorPickerChanged: vi.fn(),
    _unitsChanged: vi.fn(),
    _actionChanged: vi.fn(),
    _conditionMappingChanged: vi.fn(),
    _renderSunshineAvailabilityHint: vi.fn(),
    configChanged: vi.fn(),
    requestUpdate: vi.fn(),
  };
}

function makeCtx({
  cfg = {},
  fcfg = {},
  hasSensor = () => false,
  hasLiveValue = () => false,
  ...overrides
} = {}) {
  const mergedFcfg = { ...DEFAULTS_FORECAST, ...fcfg };
  const mergedCfg = { ...DEFAULTS, ...cfg, forecast: mergedFcfg };
  return {
    t: (k) => k,
    cfg: mergedCfg,
    fcfg: mergedFcfg,
    sensorsConfig: {},
    unitsConfig: {},
    cmap: {},
    mode: 'combination',
    showsStation: true,
    showsForecast: true,
    hasSensor,
    hasLiveValue,
    ...overrides,
  };
}

function renderInto(editor, ctx) {
  const container = document.createElement('div');
  render(renderLivePanelSection(editor, ctx), container);
  return container;
}

function labelTexts(container) {
  return Array.from(container.querySelectorAll('.switch-container label')).map(
    (l) => l.textContent?.trim(),
  );
}

describe('renderLivePanelSection', () => {
  let editor;
  beforeEach(() => {
    editor = makeEditor();
  });

  it('renders without throwing on default config', () => {
    expect(() => renderInto(editor, makeCtx())).not.toThrow();
  });

  it('shows the live-panel section heading', () => {
    const container = renderInto(editor, makeCtx());
    const heading = container.querySelector('h3.section');
    expect(heading?.textContent?.trim()).toBe('live_panel_heading');
  });

  it('emits the two subsection headings (main panel, attributes)', () => {
    const container = renderInto(editor, makeCtx());
    const subs = Array.from(container.querySelectorAll('h4.subsection')).map(
      (h) => h.textContent?.trim(),
    );
    expect(subs).toEqual(['main_panel_heading', 'attributes_heading']);
  });

  it('shows the show_main and show_attributes master toggles in the default state', () => {
    const labels = labelTexts(renderInto(editor, makeCtx()));
    expect(labels).toContain('show_main');
    expect(labels).toContain('show_attributes');
  });

  it('hides main-panel sub-toggles when show_main is off (DEFAULTS state)', () => {
    // DEFAULTS.show_main is false — sub-toggles must stay collapsed.
    const labels = labelTexts(renderInto(editor, makeCtx()));
    expect(labels).not.toContain('show_temperature');
    expect(labels).not.toContain('show_current_condition');
    expect(labels).not.toContain('show_time');
    expect(labels).not.toContain('show_day');
    expect(labels).not.toContain('show_date');
  });

  it('shows main-panel sub-toggles when show_main is enabled', () => {
    const labels = labelTexts(renderInto(editor, makeCtx({ cfg: { show_main: true } })));
    expect(labels).toContain('show_temperature');
    expect(labels).toContain('show_current_condition');
    expect(labels).toContain('show_time');
    expect(labels).toContain('show_day');
    expect(labels).toContain('show_date');
  });

  it('reveals the time-format sub-toggles only when show_time is enabled', () => {
    const off = labelTexts(renderInto(editor, makeCtx({ cfg: { show_main: true, show_time: false } })));
    expect(off).not.toContain('show_time_seconds');
    expect(off).not.toContain('use_12hour_format');

    const on = labelTexts(renderInto(editor, makeCtx({ cfg: { show_main: true, show_time: true } })));
    expect(on).toContain('show_time_seconds');
    expect(on).toContain('use_12hour_format');
  });

  it('hides all attribute-row sub-toggles when show_attributes is off (DEFAULTS state)', () => {
    // DEFAULTS.show_attributes is false. With everything sensored, sub-
    // toggles still must stay collapsed because the master is off.
    const labels = labelTexts(renderInto(editor, makeCtx({
      hasSensor: () => true,
      hasLiveValue: () => true,
    })));
    expect(labels).not.toContain('show_humidity');
    expect(labels).not.toContain('show_pressure');
    expect(labels).not.toContain('show_uv_index');
  });

  it('hides attribute sub-toggles when the master is on but no sensor / live value reports', () => {
    const labels = labelTexts(renderInto(editor, makeCtx({
      cfg: { show_attributes: true },
      hasSensor: () => false,
      hasLiveValue: () => false,
    })));
    // Without any reporting sensor or live attribute, only the master
    // toggle and show_sun (unconditional) should surface.
    expect(labels).toContain('show_attributes');
    expect(labels).toContain('show_sun');
    expect(labels).not.toContain('show_humidity');
    expect(labels).not.toContain('show_pressure');
    expect(labels).not.toContain('show_dew_point');
    expect(labels).not.toContain('show_uv_index');
    expect(labels).not.toContain('show_illuminance');
    expect(labels).not.toContain('show_precipitation');
  });

  it('reveals only the sub-toggles whose backing sensor / live value is present', () => {
    const liveOnly = new Set(['humidity', 'pressure']);
    const sensorOnly = new Set(['precipitation']);
    const labels = labelTexts(renderInto(editor, makeCtx({
      cfg: { show_attributes: true },
      hasSensor: (k) => sensorOnly.has(k),
      hasLiveValue: (k) => liveOnly.has(k),
    })));
    expect(labels).toContain('show_humidity');
    expect(labels).toContain('show_pressure');
    expect(labels).toContain('show_precipitation');
    expect(labels).not.toContain('show_dew_point');
    expect(labels).not.toContain('show_uv_index');
    expect(labels).not.toContain('show_illuminance');
    expect(labels).not.toContain('show_wind_direction');
  });

  it('shows the wind sub-toggles when their respective live values are present', () => {
    const liveKeys = new Set(['wind_direction', 'wind_speed', 'gust_speed']);
    const labels = labelTexts(renderInto(editor, makeCtx({
      cfg: { show_attributes: true },
      hasLiveValue: (k) => liveKeys.has(k),
    })));
    expect(labels).toContain('show_wind_direction');
    expect(labels).toContain('show_wind_speed');
    expect(labels).toContain('show_wind_gust_speed');
  });
});
