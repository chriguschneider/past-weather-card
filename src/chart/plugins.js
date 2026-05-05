// Chart.js plugin factories. Each factory takes the rendering context
// it needs (counts, colours, computed data) explicitly and returns a
// plugin object.
//
// Why factories instead of objects with closures over `this`? The
// previous inline definitions inside _drawChartUnsafe() captured many
// component-instance values via closure. That made it hard to reason
// about which piece of state any given plugin actually depended on, and
// hard to test plugins in isolation. With a factory the dependencies
// become a typed argument list — easier to grep, easier to extend.
//
// All three plugins follow the contract documented in ARCHITECTURE.md:
//   1. Read pixel positions from chart.scales.x / meta.data[i] — never
//      compute them independently.
//   2. Save / restore the canvas context.
//   3. Bail out cleanly when the layout isn't ready.
//   4. Never throw — outer drawChart() will surface a banner but you've
//      lost the chart for the user.

import { computeBlockSeparatorPositions } from '../format-utils.js';

// Frames "today" with vertical separators.
//
// Both blocks active: today appears as a doubled column (station-today |
// forecast-today). Draw a line on the LEFT of station-today and on the
// RIGHT of forecast-today, but NOT between them — keeps Soll/Ist visually
// grouped as one "today" block.
//
// Station-only: line at the left edge of today (rightmost column), so
// today stays enclosed between the line and the chart's right border.
//
// Forecast-only: today is leftmost; the chart's left border already
// encloses it, so a line on the right of today is enough.
export function createSeparatorPlugin({ stationCount, forecastCount, style, dividerColor, mode }) {
  return {
    id: 'blockSeparator',
    afterDraw(chart) {
      const xScale = chart.scales.x;
      if (!xScale || !xScale.ticks) return;
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

// Replaces Chart.js's daily tick labels with our own so we can colour
// weekday and date differently. Chart.js still draws the labels first
// (we need it to, otherwise it doesn't reserve axis height); the plugin
// then masks the whole label area for each tick and repaints weekday on
// top in the primary text colour, date below in --secondary-text-color.
//
// `doubledToday` tells us whether station-today and forecast-today both
// exist — in that case we centre a single label between the two columns
// instead of drawing the same weekday twice side by side.
export function createDailyTickLabelsPlugin({
  config,
  language,
  data,
  textColor,
  backgroundColor,
  style,
  stationCount,
  doubledToday,
}) {
  const showDateRow = config.forecast.show_date !== false;
  return {
    id: 'dailyTickLabels',
    afterDraw(chart) {
      if (config.forecast.type === 'hourly') return;
      const xScale = chart.scales.x;
      if (!xScale || !xScale.ticks) return;
      const c = chart.ctx;
      const fontSize = parseInt(config.forecast.labels_font_size) || 11;
      const lineH = Math.ceil(fontSize * 1.3);
      const weekdayColor = config.forecast.chart_datetime_color || textColor;
      const dateColor = style.getPropertyValue('--secondary-text-color') || weekdayColor;
      const todayMs = (() => { const t = new Date(); t.setHours(0, 0, 0, 0); return t.getTime(); })();
      c.save();
      c.textAlign = 'center';
      c.textBaseline = 'bottom';
      for (let i = 0; i < xScale.ticks.length; i++) {
        const x = xScale.getPixelForTick(i);
        const datetime = data.dateTime[i];
        if (!datetime) continue;
        const d = new Date(datetime);
        const dKey = (() => { const k = new Date(d); k.setHours(0, 0, 0, 0); return k.getTime(); })();
        const isToday = dKey === todayMs;
        const weekday = d.toLocaleString(language, { weekday: 'short' }).toUpperCase();
        const colW = (xScale.width / xScale.ticks.length);
        c.fillStyle = backgroundColor;
        c.fillRect(x - colW / 2, xScale.top, colW, xScale.bottom - xScale.top);

        // Today is a doubled column when both blocks are active. Skip the
        // station-today label (i = stationCount - 1) and draw a single
        // centered label at the boundary in the forecast-today pass.
        if (doubledToday && i === stationCount - 1) continue;
        const labelX = (doubledToday && i === stationCount)
          ? (xScale.getPixelForTick(i - 1) + x) / 2
          : x;

        c.font = `${fontSize}px Helvetica, Arial, sans-serif`;
        if (showDateRow) {
          const dateLabel = d.toLocaleDateString(language, {
            day: '2-digit',
            month: '2-digit',
          });
          c.fillStyle = dateColor;
          c.fillText(dateLabel, labelX, xScale.bottom - 2);
        }
        c.font = `${isToday ? 'bold ' : ''}${fontSize}px Helvetica, Arial, sans-serif`;
        c.fillStyle = weekdayColor;
        const weekdayY = showDateRow ? xScale.bottom - 2 - lineH : xScale.bottom - 2;
        c.fillText(weekday, labelX, weekdayY);
      }
      c.restore();
    },
  };
}

// Renders precipitation labels with the value at the regular
// labels_font_size and the unit at ~50 % so "mm" / "in" doesn't dominate
// narrow bars. Replaces the chart's own datalabel for the precip dataset
// (display:false on that dataset's datalabels block) and reproduces the
// boxed look (chart-bg fill, bar-coloured 1.5 px border).
//
// ── Why a custom plugin and not chartjs-plugin-datalabels? ─────────────
// chartjs-datalabels can render multiline text but applies one font to
// the whole label. We need *different* font sizes for the number and the
// unit on the same line, so the unit doesn't crowd narrow bars. That's
// outside the plugin's API surface — hence this small, contained
// custom plugin alongside chartjs-datalabels (which still drives the
// temperature labels above and below the line). Two mechanisms is a
// deliberate trade-off: full unification would mean reimplementing
// every chartjs-datalabels feature for temperature too.
export function createPrecipLabelPlugin({
  config,
  data,
  precipUnit,
  precipPerBarColor,
  precipColor,
  textColor,
  backgroundColor,
  chartTextColor,
}) {
  return {
    id: 'precipLabel',
    afterDatasetsDraw(chart) {
      const meta = chart.getDatasetMeta(2); // tempHigh, tempLow, precip
      if (!meta || !meta.data) return;
      const c = chart.ctx;
      const baseSize = parseInt(config.forecast.labels_font_size) || 11;
      const smallSize = Math.max(6, Math.round(baseSize * 0.5));
      const padX = 3;
      const padY = 2;
      const gap = 2;
      const fontFamily = 'Helvetica, Arial, sans-serif';
      const showProb = config.forecast.precipitation_type === 'rainfall'
        && config.forecast.show_probability;
      // All labels share a fixed Y line just above the precipitation
      // axis baseline, so they sit in a row at the chart bottom regardless
      // of bar height (matches the original datalabels look).
      const precipAxis = chart.scales.PrecipAxis;
      const baselineY = precipAxis ? precipAxis.getPixelForValue(0) : chart.chartArea.bottom;
      c.save();
      c.textBaseline = 'middle';
      meta.data.forEach((bar, i) => {
        const value = data.precip[i];
        if (value == null || value <= 0) return;
        const number = value > 9 ? `${Math.round(value)}` : value.toFixed(1);
        const probability = data.forecast[i] && data.forecast[i].precipitation_probability;
        const showThisProb = showProb && probability !== undefined && probability !== null;

        c.font = `${baseSize}px ${fontFamily}`;
        const numberW = c.measureText(number).width;
        c.font = `${smallSize}px ${fontFamily}`;
        const unitW = c.measureText(precipUnit).width;
        const lineW = numberW + gap + unitW;

        let probLine = '';
        let probW = 0;
        if (showThisProb) {
          probLine = `${Math.round(probability)} %`;
          c.font = `${smallSize}px ${fontFamily}`;
          probW = c.measureText(probLine).width;
        }

        const contentW = Math.max(lineW, probW);
        const lineH = baseSize;
        const linesGap = showThisProb ? 2 : 0;
        const contentH = lineH + (showThisProb ? smallSize + linesGap : 0);

        const boxW = contentW + 2 * padX;
        const boxH = contentH + 2 * padY;
        const cx = bar.x;
        const boxLeft = cx - boxW / 2;
        // Centre the box on the precip-axis baseline so the zero-line
        // runs through the middle of every label.
        const boxTop = baselineY - boxH / 2;

        c.fillStyle = backgroundColor;
        c.strokeStyle = bar.options && bar.options.borderColor
          ? bar.options.borderColor
          : (precipPerBarColor[i] || precipColor);
        c.lineWidth = 1.5;
        c.fillRect(boxLeft, boxTop, boxW, boxH);
        c.strokeRect(boxLeft, boxTop, boxW, boxH);

        c.fillStyle = chartTextColor || textColor;
        c.textAlign = 'left';
        const lineCenterY = boxTop + padY + lineH / 2;
        const numberX = cx - lineW / 2;
        c.font = `${baseSize}px ${fontFamily}`;
        c.fillText(number, numberX, lineCenterY);
        c.font = `${smallSize}px ${fontFamily}`;
        c.fillText(precipUnit, numberX + numberW + gap, lineCenterY);

        if (showThisProb) {
          c.textAlign = 'center';
          c.fillText(probLine, cx, lineCenterY + lineH / 2 + linesGap + smallSize / 2);
        }
      });
      c.restore();
    },
  };
}
