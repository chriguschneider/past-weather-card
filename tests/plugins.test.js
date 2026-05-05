// Plugin unit tests. The Chart.js plugins are pure factories that return
// objects with `afterDraw(chart)` (or `afterDatasetsDraw(chart)`) hooks.
// We don't render to a real canvas — instead we hand the hook a mock
// chart with stubbed scales / chartArea / ctx, then assert which canvas
// calls happened and at which coordinates.
//
// What we actually want to catch with these tests:
//   1. Bail-out branches that protect against unready layout (no xScale,
//      no ticks, no meta data) — regressions there silently drop the
//      whole plugin, leaving the chart looking under-decorated.
//   2. Hourly vs. daily mode dispatch — separator plugin must produce a
//      single boundary line at hourly combination, doubled-today framing
//      at daily combination. Daily-tick-labels plugin must early-return
//      at hourly.
//   3. The `id` field — Chart.js dedupes plugins by id, so a typo here
//      would silently double-register.

import { describe, it, expect, vi } from 'vitest';
import {
  createSeparatorPlugin,
  createDailyTickLabelsPlugin,
} from '../src/chart/plugins.js';

function mockCtx() {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    fillRect: vi.fn(),
    fillText: vi.fn(),
    measureText: vi.fn(() => ({ width: 10 })),
    strokeRect: vi.fn(),
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 0,
    font: '',
    textAlign: '',
    textBaseline: '',
  };
}

function mockChart({ tickCount = 7, getPixelForTick = (i) => i * 50 } = {}) {
  return {
    ctx: mockCtx(),
    chartArea: { top: 10, bottom: 200, left: 0, right: 700 },
    scales: {
      x: {
        ticks: Array.from({ length: tickCount }, (_, i) => ({ value: i })),
        getPixelForTick,
        width: tickCount * 50,
        top: 0,
        bottom: 220,
      },
    },
  };
}

const mockStyle = { getPropertyValue: () => '#888' };

describe('createSeparatorPlugin', () => {
  it('returns a plugin object with id and afterDraw hook', () => {
    const p = createSeparatorPlugin({
      stationCount: 3, forecastCount: 4, style: mockStyle, dividerColor: '#ccc',
    });
    expect(p.id).toBe('blockSeparator');
    expect(typeof p.afterDraw).toBe('function');
  });

  it('bails out when xScale is missing (layout not ready)', () => {
    const p = createSeparatorPlugin({
      stationCount: 3, forecastCount: 4, style: mockStyle, dividerColor: '#ccc',
    });
    const chart = { ctx: mockCtx(), chartArea: { top: 0, bottom: 100 }, scales: {} };
    expect(() => p.afterDraw(chart)).not.toThrow();
    expect(chart.ctx.stroke).not.toHaveBeenCalled();
  });

  it('bails out when ticks are empty', () => {
    const p = createSeparatorPlugin({
      stationCount: 3, forecastCount: 4, style: mockStyle, dividerColor: '#ccc',
    });
    const chart = mockChart({ tickCount: 0 });
    p.afterDraw(chart);
    expect(chart.ctx.stroke).not.toHaveBeenCalled();
  });

  it('draws two lines at daily combination (doubled-today framing)', () => {
    const p = createSeparatorPlugin({
      stationCount: 3, forecastCount: 4, style: mockStyle, dividerColor: '#ccc',
    });
    const chart = mockChart({ tickCount: 7 });
    p.afterDraw(chart);
    // computeBlockSeparatorPositions returns [[1,2], [2,3]] for
    // station=3, forecast=4, total=7 in daily mode → two strokes.
    expect(chart.ctx.stroke).toHaveBeenCalledTimes(2);
    expect(chart.ctx.save).toHaveBeenCalledTimes(1);
    expect(chart.ctx.restore).toHaveBeenCalledTimes(1);
  });

  it('draws a single boundary line at hourly combination', () => {
    const p = createSeparatorPlugin({
      stationCount: 3, forecastCount: 4, style: mockStyle, dividerColor: '#ccc',
      mode: 'hourly',
    });
    const chart = mockChart({ tickCount: 7 });
    p.afterDraw(chart);
    expect(chart.ctx.stroke).toHaveBeenCalledTimes(1);
  });

  it('positions strokes at the midpoint between station and forecast pixels', () => {
    // tickCount=7, station=3, forecast=4. computeBlockSeparatorPositions
    // returns [[2, 3]] at hourly. With getPixelForTick(i)=i*50 the
    // midpoint is (2*50 + 3*50)/2 = 125.
    const p = createSeparatorPlugin({
      stationCount: 3, forecastCount: 4, style: mockStyle, dividerColor: '#ccc',
      mode: 'hourly',
    });
    const chart = mockChart({ tickCount: 7 });
    p.afterDraw(chart);
    expect(chart.ctx.moveTo).toHaveBeenCalledWith(125, 10);
    expect(chart.ctx.lineTo).toHaveBeenCalledWith(125, 200);
  });
});

