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

import { computeBlockSeparatorPositions, type SeparatorMode } from '../format-utils.js';

/** Subset of the Chart.js Scale we touch. Avoids a chart.js type
 *  import (Chart 4 has its own typings but they require resolving the
 *  whole `Chart<...>` generic, which is unnecessary noise for plugin
 *  authoring at this layer). */
export interface ChartScaleLike {
  ticks: Array<{ value?: number; label?: string }>;
  top: number;
  bottom: number;
  width: number;
  getPixelForTick(idx: number): number;
  getPixelForValue?(value: number): number;
}

/** Subset of a Chart.js dataset bar element. */
export interface ChartBarLike {
  x: number;
  y: number;
  options?: { borderColor?: string };
}

/** Subset of a Chart.js dataset metadata object. */
export interface ChartMetaLike {
  data?: ChartBarLike[];
}

/** Subset of the Chart instance we use from inside plugins. The
 *  generic `data` field is intentionally untyped — the `data` prop our
 *  plugins read from is the per-render bag we passed in from the
 *  factory, not Chart.js's internal data. */
export interface ChartLike {
  scales: { x?: ChartScaleLike; PrecipAxis?: ChartScaleLike } & Record<string, ChartScaleLike | undefined>;
  ctx: CanvasRenderingContext2D;
  chartArea: { top: number; bottom: number; left: number; right: number };
  getDatasetMeta(idx: number): ChartMetaLike | null;
}

/** A Chart.js plugin object — a subset that matches the three plugins
 *  in this module. Chart.js will accept extra fields like `id`, but
 *  the typed surface here is only what we use. */
export interface ChartPlugin {
  id: string;
  afterDraw?(chart: ChartLike): void;
  afterDatasetsDraw?(chart: ChartLike): void;
}

/** CSS-style accessor — typically a `getComputedStyle()` result, but
 *  any object with a `getPropertyValue` works. */
export interface CssStyleLike {
  getPropertyValue(name: string): string;
}

/** Per-render data bag the plugins read column-aligned values from.
 *  All arrays are positional (one entry per chart x-tick). */
export interface PluginRenderData {
  dateTime?: ReadonlyArray<string | undefined>;
  precip?: ReadonlyArray<number | null | undefined>;
  sunshine?: ReadonlyArray<number | null | undefined> | null;
}

/** Subset of the card config the plugins read. Loosely typed because
 *  the full card-config typing (which has the editor's hierarchical
 *  shape) is out of scope at this layer. */
export interface PluginCardConfig {
  forecast: {
    type?: 'daily' | 'hourly' | 'today';
    show_date?: boolean;
    labels_font_size?: number | string;
    chart_datetime_color?: string;
  };
  [k: string]: unknown;
}

export interface SeparatorPluginOpts {
  stationCount: number;
  forecastCount: number;
  style: CssStyleLike;
  dividerColor: string;
  mode: SeparatorMode;
}

/** Frames "today" with vertical separators.
 *
 *  Both blocks active: today appears as a doubled column (station-today
 *  | forecast-today). Draw a line on the LEFT of station-today and on
 *  the RIGHT of forecast-today, but NOT between them — keeps Soll/Ist
 *  visually grouped as one "today" block.
 *
 *  Station-only: line at the left edge of today (rightmost column), so
 *  today stays enclosed between the line and the chart's right border.
 *
 *  Forecast-only: today is leftmost; the chart's left border already
 *  encloses it, so a line on the right of today is enough. */
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

export interface DailyTickLabelsPluginOpts {
  config: PluginCardConfig;
  language: string;
  data: PluginRenderData;
  textColor: string;
  style: CssStyleLike;
  stationCount: number;
  doubledToday: boolean;
  sunshineLabelBand?: number;
}

/** Replaces Chart.js's tick labels for all three forecast modes. Chart.js
 *  still reserves the axis height (the tick callback returns empty
 *  strings — see chart/draw.ts), and this plugin paints the actual labels
 *  on top:
 *
 *    - daily:  weekday + 2-digit date, centred per column. Doubled-today
 *              framing collapses station-today + forecast-today into a
 *              single boundary label.
 *    - today / hourly: 24-hour time per column (left-aligned). Date label
 *              only on the leftmost-visible column and on midnight
 *              columns; midnight columns also draw a bold day-boundary
 *              line from the chart bottom up to the date row. */
