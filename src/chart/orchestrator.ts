// Chart orchestration: takes the card's `forecasts` + config and
// produces a configured Chart.js instance. Lifted out of main.js
// in v1.1 — was the largest method on the card class (~290 LOC of
// dataset / plugin / segment-options assembly intermixed with
// canvas lookup and Chart.defaults global mutation).
//
// Responsibilities:
//   - normalize the config (forecast.type fallback for typo'd YAML)
//   - locate the canvas in card.renderRoot, RAF-retry if Lit hasn't
//     committed it yet
//   - destroy any previous Chart.js instance so we don't leak handles
//   - read live theme tokens from getComputedStyle(document.body)
//   - compute precip max, station/forecast gap framing, sunshine
//     fraction data, dataset segment-options (transparent boundary
//     at daily combination, dashed at hourly combination), per-bar
//     colour palettes
//   - assemble dataset[]: tempHigh, tempLow (hidden when hourly),
//     precip, optional sunshine
//   - assemble plugins[]: separator, dailyTickLabels, precipLabel,
//     optional sunshineLabel (gated on daily + show_sunshine)
//   - call buildChart() in chart/draw.ts for the actual instance
//
// Coupling to the card instance is captured by the `CardLike` interface
// below — the union of card fields and methods this function reads or
// writes. Keeping it as a structural interface (rather than importing
// the LitElement class) avoids a circular type dependency between
// main.ts and this module.

import { Chart } from 'chart.js';
import { normalizeForecastMode } from '../forecast-utils.js';
import { lightenColor } from '../format-utils.js';
import { sunshineFractions } from '../sunshine-source.js';
import { buildChart } from './draw.js';
import {
  createSeparatorPlugin,
  createDailyTickLabelsPlugin,
  createPrecipLabelPlugin,
  createSunshineLabelPlugin,
  type ChartPlugin,
  type PluginCardConfig,
  type PluginRenderData,
} from './plugins.js';

/** Per-render data bag — what `card.computeForecastData()` returns.
 *  All arrays are positional. `tempLowAvailable` lets the caller hide
 *  the second line dataset entirely when the upstream forecast had no
 *  `templow` field (hourly mode). */
export interface ForecastChartData extends PluginRenderData {
  tempHigh: ReadonlyArray<number | null | undefined>;
  tempLow: ReadonlyArray<number | null | undefined>;
  tempLowAvailable: boolean;
  precip: ReadonlyArray<number | null | undefined>;
  dateTime: ReadonlyArray<string | undefined>;
  sunshine?: ReadonlyArray<number | null | undefined> | null;
  dayLength?: ReadonlyArray<number | null | undefined> | null;
}

/** Subset of the card config the orchestrator reads. */
export interface OrchestratorConfig extends PluginCardConfig {
  forecast: PluginCardConfig['forecast'] & {
    show_sunshine?: boolean;
    sunshine_color?: string;
    precipitation_color?: string;
    precip_bar_size?: number;
    style?: string;
    chart_text_color?: string;
    temperature1_color?: string;
    temperature2_color?: string;
    disable_animation?: boolean;
  };
  use_12hour_format?: boolean;
}

/** Structural interface for the card instance the orchestrator
 *  cooperates with. `forecastChart` is read AND written; `_chartPhase`
 *  is set at the boundaries of the long-running phases. */
export interface CardLike {
  forecasts: ReadonlyArray<unknown> | null;
  forecastChart: Chart | null;
  renderRoot: ParentNode;
  _hass: { config: { unit_system: { temperature: string; length: string } } };
  _stationCount?: number;
  _forecastCount?: number;
  _chartPhase: string | null;
  computeForecastData(): ForecastChartData;
  ll(key: string): string | Record<string, string>;
  drawChart(): void;
}

/** Args bag — `forecastItems` and `weather` are kept in the contract
 *  for future callers and to mirror the destructure shape used in
 *  main.ts. */
export interface DrawChartArgs {
  config: OrchestratorConfig;
  language: string;
  weather?: unknown;
  forecastItems?: unknown;
}

interface SegmentCtx {
  p0DataIndex: number;
  p1DataIndex: number;
}

interface DataLabelsCtx {
  dataset: { data: ReadonlyArray<unknown> };
  dataIndex: number;
}

