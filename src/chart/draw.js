// Chart.js instance builder. Pulled out of main.js so the lifecycle
// component (set hass / updated / render / drawChart) and the chart
// configuration each fit in one screen of mental model.
//
// Inputs are passed as a single bag so the call site (drawChart in
// main.js) reads as a small list of "what does the chart need to know"
// instead of a 200-line block of nested options.

import { Chart } from 'chart.js';

export function buildChart(ctx, {
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
  precipUnit,
  tempUnit,
  doubledToday,
  stationCount,
  style,
}) {
  return new Chart(ctx, {
    type: 'bar',
    plugins,
    data: {
      labels: data.dateTime,
      datasets,
    },
    options: {
      maintainAspectRatio: false,
      animation: config.forecast.disable_animation === true ? { duration: 0 } : {},
      layout: { padding: { bottom: 10 } },
      scales: {
        x: {
          position: 'top',
          border: { width: 0 },
          grid: {
            drawTicks: false,
            // Suppress only the gridline between station-today and
            // forecast-today (it sits inside the doubled-today framing);
            // keep the others as visual day separators.
            color: (gridCtx) => (doubledToday && gridCtx.index === stationCount)
              ? 'transparent'
              : dividerColor,
          },
          ticks: {
            maxRotation: 0,
            color: config.forecast.chart_datetime_color || textColor,
            padding: 10,
            callback: function (value) {
              const datetime = this.getLabelForValue(value);
              const dateObj = new Date(datetime);
              const timeFormatOptions = {
                hour12: config.use_12hour_format,
                hour: 'numeric',
                ...(config.use_12hour_format ? {} : { minute: 'numeric' }),
              };
              let time = dateObj.toLocaleTimeString(language, timeFormatOptions);

              if (dateObj.getHours() === 0 && dateObj.getMinutes() === 0
                  && config.forecast.type === 'hourly') {
                const date = dateObj.toLocaleDateString(language, {
                  day: 'numeric', month: 'short',
                });
                time = time.replace('a.m.', 'AM').replace('p.m.', 'PM');
                return [date, time];
              }

              if (config.forecast.type !== 'hourly') {
                const weekday = dateObj.toLocaleString(language, { weekday: 'short' }).toUpperCase();
                // When the date row is hidden, return a single string so
                // Chart.js only reserves one line of tick height and the
                // chart reclaims the gap.
                if (config.forecast.show_date === false) return weekday;
                const dateLabel = dateObj.toLocaleDateString(language, {
                  day: '2-digit', month: '2-digit',
                });
                return [weekday, dateLabel];
              }

              return time.replace('a.m.', 'AM').replace('p.m.', 'PM');
            },
          },
          reverse: document.dir === 'rtl',
        },
        TempAxis: (() => {
          // Math.min/max on empty arrays is +/-Infinity → NaN bounds → the
          // chart fails to render. Skip nulls (sensor offline that day) and
          // fall back to a sane default range when nothing is finite.
          const finite = [...data.tempHigh, ...data.tempLow].filter(Number.isFinite);
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
          // No outer chart border on either side — today's framing is
          // carried by blockSeparatorPlugin alone.
          border: {
            width: 0,
            color: style.getPropertyValue('--secondary-text-color') || dividerColor,
          },
          grid: { display: false, drawTicks: false },
          ticks: { display: false },
        },
      },
      plugins: {
        legend: { display: false },
        datalabels: {
          backgroundColor: backgroundColor,
          borderColor: (context) => context.dataset.backgroundColor,
          borderRadius: 0,
          borderWidth: 1.5,
          padding: 4,
          color: chartTextColor || textColor,
          font: function (context) {
            const dt = data.dateTime[context.dataIndex];
            const k = dt ? new Date(dt) : null;
            if (k) k.setHours(0, 0, 0, 0);
            const t = new Date(); t.setHours(0, 0, 0, 0);
            const isToday = k && k.getTime() === t.getTime();
            return {
              size: parseInt(config.forecast.labels_font_size) || 11,
              lineHeight: 0.7,
              weight: isToday ? 'bold' : 'normal',
            };
          },
          formatter: function (value, context) {
            return context.dataset.data[context.dataIndex] + '°';
          },
        },
        // Tooltip disabled in v0.8 — on mobile (and especially within the
        // hourly scroll viewport) the tap-to-show-tooltip pop-up
        // interferes with horizontal swiping. The chart's own datalabels
        // already render the temperature / precipitation values inline,
        // so the tooltip carried no extra information anyway.
        tooltip: { enabled: false },
      },
    },
  });
}