export function createDailyTickLabelsPlugin({
  config,
  language,
  data,
  textColor,
  style,
  stationCount,
  doubledToday,
  sunshineLabelBand = 0,
}: DailyTickLabelsPluginOpts): ChartPlugin {
  const showDateRow = config.forecast.show_date !== false;

  // Per-tick value cache. The plugin redraws on every scroll event in
  // 'hourly' mode (so the leftmost-visible date label tracks the
  // viewport). Without this cache we'd construct 168 Date objects and
  // make 168+ Intl calls each frame — Intl is 10–50× slower than
  // primitive ops, so that's the dominant cost in the redraw. The
  // cache key is the dataIdx (a number into data.dateTime); since the
  // plugin is rebuilt whenever data.dateTime changes (orchestrator
  // recreates plugins on every dataset refresh), the closure-level
  // cache is automatically invalidated by re-instantiation. Fields
  // computed once and reused on every redraw:
  //   - hour, minutes (for isMidnight check)
  //   - 24-hour time string
  //   - short date string ("May 6")  — for hourly/today branch
  //   - 2-digit date string ("06.05.") — for daily branch
  //   - dKey (midnight ms) — for isToday comparison in daily branch
  interface TickInfo {
    hour: number;
    minutes: number;
    isMidnight: boolean;
    time24: string;
    dateShort: string;
    date2Digit: string;
    weekday: string;
    dKey: number;
  }
  const tickCache = new Map<number, TickInfo>();
  // Pre-instantiate Intl.DateTimeFormat — caching the formatter is
  // ~3× faster than calling toLocaleTimeString/toLocaleDateString
  // each time (those instantiate a fresh formatter under the hood).
  const timeFmt = new Intl.DateTimeFormat(language, {
    hour12: false, hour: '2-digit', minute: '2-digit',
  });
  const dateShortFmt = new Intl.DateTimeFormat(language, {
    day: 'numeric', month: 'short',
  });
  const date2DigitFmt = new Intl.DateTimeFormat(language, {
    day: '2-digit', month: '2-digit',
  });
  const weekdayFmt = new Intl.DateTimeFormat(language, { weekday: 'short' });
  function getTickInfo(dataIdx: number): TickInfo | null {
    const cached = tickCache.get(dataIdx);
    if (cached) return cached;
    const datetime = data.dateTime ? data.dateTime[dataIdx] : undefined;
    if (!datetime) return null;
    const d = new Date(datetime);
    const hour = d.getHours();
    const minutes = d.getMinutes();
    const dKeyDate = new Date(d); dKeyDate.setHours(0, 0, 0, 0);
    const info: TickInfo = {
      hour,
      minutes,
      isMidnight: hour === 0 && minutes === 0,
      time24: timeFmt.format(d),
      dateShort: dateShortFmt.format(d),
      date2Digit: date2DigitFmt.format(d),
      weekday: weekdayFmt.format(d).toUpperCase(),
      dKey: dKeyDate.getTime(),
    };
    tickCache.set(dataIdx, info);
    return info;
  }

  return {
    id: 'dailyTickLabels',
    afterDraw(chart: ChartLike): void {
      const xScale = chart.scales.x;
      if (!xScale || !xScale.ticks) return;
      const c = chart.ctx;
      const fontSize = parseInt(String(config.forecast.labels_font_size)) || 11;
      const lineH = Math.ceil(fontSize * 1.3);
      const weekdayColor = config.forecast.chart_datetime_color || textColor;
      const dateColor = style.getPropertyValue('--secondary-text-color') || weekdayColor;

      // 'today' and 'hourly' share the time-based rendering: 24-hour
      // format, left-aligned per column, with a stacked date label
      // (BOLD, primary text colour) on midnight columns. 'today'
      // additionally draws a thick day-boundary stroke; 'hourly'
      // is dense enough that just the date label suffices.
      if (config.forecast.type === 'today' || config.forecast.type === 'hourly') {
        c.save();
        c.textAlign = 'left';
        c.textBaseline = 'bottom';
        const colW = xScale.width / xScale.ticks.length;
        // For 'hourly' the chart can scroll horizontally inside an
        // outer wrapper; the canvas is wider than the viewport. To
        // mark the LEFTMOST VISIBLE tick (not the leftmost data
        // point, which may be scrolled off-screen), find the first
        // tick whose pixel position exceeds the wrapper's scrollLeft.
        // 'today' has no scroll, so the leftmost visible == i === 0.
        let leftmostVisibleIdx = 0;
        if (config.forecast.type === 'hourly') {
          // Walk up from the canvas to find the .forecast-scroll
          // wrapper (canvas → chart-container → forecast-scroll).
          // chart.canvas's wrapper hierarchy isn't fixed depth, so
          // closest('.forecast-scroll.scrolling') is the safest pick.
          const canvas = (chart as { canvas?: HTMLElement | null }).canvas || null;
          const wrapper = canvas
            ? (canvas.closest('.forecast-scroll.scrolling'))
            : null;
          const scrollLeft = wrapper ? wrapper.scrollLeft : 0;
          // Pixel positions in the canvas/scale coordinates start at
          // chartArea.left. With scroll, the visible viewport spans
          // [scrollLeft, scrollLeft + wrapper.clientWidth] in canvas
          // coords (scrollLeft applies to the canvas's parent which
          // is canvas-aligned). The leftmost VISIBLE tick is the
          // first tick whose pixel >= scrollLeft.
          for (let i = 0; i < xScale.ticks.length; i++) {
            if (xScale.getPixelForTick(i) >= scrollLeft) {
              leftmostVisibleIdx = i;
              break;
            }
          }
        }
        // Shift the time/date row up by the sunshine label band so
        // the per-column "Xh" boxes drawn by createSunshineLabelPlugin
        // don't overlap. Layout from top to bottom:
        //   1. Date (only on midnight columns)
        //   2. Time
        //   3. Sunshine "Xh" box (drawn by the sibling plugin)
        const dateBaseY = xScale.bottom - 2 - sunshineLabelBand;
        // Small horizontal gap so the leading glyph doesn't sit
        // flush against the column boundary.
        const labelGap = 4;
        for (let i = 0; i < xScale.ticks.length; i++) {
          const x = xScale.getPixelForTick(i);
          const colLeft = x - colW / 2;
          const labelX = colLeft + labelGap;
          // chart.js auto-skips overlapping ticks at hourly: the
          // visible tick array's `tick.value` is the underlying data
          // INDEX, while `i` is just the position within the visible
          // subset. Use tick.value to look up the per-bar datetime.
          const tick = xScale.ticks[i];
          const dataIdx = (tick && typeof tick.value === 'number') ? tick.value : i;
          const info = getTickInfo(dataIdx);
          if (!info) continue;
          // No mask needed — chart.js's tick callback returns '' for
          // 'today' / 'hourly' (see chart/draw.ts), leaving the
          // reserved axis box empty for our overlay to draw into.
          // Date appears ONLY on the leftmost visible column and on
          // any midnight column (first column of a new calendar
          // day). Other columns show the time alone — the date
          // carries over from the most recent labelled column.
          const showDate = i === leftmostVisibleIdx || info.isMidnight;
          if (info.isMidnight) {
            // Bold day-boundary marker at midnight columns: thick
            // vertical line from chart bottom up to the TOP of the
            // date text, anchored at the column's LEFT edge. Same
            // visual cue in 'today' and 'hourly' so day transitions
            // read consistently across both views.
            c.save();
            c.strokeStyle = weekdayColor;
            c.lineWidth = 2;
            c.beginPath();
            c.moveTo(colLeft, chart.chartArea.bottom);
            c.lineTo(colLeft, dateBaseY - lineH - fontSize);
            c.stroke();
            c.restore();
          }
          if (showDate) {
            c.font = `bold ${fontSize}px Helvetica, Arial, sans-serif`;
            c.fillStyle = weekdayColor;
            c.fillText(info.dateShort, labelX, dateBaseY - lineH);
          }
          c.font = `${fontSize}px Helvetica, Arial, sans-serif`;
          c.fillStyle = weekdayColor;
          c.fillText(info.time24, labelX, dateBaseY);
        }
        c.restore();
        return;
      }

      const todayMs = (() => { const t = new Date(); t.setHours(0, 0, 0, 0); return t.getTime(); })();
      c.save();
      c.textAlign = 'center';
      c.textBaseline = 'bottom';
      // sunshineLabelBand reserves a strip at the bottom of the axis
      // area for the sunshine "Xh" box. Date and weekday move UP by
      // the band height so the order from top to bottom stays:
      // weekday → date → sunshine box → chart data. Hoisted out of
      // the loop — same value for every tick.
      const dateBaseY = xScale.bottom - 2 - sunshineLabelBand;
      const weekdayY = showDateRow ? dateBaseY - lineH : dateBaseY;
      for (let i = 0; i < xScale.ticks.length; i++) {
        const info = getTickInfo(i);
        if (!info) continue;
        // No mask needed — chart.js's tick callback returns ['', '']
        // for daily mode (see chart/draw.ts), so the reserved axis
        // box stays empty for our weekday + date overlay below.

        // Today is a doubled column when both blocks are active. Skip the
        // station-today label (i = stationCount - 1) and draw a single
        // centered label at the boundary in the forecast-today pass.
        if (doubledToday && i === stationCount - 1) continue;
        const x = xScale.getPixelForTick(i);
        const labelX = (doubledToday && i === stationCount)
          ? (xScale.getPixelForTick(i - 1) + x) / 2
          : x;
        const isToday = info.dKey === todayMs;

        c.font = `${fontSize}px Helvetica, Arial, sans-serif`;
        if (showDateRow) {
          c.fillStyle = dateColor;
          c.fillText(info.date2Digit, labelX, dateBaseY);
        }
        c.font = `${isToday ? 'bold ' : ''}${fontSize}px Helvetica, Arial, sans-serif`;
        c.fillStyle = weekdayColor;
        c.fillText(info.weekday, labelX, weekdayY);
      }
      c.restore();
    },
  };
}

