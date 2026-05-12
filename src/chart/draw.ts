// Chart.js instance builder. Inputs are passed as a single bag so the
// call site reads as a small list of "what does the chart need to know"
// instead of a 200-line block of nested options.
//
// Chart.js's own option types are deeply generic (`Chart<TType, TData,
// TLabel>` propagates through every nested option) and the
// callback-form options use union return types that strict-mode TS
// rejects in plenty of legitimate cases (e.g. a callback returning
// `'transparent'` to skip a gridline is typed as `Color | null`,
// which is compatible at runtime but fights the TS narrower). The
// pragmatic compromise: type the inputs we own (dataset and plugin
// arrays from the orchestrator), but cast the Chart.js options object
// as the library expects. The runtime contract is unchanged.

import { Chart, type ChartConfiguration } from 'chart.js';
import type { ChartPlugin, CssStyleLike, PluginCardConfig, PluginRenderData } from './plugins.js';

export interface BuildChartOpts {
  datasets: ReadonlyArray<unknown>;
  plugins: ReadonlyArray<ChartPlugin>;
  data: PluginRenderData & {
    tempHigh: ReadonlyArray<number | null | undefined>;
    tempLow: ReadonlyArray<number | null | undefined>;
  };
  config: PluginCardConfig & { use_12hour_format?: boolean };
  textColor: string;
  backgroundColor: string;
  dividerColor: string;
  chartTextColor?: string;
  precipMax: number;
  precipUnit: string;
  tempUnit: string;
  doubledToday: boolean;
  stationCount: number;
  style: CssStyleLike;
  sunshineLabelBand: number;
  // True when the card is mounted inside the card-config dialog's
  // live preview — forces animation off regardless of the user's
  // forecast.disable_animation setting, so each editor click renders
  // instantly instead of tweening for half a second.
  inPreview?: boolean;
}

