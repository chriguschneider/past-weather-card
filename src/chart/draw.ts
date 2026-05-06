// Chart.js instance builder. Pulled out of main.js so the lifecycle
// component (set hass / updated / render / drawChart) and the chart
// configuration each fit in one screen of mental model.
//
// Inputs are passed as a single bag so the call site (drawChart in
// main.js) reads as a small list of "what does the chart need to know"
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
  language: string;
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
}

export function buildChart(ctx: CanvasRenderingContext2D | HTMLCanvasElement, opts: BuildChartOpts): Chart {
  const {
    datasets,
    plugins,
    data,
    config,
    language,
    textColor,
    backgroundColor,
    dividerColor,
    chartTextColor,
    precipMax,
    doubledToday,
    stationCount,
    style,
    sunshineLabelBand,
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
      // Default Chart.js animation is 1000 ms easeOutQuart. With the
      // post-v0.9 dataset density (precip + sunshine = up to 336 bars
      // animating in hourly mode), 1 s feels laggy. 500 ms still reads
      // as a transition without dragging. Users who want it fully off
      // continue to set `forecast.disable_animation: true`.
      animation: (config as { forecast: { disable_animation?: boolean } }).forecast.disable_animation === true
        ? { duration: 0 }
        : { duration: 500 },
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
            // Suppress only the gridline between station-today and
            // forecast-today (it sits inside the doubled-today framing);
            // keep the others as visual day separators.
            color: ((gridCtx: { index: number }) => (doubledToday && gridCtx.index === stationCount)
              ? 'transparent'
              : dividerColor) as never,
          },
          ticks: {
            maxRotation: 0,
            color: config.forecast.chart_datetime_color || textColor,
            padding: 10,
            callback: function (this: { getLabelForValue(v: number): string }, value: number | string, _index: number) {
              const fcType = config.forecast.type;
              // 'today' is hourly granularity: route through the
              // hourly time-format branch, but show a label only on
              // every 3rd DATA-INDEX column to keep the 24-bar view
              // legible. `value` is the data position (0..n-1) for a
              // category scale — stable regardless of chart.js's
              // auto-skip behaviour at narrow viewports. `index` is
              // the position in the visible-ticks array, which can
              // differ from the data index when chart.js skips ticks.
              const isHourlyish = fcType === 'hourly' || fcType === 'today';
              if (fcType === 'today' && (value as number) % 3 !== 0) {
                return '';
              }
              void _index;
              const datetime = this.getLabelForValue(value as number);
              const dateObj = new Date(datetime);
              const timeFormatOptions: Intl.DateTimeFormatOptions = {
                hour12: config.use_12hour_format,
                hour: 'numeric',
                ...(config.use_12hour_format ? {} : { minute: 'numeric' }),
              };
              let time = dateObj.toLocaleTimeString(language, timeFormatOptions);

              if (dateObj.getHours() === 0 && dateObj.getMinutes() === 0 && isHourlyish) {
                const date = dateObj.toLocaleDateString(language, {
                  day: 'numeric', month: 'short',
                });
                time = time.replace('a.m.', 'AM').replace('p.m.', 'PM');
                return [date, time];
              }

              if (!isHourlyish) {
                const weekday = dateObj.toLocaleString(language, { weekday: 'short' }).toUpperCase();
                if (config.forecast.show_date === false) return weekday;
                const dateLabel = dateObj.toLocaleDateString(language, {
                  day: '2-digit', month: '2-digit',
                });
                return [weekday, dateLabel];
              }

              return time.replace('a.m.', 'AM').replace('p.m.', 'PM');
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
          // 'today' mode: show temp labels only every 3rd column to
          // keep the dense 24-hour view legible. Other modes show all.
          display: ((context: { dataIndex: number }) => {
            if (config.forecast.type !== 'today') return true;
            return context.dataIndex % 3 === 0;
          }) as never,
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
            const isToday = !!(k && k.getTime() === t.getTime());
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
      } as never,
    },
  };

  return new Chart(ctx as HTMLCanvasElement, chartConfig);
}