export interface PrecipLabelPluginOpts {
  config: PluginCardConfig;
  data: PluginRenderData;
  precipUnit: string;
  precipPerBarColor: ReadonlyArray<string>;
  precipColor: string;
  textColor: string;
  backgroundColor: string;
  chartTextColor?: string;
}

/** Renders precipitation labels with the value at the regular
 *  labels_font_size and the unit at ~50 % so "mm" / "in" doesn't
 *  dominate narrow bars. Replaces the chart's own datalabel for the
 *  precip dataset (display:false on that dataset's datalabels block)
 *  and reproduces the boxed look (chart-bg fill, bar-coloured 1.5 px
 *  border).
 *
 *  ── Why a custom plugin and not chartjs-plugin-datalabels? ─────────
 *  chartjs-datalabels can render multiline text but applies one font
 *  to the whole label. We need *different* font sizes for the number
 *  and the unit on the same line, so the unit doesn't crowd narrow
 *  bars. That's outside the plugin's API surface — hence this small,
 *  contained custom plugin alongside chartjs-datalabels (which still
 *  drives the temperature labels above and below the line). Two
 *  mechanisms is a deliberate trade-off: full unification would mean
 *  reimplementing every chartjs-datalabels feature for temperature
 *  too. */
export function createPrecipLabelPlugin({
  config,
  data,
  precipUnit,
  precipPerBarColor,
  precipColor,
  textColor,
  backgroundColor,
  chartTextColor,
}: PrecipLabelPluginOpts): ChartPlugin {
  return {
    id: 'precipLabel',
    afterDatasetsDraw(chart: ChartLike): void {
      const meta = chart.getDatasetMeta(2); // tempHigh, tempLow, precip
      if (!meta || !meta.data) return;
      const c = chart.ctx;
      const baseSize = parseInt(String(config.forecast.labels_font_size)) || 11;
      const smallSize = Math.max(6, Math.round(baseSize * 0.5));
      const padX = 3;
      const padY = 2;
      const gap = 2;
      const fontFamily = 'Helvetica, Arial, sans-serif';
      // All labels share a fixed Y line just above the precipitation
      // axis baseline, so they sit in a row at the chart bottom regardless
      // of bar height (matches the original datalabels look).
      const precipAxis = chart.scales.PrecipAxis;
      const baselineY = precipAxis && precipAxis.getPixelForValue
        ? precipAxis.getPixelForValue(0)
        : chart.chartArea.bottom;
      c.save();
      c.textBaseline = 'middle';
      // Centre the box on the COLUMN, not on the bar — when sunshine is
      // enabled, chart.js auto-groups precip into the left half of the
      // column and we still want the mm label visually centered under
      // the whole column. Falls back to bar.x if the x-scale isn't
      // ready (defensive — chart-internal callers always have one).
      const xScale = chart.scales.x;
      meta.data.forEach((bar: ChartBarLike, i: number) => {
        const value = data.precip ? data.precip[i] : null;
        if (value == null || value <= 0) return;
        const number = value > 9 ? `${Math.round(value)}` : value.toFixed(1);

        c.font = `${baseSize}px ${fontFamily}`;
        const numberW = c.measureText(number).width;
        c.font = `${smallSize}px ${fontFamily}`;
        const unitW = c.measureText(precipUnit).width;
        const lineW = numberW + gap + unitW;

        const lineH = baseSize;
        const boxW = lineW + 2 * padX;
        const boxH = lineH + 2 * padY;
        const cx = xScale && typeof xScale.getPixelForTick === 'function'
          ? xScale.getPixelForTick(i)
          : bar.x;
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
      });
      c.restore();
    },
  };
}