export function drawChartUnsafe(card: CardLike, args: DrawChartArgs | null): unknown[] | undefined {
  const { config: rawConfig, language, weather, forecastItems } = args || (card as unknown as DrawChartArgs);
  // Silence "unused" lint — `weather` is part of the destructure-from-`card`
  // contract and may be needed by future callers (and was in the prior
  // signature). Discarding here keeps the destructure shape stable.
  void weather;
  void forecastItems;
  if (!card.forecasts || !card.forecasts.length) {
    return [];
  }
  // All downstream references read `config` — by binding it to the
  // normalized result we get one consistent view of the mode (and
  // forecast.type fallback to 'daily' for typo'd YAML) across the
  // chart code path.
  const { config } = normalizeForecastMode(rawConfig);

  const chartCanvas = card.renderRoot && (card.renderRoot as ParentNode).querySelector('#forecastChart');
  if (!chartCanvas) {
    console.error('Canvas element not found:', card.renderRoot);
    return undefined;
  }

  if (card.forecastChart) {
    card.forecastChart.destroy();
  }
  card._chartPhase = 'compute';
  const tempUnit = card._hass.config.unit_system.temperature;
  const lengthUnit = card._hass.config.unit_system.length;
  const llUnits = card.ll('units') as Record<string, string>;
  const precipUnit = lengthUnit === 'km' ? llUnits['mm'] : llUnits['in'];
  const data = card.computeForecastData();

  const style = getComputedStyle(document.body);
  const backgroundColor = style.getPropertyValue('--card-background-color');
  const textColor = style.getPropertyValue('--primary-text-color');
  const dividerColor = style.getPropertyValue('--divider-color');
  const canvas = (card.renderRoot as ParentNode).querySelector('#forecastChart') as HTMLCanvasElement | null;
  if (!canvas) {
    requestAnimationFrame(() => card.drawChart());
    return undefined;
  }

  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;

  // 'today' is hourly granularity (per-hour bars), same precip scale
  // as 'hourly'. 'daily' aggregates over the full day, scale is wider.
  const isHourlyish = config.forecast.type === 'hourly' || config.forecast.type === 'today';
  let precipMax: number;
  if (isHourlyish) {
    precipMax = lengthUnit === 'km' ? 4 : 1;
  } else {
    precipMax = lengthUnit === 'km' ? 20 : 1;
  }

  // chart.js Chart.defaults are nested optional objects in the type
  // definitions; runtime they're plain objects. Cast once at the top
  // so subsequent assignments don't each need their own.
  const defaults = Chart.defaults as unknown as {
    color: string;
    scale: { grid: { color: string } };
    elements: {
      line: { fill: boolean; tension: number; borderWidth: number };
      point: { radius: number; hitRadius: number };
    };
  };
  defaults.color = textColor;
  defaults.scale.grid.color = dividerColor;
  defaults.elements.line.fill = false;
  defaults.elements.line.tension = 0.3;
  defaults.elements.line.borderWidth = 1.5;
  defaults.elements.point.radius = 2;
  defaults.elements.point.hitRadius = 10;

  // Boundary handling between station and forecast blocks differs by mode:
  //
  // - Daily combination: "today" appears as a doubled column (station-today
  //   on the left, forecast-today on the right). The segment between those
  //   two columns is suppressed (transparent) — measured vs. predicted of
  //   the SAME day shouldn't visually flow into each other.
  //
  // - Hourly combination: there's no doubled hour. Station and forecast
  //   meet at "now" with one bar each side. The boundary segment is
  //   drawn DASHED — same visual cue we use for the rest of the forecast
  //   block, but applied to the transition itself, so the user reads the
  //   line as "measured up to now → predicted from now on" without a
  //   confusing transparent gap.
  const stationCountForGap = card._stationCount || 0;
  const forecastCountForGap = card._forecastCount || 0;
  const hasBothBlocks = stationCountForGap > 0 && forecastCountForGap > 0;
  const gapStartIdx = stationCountForGap - 1;
  const isHourlyCombo = hasBothBlocks && isHourlyish;
  const isBoundarySegment = (segCtx: SegmentCtx): boolean =>
    segCtx.p0DataIndex === gapStartIdx && segCtx.p1DataIndex === gapStartIdx + 1;
  const segmentSkip = (segCtx: SegmentCtx): string | undefined => {
    if (!hasBothBlocks) return undefined;
    if (!isHourlyCombo && isBoundarySegment(segCtx)) return 'transparent';
    return undefined;
  };
  const segmentDash = (segCtx: SegmentCtx): number[] | undefined => {
    if (segCtx.p0DataIndex >= stationCountForGap && forecastCountForGap > 0) {
      return [6, 4];
    }
    if (isHourlyCombo && isBoundarySegment(segCtx)) return [6, 4];
    return undefined;
  };
  const tempSegmentOpts = { borderColor: segmentSkip, borderDash: segmentDash };

  const precipColor = config.forecast.precipitation_color as string;
  const precipColorLight = lightenColor(precipColor) as string;
  const precipPerBarColor: string[] = (data.precip || []).map(
    (_v, i) => (hasBothBlocks && i >= stationCountForGap) ? precipColorLight
            : (!hasBothBlocks && stationCountForGap === 0) ? precipColorLight
            : precipColor,
  );

  // Sunshine row toggle. Works in both daily and hourly modes — the
  // OpenMeteoSunshineSource fetches `daily=…` and (when in hourly mode)
  // also `hourly=…` from Open-Meteo in a single call, and
  // attachSunshine matches each entry's datetime against the right
  // array. The chart adds a second bar dataset; Chart.js auto-groups
  // precip + sunshine side-by-side per column (precip left half,
  // sunshine right half).
  const showSunshine = config.forecast.show_sunshine === true;
  // Per-column "Xh" / "0.5h" labels: shown for daily and 'today'
  // (8 wide columns), suppressed for 'hourly' where 168 narrow
  // columns over a 7-day window would crowd labels (the bar height
  // alone encodes the value at that density).
  const showSunshineLabels = showSunshine && config.forecast.type !== 'hourly';
  const sunshineColor = config.forecast.sunshine_color || 'rgba(255, 215, 0, 1.0)';
  const sunshineColorLight = lightenColor(sunshineColor) as string;
  const sunshinePerBarColor: string[] = (data.sunshine || []).map(
    (_v, i) => (hasBothBlocks && i >= stationCountForGap) ? sunshineColorLight
            : (!hasBothBlocks && stationCountForGap === 0) ? sunshineColorLight
            : sunshineColor,
  );
  // Convert raw hours into 0..1 fractions of day length. Null values
  // pass through so the bar slot stays empty for missing data.
  const sunshineFractionData = sunshineFractions(
    data.sunshine ?? [],
    data.dayLength,
  );

  // Datasets are loose-typed: chart.js's `ChartDataset` is generic over
  // chart type and dataset-type which forces a discriminated-union
  // narrowing at every push. The runtime contract is what matters here.
  const datasets: Array<Record<string, unknown>> = [
    {
      label: card.ll('tempHi'),
      type: 'line',
      data: data.tempHigh,
      yAxisID: 'TempAxis',
      borderColor: config.forecast.temperature1_color,
      backgroundColor: config.forecast.temperature1_color,
      segment: tempSegmentOpts,
    },
    {
      label: card.ll('tempLo'),
      type: 'line',
      data: data.tempLow,
      yAxisID: 'TempAxis',
      borderColor: config.forecast.temperature2_color,
      backgroundColor: config.forecast.temperature2_color,
      segment: tempSegmentOpts,
      hidden: !data.tempLowAvailable,
    },
    {
      label: card.ll('precip'),
      type: 'bar',
      data: data.precip,
      yAxisID: 'PrecipAxis',
      borderColor: precipPerBarColor,
      backgroundColor: precipPerBarColor,
      barPercentage: (config.forecast.precip_bar_size as number) / 100,
      categoryPercentage: 1.0,
      datalabels: {
        display: () => false,
        textAlign: 'center',
        textBaseline: 'middle',
        align: 'top',
        anchor: 'start',
        offset: -10,
      },
    },
  ];

  if (showSunshine) {
    datasets.push({
      label: card.ll('sunshine'),
      type: 'bar',
      data: sunshineFractionData,
      yAxisID: 'SunshineAxis',
      borderColor: sunshinePerBarColor,
      backgroundColor: sunshinePerBarColor,
      barPercentage: 1.0,
      categoryPercentage: 1.0,
      datalabels: { display: () => false },
    });
  }

  const chart_text_color = (config.forecast.chart_text_color === 'auto')
    ? textColor
    : config.forecast.chart_text_color;

  if (config.forecast.style === 'style2') {
    const todayBoldFont = (context: DataLabelsCtx) => {
      const dt = data.dateTime[context.dataIndex];
      const k = dt ? new Date(dt) : null;
      if (k) k.setHours(0, 0, 0, 0);
      const t = new Date(); t.setHours(0, 0, 0, 0);
      const isToday = !!(k && k.getTime() === t.getTime());
      return {
        size: parseInt(String(config.forecast.labels_font_size)) + 1,
        lineHeight: 0.7,
        weight: isToday ? 'bold' : 'normal',
      };
    };

    datasets[0].datalabels = {
      display: () => true,
      formatter: (_v: unknown, context: DataLabelsCtx) => context.dataset.data[context.dataIndex] + '°',
      align: 'top',
      anchor: 'center',
      backgroundColor: 'transparent',
      borderColor: 'transparent',
      color: chart_text_color || config.forecast.temperature1_color,
      font: todayBoldFont,
    };

    datasets[1].datalabels = {
      display: () => true,
      formatter: (_v: unknown, context: DataLabelsCtx) => context.dataset.data[context.dataIndex] + '°',
      align: 'bottom',
      anchor: 'center',
      backgroundColor: 'transparent',
      borderColor: 'transparent',
      color: chart_text_color || config.forecast.temperature2_color,
      font: todayBoldFont,
    };
  }

  const stationCount = card._stationCount || 0;
  const forecastCount = card._forecastCount || 0;
  const isHourly = isHourlyish;
  // doubled-today only makes sense at daily — at hourly / today station
  // and forecast meet at "now" with a single separator line.
  const doubledToday = !isHourly && stationCount > 0 && forecastCount > 0;
  // When sunshine is on, draw.ts grows the x-axis box by sunshineLabelBand
  // pixels via afterFit. dailyTickLabelsPlugin then shifts weekday + date
  // up by that amount so the new bottom strip is free for the sunshine
  // box. When sunshine is off, sunshineLabelBand stays 0 and chart
  // layout is byte-identical to v0.8.
  const labelsBaseSize = parseInt(String(config.forecast.labels_font_size)) || 11;
  const sunshineLabelBand = showSunshineLabels ? Math.max(16, labelsBaseSize + 6) : 0;
  const separatorPlugin = createSeparatorPlugin({
    stationCount, forecastCount, style, dividerColor,
    mode: isHourly ? 'hourly' : 'daily',
  });
  const dailyTickLabelsPlugin = createDailyTickLabelsPlugin({
    config, language, data, textColor, style, stationCount, doubledToday,
    sunshineLabelBand,
  });
  const precipLabelPlugin = createPrecipLabelPlugin({
    config, data, precipUnit, precipPerBarColor, precipColor, textColor, backgroundColor,
    chartTextColor: chart_text_color,
  });

  // 'today' and 'hourly' both render without the bold station-vs-
  // forecast separator: 'today' is 3-hour aggregated and reads as
  // one continuous diurnal cycle; 'hourly' relies on the dashed
  // segment of the temperature line itself to mark forecast vs
  // measured. The separator is reserved for 'daily' where the
  // doubled-today framing genuinely needs a visual divider.
  const plugins: ChartPlugin[] = (config.forecast.type === 'today' || config.forecast.type === 'hourly')
    ? [dailyTickLabelsPlugin, precipLabelPlugin]
    : [separatorPlugin, dailyTickLabelsPlugin, precipLabelPlugin];
  if (showSunshineLabels) {
    plugins.push(createSunshineLabelPlugin({
      config, data, textColor, backgroundColor,
      chartTextColor: chart_text_color,
      sunshineColor, sunshinePerBarColor,
      bandHeight: sunshineLabelBand,
    }));
  }

  card._chartPhase = 'init';
  card.forecastChart = buildChart(ctx, {
    datasets,
    plugins,
    data,
    config,
    textColor,
    backgroundColor,
    dividerColor,
    chartTextColor: chart_text_color,
    precipMax,
    precipUnit,
    tempUnit,
    doubledToday,
    stationCount,
    style,
    sunshineLabelBand,
  });
  card._chartPhase = null;
  return undefined;
}
