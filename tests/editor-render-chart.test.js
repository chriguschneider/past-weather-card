// @vitest-environment jsdom
// Smoketests for the v1.9.x "Diagramm" (Chart) editor partial. The
// editor render path is otherwise covered by the Playwright E2E suite
// (#14) — these unit tests catch import / signature / shape breakage
// faster than the full browser run, and keep refactors of EditorContext
// or _valueChanged from silently breaking the partial.
//
// Pattern: instantiate a mock EditorLike + EditorContext, call
// renderChartSection, render the resulting Lit template into a jsdom
// <div>, and query the result. Custom elements (<ha-switch>, <ha-form>,
// <ha-textfield>) render as unknown HTMLElements in jsdom — that's
// fine, we just need to verify they exist and carry the right
// attributes / structure.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, html } from 'lit';
import { renderChartSection } from '../src/editor/render-chart.js';
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
    // Returns a sentinel template so we can assert it was actually
    // composed into the output (not just called as a side-effect).
    _renderSunshineAvailabilityHint: vi.fn(
      () => html`<span class="sunshine-availability-mock">availability info</span>`,
    ),
    configChanged: vi.fn(),
    requestUpdate: vi.fn(),
  };
}

function makeCtx({ cfg = {}, fcfg = {}, ...overrides } = {}) {
  const mergedFcfg = { ...DEFAULTS_FORECAST, ...fcfg };
  const mergedCfg = { ...DEFAULTS, ...cfg, forecast: mergedFcfg };
  return {
    t: (k) => k, // identity translator — assertions use raw keys
    cfg: mergedCfg,
    fcfg: mergedFcfg,
    sensorsConfig: {},
    unitsConfig: {},
    cmap: {},
    mode: 'combination',
    showsStation: true,
    showsForecast: true,
    hasSensor: () => false,
    hasLiveValue: () => false,
    ...overrides,
  };
}

function renderInto(editor, ctx) {
  const container = document.createElement('div');
  render(renderChartSection(editor, ctx), container);
  return container;
}

describe('renderChartSection', () => {
  let editor;
  beforeEach(() => {
    editor = makeEditor();
  });

  it('renders without throwing on default config', () => {
    expect(() => renderInto(editor, makeCtx())).not.toThrow();
  });

  it('shows the chart section heading', () => {
    const container = renderInto(editor, makeCtx());
    const heading = container.querySelector('h3.section');
    expect(heading?.textContent?.trim()).toBe('chart_section_heading');
  });

  it('emits the three subsection headings (time-range, rows, appearance)', () => {
    const container = renderInto(editor, makeCtx());
    const subs = Array.from(container.querySelectorAll('h4.subsection')).map(
      (h) => h.textContent?.trim(),
    );
    expect(subs).toEqual([
      'chart_time_range_heading',
      'chart_rows_heading',
      'chart_appearance_heading',
    ]);
  });

  it('renders the chart-row toggles (icons, wind_direction, wind_speed, date, sunshine)', () => {
    const container = renderInto(editor, makeCtx());
    const labels = Array.from(container.querySelectorAll('.switch-container label'))
      .map((l) => l.textContent?.trim());
    expect(labels).toContain('show_chart_icons');
    expect(labels).toContain('show_chart_wind_direction');
    expect(labels).toContain('show_chart_wind_speed');
    expect(labels).toContain('show_chart_date');
    expect(labels).toContain('show_chart_sunshine');
  });

  it('renders the appearance toggles (round_temp, disable_animation)', () => {
    const container = renderInto(editor, makeCtx());
    const labels = Array.from(container.querySelectorAll('.switch-container label'))
      .map((l) => l.textContent?.trim());
    expect(labels).toContain('round_temp');
    expect(labels).toContain('disable_animation');
  });

  it('renders the chart-style ha-form select dropdown', () => {
    const container = renderInto(editor, makeCtx());
    const form = container.querySelector('ha-form');
    expect(form).toBeTruthy();
  });

  it('does NOT call the sunshine availability hint when show_sunshine is off', () => {
    renderInto(editor, makeCtx({ fcfg: { show_sunshine: false } }));
    expect(editor._renderSunshineAvailabilityHint).not.toHaveBeenCalled();
  });

  it('calls the sunshine availability hint and embeds its output when show_sunshine is on', () => {
    const container = renderInto(editor, makeCtx({ fcfg: { show_sunshine: true } }));
    expect(editor._renderSunshineAvailabilityHint).toHaveBeenCalledOnce();
    expect(container.querySelector('.sunshine-availability-mock')).toBeTruthy();
  });

  it('hides the days field when showsStation is false (forecast-only)', () => {
    const container = renderInto(editor, makeCtx({ showsStation: false, mode: 'forecast' }));
    const fields = Array.from(container.querySelectorAll('ha-textfield'))
      .map((f) => f.getAttribute('label'));
    expect(fields).not.toContain('days');
  });

  it('hides the forecast_days field when showsForecast is false (station-only)', () => {
    const container = renderInto(editor, makeCtx({ showsForecast: false, mode: 'station' }));
    const fields = Array.from(container.querySelectorAll('ha-textfield'))
      .map((f) => f.getAttribute('label'));
    expect(fields).not.toContain('forecast_days');
  });

  it('shows both days and forecast_days in combination mode', () => {
    const container = renderInto(editor, makeCtx());
    const fields = Array.from(container.querySelectorAll('ha-textfield'))
      .map((f) => f.getAttribute('label'));
    expect(fields).toContain('days');
    expect(fields).toContain('forecast_days');
  });

  it('exposes a title input', () => {
    const container = renderInto(editor, makeCtx({ cfg: { title: 'Living Room' } }));
    const titleField = Array.from(container.querySelectorAll('ha-textfield'))
      .find((f) => f.getAttribute('label') === 'title');
    expect(titleField).toBeTruthy();
  });
});
