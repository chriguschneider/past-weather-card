// Block-separator plugin: vertical lines that frame the "today"
// column in combination / station-only / forecast-only modes.
//
// Both blocks active: today appears as a doubled column (station-today
// | forecast-today). Draw a line on the LEFT of station-today and on
// the RIGHT of forecast-today, but NOT between them — keeps Soll/Ist
// visually grouped as one "today" block.
//
// Station-only: line at the left edge of today (rightmost column), so
// today stays enclosed between the line and the chart's right border.
//
// Forecast-only: today is leftmost; the chart's left border already
// encloses it, so a line on the right of today is enough.

import { computeBlockSeparatorPositions, type SeparatorMode } from '../../format-utils.js';
import type { ChartLike, ChartPlugin, CssStyleLike } from './_shared.js';

export interface SeparatorPluginOpts {
  stationCount: number;
  forecastCount: number;
  style: CssStyleLike;
  dividerColor: string;
  mode: SeparatorMode;
}

export function createSeparatorPlugin({
  stationCount,
  forecastCount,
  style,
  dividerColor,
  mode,
}: SeparatorPluginOpts): ChartPlugin {
  return {
    id: 'blockSeparator',
    afterDraw(chart: ChartLike): void {
      const xScale = chart.scales.x;
      if (!xScale?.ticks) return;
      const ticks = xScale.ticks.length;
      const positions = computeBlockSeparatorPositions(stationCount, forecastCount, ticks, mode);
      if (!positions.length) return;
      const c = chart.ctx;
      const { top, bottom } = chart.chartArea;
      const strokeColor = style.getPropertyValue('--secondary-text-color') || dividerColor;
      c.save();
      c.strokeStyle = strokeColor;
      c.lineWidth = 2;
      for (const [leftIdx, rightIdx] of positions) {
        const x = (xScale.getPixelForTick(leftIdx) + xScale.getPixelForTick(rightIdx)) / 2;
        c.beginPath();
        c.moveTo(x, top);
        c.lineTo(x, bottom);
        c.stroke();
      }
      c.restore();
    },
  };
}