export interface SunshineLabelPluginOpts {
  config: PluginCardConfig;
  data: PluginRenderData;
  textColor: string;
  backgroundColor: string;
  chartTextColor?: string;
  sunshineColor: string;
  sunshinePerBarColor: ReadonlyArray<string>;
  bandHeight?: number;
}

/** Renders the sunshine-hours label per column at the top of the
 *  chart, just below the weekday/date row in the x-axis area.
 *  Standalone from chartjs-plugin-datalabels (which we already use for
 *  temperature) so the label can sit OUTSIDE the data area — between
 *  xScale.bottom and chartArea.top — without being clipped by the plot
 *  region.
 *
 *  Reads from `data.sunshine` (hours, may be null) and `data.dayLength`
 *  (hours, may be null). Skips columns where either is missing — the
 *  dataset still draws an empty (zero-height) bar there silently.
 *
 *  `Xh` rendered as the integer hours followed by 'h' at the same
 *  font size as the precip number/unit pair, but as a single token so
 *  it stays compact even on narrow columns. */
export function createSunshineLabelPlugin({
  config,
  data,
  textColor,
  backgroundColor,
  chartTextColor,
  sunshineColor,
  sunshinePerBarColor,
  bandHeight,
}: SunshineLabelPluginOpts): ChartPlugin {
  return {
    id: 'sunshineLabel',
    // afterDraw (not afterDatasetsDraw) so this runs *after* the
    // dailyTickLabelsPlugin's afterDraw — that plugin fills the entire
    // x-axis area with backgroundColor to mask Chart.js's default tick
    // labels, which would otherwise clobber our "Xh" labels here.
    afterDraw(chart: ChartLike): void {
      const xScale = chart.scales.x;
      if (!xScale || !xScale.ticks) return;
      const c = chart.ctx;
      const baseSize = parseInt(String(config.forecast.labels_font_size)) || 11;
      const fontFamily = 'Helvetica, Arial, sans-serif';
      // Draw inside the bottom strip of the x-axis box that draw.js's
      // afterFit reserved for us. Vertically centred in that strip;
      // horizontally on the column tick.
      const reservedH = Number.isFinite(bandHeight) && (bandHeight as number) > 0
        ? bandHeight as number
        : Math.max(14, baseSize + 4);
      // Centre the box on the bottom strip of the now-extended axis
      // box (where dailyTickLabelsPlugin has reserved this band by
      // shifting weekday + date upward).
      const labelY = xScale.bottom - reservedH / 2;
      c.save();
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      const padX = 3;
      const padY = 1;
      const lineH = baseSize;
      for (let i = 0; i < xScale.ticks.length; i++) {
        const value = data.sunshine ? data.sunshine[i] : null;
        if (value == null) continue;
        // Skip zero-sun days so the band stays calm (the bar is empty
        // there too).
        if (value <= 0) continue;
        // ≥ 9.5 h: round to integer (decimals are noise at that magnitude,
        // and "13.0h" is uglier than "13h" in a narrow column).
        // < 9.5 h: one decimal, but strip a trailing .0 so "8.0h" → "8h".
        const text = (() => {
          if (value > 9) return `${Math.round(value)}h`;
          const rounded = Math.round(value * 10) / 10;
          return rounded % 1 === 0
            ? `${Math.round(rounded)}h`
            : `${rounded.toFixed(1)}h`;
        })();

        const x = xScale.getPixelForTick(i);
        c.font = `${baseSize}px ${fontFamily}`;
        const textW = c.measureText(text).width;
        const boxW = textW + 2 * padX;
        const boxH = lineH + 2 * padY;
        const boxLeft = x - boxW / 2;
        const boxTop = labelY - boxH / 2;

        // Same boxed look as the precipitation label: chart-bg fill
        // with the accent-colour border (sunshineColor here, precipColor
        // in precipLabelPlugin). Per-column colour mirrors the bar so
        // forecast columns get the lightened (45 %-alpha) tone, matching
        // how precipLabelPlugin handles its own forecast colouring.
        const stroke = (Array.isArray(sunshinePerBarColor) && sunshinePerBarColor[i])
          || sunshineColor || textColor;
        c.fillStyle = backgroundColor;
        c.strokeStyle = stroke;
        c.lineWidth = 1.5;
        c.fillRect(boxLeft, boxTop, boxW, boxH);
        c.strokeRect(boxLeft, boxTop, boxW, boxH);

        c.fillStyle = chartTextColor || textColor;
        c.fillText(text, x, labelY);
      }
      c.restore();
    },
  };
}