export function buildChart(ctx: CanvasRenderingContext2D | HTMLCanvasElement, opts: BuildChartOpts): Chart {
  const {
    datasets,
    plugins,
    data,
    config,
    textColor,
    backgroundColor,
    dividerColor,
    chartTextColor,
    precipMax,
    doubledToday,
    stationCount,
    style,
    sunshineLabelBand,
    inPreview,
  } = opts;

  const chartConfig: ChartConfiguration = {
    type: 'bar',
    plugins: plugins as unknown as ChartConfiguration['plugins'],
    data: {
      labels: data.dateTime as unknown as string[],
      datasets: datasets as unknown as ChartConfiguration['data']['datasets'],
    },
    options: {
      maintainAspectRatio: false,
      // Chart.js animation: bars grow vertically from the baseline,
      // x/width pinned to final value from frame 1. The per-dataset
      // override on `numbers.properties` excludes x and width from the
      // tween — chart.js's scope resolver consults `datasets.<type>`
      // BEFORE the chart-level `options.animations` (see
      // datasetAnimationScopeKeys in node_modules/chart.js), so the
      // override must live at the dataset-type scope to actually win.
      //
      // Earlier this caused a visible "bars start wide then narrow"
      // artefact: when sunshine data arrived async from Open-Meteo,
      // the chart was destroyed and rebuilt, and the bar-ruler's
      // per-column slot allocation recomputed between frames. That
      // path is gone — sunshine updates now flow through
      // _overlaySunshineOnExisting → updateChart (in-place data
      // mutation, no rebuild) — and the first chart render is gated
      // until ALL expected data sources have produced a value (see
      // _allExpectedDataReady), so the chart only paints once with its
      // final dataset shape. With both fixed, the grow-from-below
      // animation is back to being a polish rather than a footgun.
      //
      // `inPreview` and `forecast.disable_animation` force duration:0.
      animation: inPreview === true
        || (config as { forecast: { disable_animation?: boolean } }).forecast.disable_animation === true
        ? { duration: 0 }
        : { duration: 800, easing: 'easeOutQuad' },
      datasets: {
        bar: {
          animations: {
            numbers: { type: 'number', properties: ['y', 'base', 'height'] },
          },
        },
        line: {
          animations: {
            numbers: { type: 'number', properties: ['y', 'borderWidth', 'radius', 'tension'] },
          },
        },
      } as never,
      layout: { padding: { bottom: 10 } },
      scales: {
        x: {
          position: 'top',
          // sunshineLabelBand > 0 grows the x-axis box by that many
          // pixels — afterFit runs after Chart.js has measured the
          // weekday/date label height, so adding to scale.height
          // pushes chartArea.top down without overlapping the labels.
          afterFit: sunshineLabelBand > 0
            ? ((scale: { height: number }) => { scale.height += sunshineLabelBand; }) as never
            : undefined,
          border: { width: 0 },
          grid: {
            drawTicks: false,
            // Per-tick gridline styling: suppress the gridline between
            // station-today and forecast-today in the daily-doubled
            // framing. All other gridlines render at the divider
            // colour at default width — no bold day-boundary line in
            // 'today' mode (date label in the tick row already marks
            // the new day).
            color: ((gridCtx: { index: number }) => (doubledToday && gridCtx.index === stationCount)
              ? 'transparent'
              : dividerColor) as never,
          },
          ticks: {
            maxRotation: 0,
            color: config.forecast.chart_datetime_color || textColor,
            padding: 10,
            // 'today' renders its time/date labels via the
            // dailyTickLabelsPlugin (custom positioning, left-aligned,
            // sparse-stacked). Returning '' from the callback below
            // would still leave chart.js consuming axis space —
            // returning the original strings via the callback IS
            // needed for layout, then the plugin masks/overlays for
            // the actual visual. Daily mode is the same pattern.
            callback: function (this: { getLabelForValue(v: number): string }, value: number | string, _index: number) {
              void value;
              void _index;
              // chart.js's tick callback is unused at runtime —
              // dailyTickLabelsPlugin renders all axis labels
              // ('today', 'hourly', and 'daily' all go through that
              // plugin). Returning a 2-line empty placeholder
              // reserves enough axis height for stacked date + time
              // labels without producing a visible glyph. Avoids the
              // "two background colours" artifact the previous
              // explicit-mask approach produced.
              return config.forecast.show_date === false ? '' : ['', ''];
            } as never,
          },
          reverse: document.dir === 'rtl',
        },
        TempAxis: (() => {
          const finite = [...data.tempHigh, ...data.tempLow].filter((v): v is number => Number.isFinite(v));
          const min = finite.length ? Math.min(...finite) - 5 : 0;
          const max = finite.length ? Math.max(...finite) + 6 : 30;
          return {
            position: 'left',
            beginAtZero: false,
            suggestedMin: min,
            suggestedMax: max,
            border: { width: 0 },
            grid: { display: false, drawTicks: false },
            ticks: { display: false },
          };
        })(),
        PrecipAxis: {
          position: 'right',
          suggestedMax: precipMax,
          border: {
            width: 0,
            color: style.getPropertyValue('--secondary-text-color') || dividerColor,
          },
          grid: { display: false, drawTicks: false },
          ticks: { display: false },
        },
        SunshineAxis: {
          position: 'right',
          display: false,
          min: 0,
          suggestedMax: 1,
          beginAtZero: true,
          border: { width: 0 },
          grid: { display: false, drawTicks: false },
          ticks: { display: false },
        },
      } as never,
      plugins: {
        legend: { display: false },
        datalabels: {
          backgroundColor: backgroundColor,
          borderColor: ((context: { dataset: { backgroundColor: string } }) => context.dataset.backgroundColor) as never,
          borderRadius: 0,
          borderWidth: 1.5,
          padding: 4,
          color: chartTextColor || textColor,
          font: function (context: { dataIndex: number }) {
            const dt = data.dateTime ? data.dateTime[context.dataIndex] : undefined;
            const k = dt ? new Date(dt) : null;
            if (k) k.setHours(0, 0, 0, 0);
            const t = new Date(); t.setHours(0, 0, 0, 0);
            const isToday = k?.getTime() === t.getTime();
            return {
              size: parseInt(String(config.forecast.labels_font_size)) || 11,
              lineHeight: 0.7,
              weight: isToday ? 'bold' : 'normal',
            };
          } as never,
          formatter: function (_value: unknown, context: { dataset: { data: ReadonlyArray<unknown> }; dataIndex: number }) {
            return context.dataset.data[context.dataIndex] + '°';
          } as never,
        },
        tooltip: { enabled: false },
      },
    },
  };

  return new Chart(ctx, chartConfig);
}