describe('createDailyTickLabelsPlugin', () => {
  const baseConfig = {
    forecast: {
      type: 'daily',
      labels_font_size: 11,
      show_date: true,
    },
  };
  const baseData = {
    dateTime: ['2026-05-04T00:00:00', '2026-05-05T00:00:00', '2026-05-06T00:00:00'],
  };

  it('returns a plugin object with id and afterDraw hook', () => {
    const p = createDailyTickLabelsPlugin({
      config: baseConfig, language: 'en', data: baseData,
      textColor: '#000', backgroundColor: '#fff', style: mockStyle,
      stationCount: 0, doubledToday: false,
    });
    expect(p.id).toBe('dailyTickLabels');
    expect(typeof p.afterDraw).toBe('function');
  });

  it('early-returns at hourly mode (the chart\'s own callback handles labels)', () => {
    const p = createDailyTickLabelsPlugin({
      config: { forecast: { ...baseConfig.forecast, type: 'hourly' } },
      language: 'en', data: baseData,
      textColor: '#000', backgroundColor: '#fff', style: mockStyle,
      stationCount: 0, doubledToday: false,
    });
    const chart = mockChart({ tickCount: 3 });
    p.afterDraw(chart);
    expect(chart.ctx.fillText).not.toHaveBeenCalled();
    expect(chart.ctx.fillRect).not.toHaveBeenCalled();
  });

  it('bails out when xScale is missing', () => {
    const p = createDailyTickLabelsPlugin({
      config: baseConfig, language: 'en', data: baseData,
      textColor: '#000', backgroundColor: '#fff', style: mockStyle,
      stationCount: 0, doubledToday: false,
    });
    const chart = { ctx: mockCtx(), scales: {} };
    expect(() => p.afterDraw(chart)).not.toThrow();
    expect(chart.ctx.fillText).not.toHaveBeenCalled();
  });

  it('paints a background rect and draws weekday + date for each tick', () => {
    const p = createDailyTickLabelsPlugin({
      config: baseConfig, language: 'en', data: baseData,
      textColor: '#000', backgroundColor: '#fff', style: mockStyle,
      stationCount: 0, doubledToday: false,
    });
    const chart = mockChart({ tickCount: 3 });
    p.afterDraw(chart);
    // 3 ticks × 1 background rect each = 3 fillRect calls
    expect(chart.ctx.fillRect).toHaveBeenCalledTimes(3);
    // 3 ticks × (weekday + date) = 6 fillText calls
    expect(chart.ctx.fillText).toHaveBeenCalledTimes(6);
  });

  it('skips one label at the doubled-today seam (combination, daily)', () => {
    const p = createDailyTickLabelsPlugin({
      config: baseConfig, language: 'en', data: baseData,
      textColor: '#000', backgroundColor: '#fff', style: mockStyle,
      stationCount: 1, doubledToday: true,
    });
    const chart = mockChart({ tickCount: 3 });
    p.afterDraw(chart);
    // doubledToday=true and stationCount=1: tick i=0 (stationCount-1)
    // is skipped after the background rect is painted. Background
    // still fills all 3 ticks; text only on 2 ticks → 4 fillText calls.
    expect(chart.ctx.fillRect).toHaveBeenCalledTimes(3);
    expect(chart.ctx.fillText).toHaveBeenCalledTimes(4);
  });

  it('honours show_date: false by drawing only the weekday line', () => {
    const cfg = { forecast: { ...baseConfig.forecast, show_date: false } };
    const p = createDailyTickLabelsPlugin({
      config: cfg, language: 'en', data: baseData,
      textColor: '#000', backgroundColor: '#fff', style: mockStyle,
      stationCount: 0, doubledToday: false,
    });
    const chart = mockChart({ tickCount: 3 });
    p.afterDraw(chart);
    // 3 ticks, weekday only → 3 fillText calls (no date row).
    expect(chart.ctx.fillText).toHaveBeenCalledTimes(3);
  });
});
