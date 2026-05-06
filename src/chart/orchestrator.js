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
//   - call buildChart() in chart/draw.js for the actual instance
//
// Coupling to the card instance: card.forecasts, card.renderRoot,
// card.forecastChart (assigned), card._hass, card._stationCount,
// card._forecastCount, card._chartPhase (assigned for the error-banner
// labelling in the safe-wrapper drawChart()), card.computeForecastData()
// (data shaping that lives on the card, used both here and from
// updateChart for incremental refreshes), card.ll() (locale lookup
// for dataset labels), card.drawChart() (re-entrant RAF retry).

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
} from './plugins.js';

export function drawChartUnsafe(card, args) {
  const { config: rawConfig, language, weather, forecastItems } = args || card;
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

  const chartCanvas = card.renderRoot && card.renderRoot.querySelector('#forecastChart');
  if (!chartCanvas) {
    console.error('Canvas element not found:', card.renderRoot);
    return;
  }

  if (card.forecastChart) {
    card.forecastChart.destroy();
  }
  card._chartPhase = 'compute';
  const tempUnit = card._hass.config.unit_system.temperature;
  const lengthUnit = card._hass.config.unit_system.length;
  const precipUnit = lengthUnit === 'km' ? card.ll('units')['mm'] : card.ll('units')['in'];
  const data = card.computeForecastData();

  const style = getComputedStyle(document.body);
  const backgroundColor = style.getPropertyValue('--card-background-color');
  const textColor = style.getPropertyValue('--primary-text-color');
  const dividerColor = style.getPropertyValue('--divider-color');
  const canvas = card.renderRoot.querySelector('#forecastChart');
  if (!canvas) {
    requestAnimationFrame(() => card.drawChart());
    return;
  }

  const ctx = canvas.getContext('2d');

  let precipMax;
  if (config.forecast.type === 'hourly') {
    precipMax = lengthUnit === 'km' ? 4 : 1;
  } else {
    precipMax = lengthUnit === 'km' ? 20 : 1;
  }

  Chart.defaults.color = textColor;
  Chart.defaults.scale.grid.color = dividerColor;
  Chart.defaults.elements.line.fill = false;
  Chart.defaults.elements.line.tension = 0.3;
  Chart.defaults.elements.line.borderWidth = 1.5;
  Chart.defaults.elements.point.radius = 2;
  Chart.defaults.elements.point.hitRadius = 10;

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
  const isHourlyCombo = hasBothBlocks && config.forecast.type === 'hourly';
  const isBoundarySegment = (segCtx) =>
    segCtx.p0DataIndex === gapStartIdx && segCtx.p1DataIndex === gapStartIdx + 1;
  const segmentSkip = (segCtx) => {
    if (!hasBothBlocks) return undefined;
    // Hourly combo: boundary is drawn (dashed by segmentDash); only daily
    // combo suppresses it.
    if (!isHourlyCombo && isBoundarySegment(segCtx)) return 'transparent';
    return undefined;
  };
  // Dash forecast segments to mark "predicted, not measured". A segment is
  // entirely in the forecast block when its left endpoint is at or past
  // the first forecast index (stationCount). At hourly combo we also dash
  // the boundary segment itself (the "is → soll" transition).
  const segmentDash = (segCtx) => {
    if (segCtx.p0DataIndex >= stationCountForGap && forecastCountForGap > 0) {
      return [6, 4];
    }
    if (isHourlyCombo && isBoundarySegment(segCtx)) return [6, 4];
    return undefined;
  };
  const tempSegmentOpts = { borderColor: segmentSkip, borderDash: segmentDash };

  const precipColor = config.forecast.precipitation_color;
  const precipColorLight = lightenColor(precipColor);
  const precipPerBarColor = (data.precip || []).map(
    (_, i) => (hasBothBlocks && i >= stationCountForGap) ? precipColorLight
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
  const isHourlyChart = config.forecast.type === 'hourly';
  const showSunshine = config.forecast.show_sunshine === true;
  // Per-column "Xh" / "0.5h" labels only in daily mode — at hourly the
  // 168 narrow columns over a 7-day window can't fit a label per bar,
  // and the bar height itself encodes the value.
  const showSunshineLabels = showSunshine && !isHourlyChart;
  const sunshineColor = config.forecast.sunshine_color || 'rgba(255, 193, 7, 1.0)';
  const sunshineColorLight = lightenColor(sunshineColor);
  const sunshinePerBarColor = (data.sunshine || []).map(
    (_, i) => (hasBothBlocks && i >= stationCountForGap) ? sunshineColorLight
            : (!hasBothBlocks && stationCountForGap === 0) ? sunshineColorLight
            : sunshineColor,
  );
  // Convert raw hours into 0..1 fractions of day length. Null values
  // pass through so the bar slot stays empty for missing data.
  const sunshineFractionData = sunshineFractions(data.sunshine, data.dayLength);

  const datasets = [
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
      // Hourly forecasts carry only `temperature` per entry, no separate
      // low — hide the second line dataset entirely (vs. drawing a flat
      // empty line). precipPlugin still indexes dataset[2] so we must not
      // remove this slot.
      hidden: !data.tempLowAvailable,
    },
    {
      label: card.ll('precip'),
      type: 'bar',
      data: data.precip,
      yAxisID: 'PrecipAxis',
      borderColor: precipPerBarColor,
      backgroundColor: precipPerBarColor,
      barPercentage: config.forecast.precip_bar_size / 100,
      categoryPercentage: 1.0,
      // datalabels handled by precipLabelPlugin so the unit can render
      // at a smaller font next to the number. The default chartjs-
      // datalabels render is suppressed via display:false here; the
      // plugin reads dataset.data[i] directly to draw number + unit.
      datalabels: {
        display: function () { return false; },
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
      // Hours label is drawn by createSunshineLabelPlugin at the top of
      // the column — suppress chartjs-datalabels for this dataset so the
      // bar itself stays clean.
      datalabels: { display: function () { return false; } },
    });
  }

  const chart_text_color = (config.forecast.chart_text_color === 'auto') ? textColor : config.forecast.chart_text_color;

  if (config.forecast.style === 'style2') {
    const todayBoldFont = (context) => {
      const dt = data.dateTime[context.dataIndex];
      const k = dt ? new Date(dt) : null;
      if (k) k.setHours(0, 0, 0, 0);
      const t = new Date(); t.setHours(0, 0, 0, 0);
      const isToday = k && k.getTime() === t.getTime();
      return {
        size: parseInt(config.forecast.labels_font_size) + 1,
        lineHeight: 0.7,
        weight: isToday ? 'bold' : 'normal',
      };
    };

    datasets[0].datalabels = {
      display: function () {
        return 'true';
      },
      formatter: function (value, context) {
        return context.dataset.data[context.dataIndex] + '°';
      },
      align: 'top',
      anchor: 'center',
      backgroundColor: 'transparent',
      borderColor: 'transparent',
      color: chart_text_color || config.forecast.temperature1_color,
      font: todayBoldFont,
    };

    datasets[1].datalabels = {
      display: function () {
        return 'true';
      },
      formatter: function (value, context) {
        return context.dataset.data[context.dataIndex] + '°';
      },
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
  const isHourly = config.forecast.type === 'hourly';
  // doubled-today only makes sense at daily — at hourly station and
  // forecast meet at "now" with a single separator line.
  const doubledToday = !isHourly && stationCount > 0 && forecastCount > 0;
  // When sunshine is on, draw.js grows the x-axis box by sunshineLabelBand
  // pixels via afterFit. dailyTickLabelsPlugin then shifts weekday + date
  // up by that amount so the new bottom strip is free for the sunshine
  // box. When sunshine is off, sunshineLabelBand stays 0 and chart
  // layout is byte-identical to v0.8.
  const labelsBaseSize = parseInt(config.forecast.labels_font_size) || 11;
  const sunshineLabelBand = showSunshineLabels ? Math.max(16, labelsBaseSize + 6) : 0;
  const separatorPlugin = createSeparatorPlugin({
    stationCount, forecastCount, style, dividerColor,
    mode: isHourly ? 'hourly' : 'daily',
  });
  const dailyTickLabelsPlugin = createDailyTickLabelsPlugin({
    config, language, data, textColor, backgroundColor, style, stationCount, doubledToday,
    sunshineLabelBand,
  });
  const precipLabelPlugin = createPrecipLabelPlugin({
    config, data, precipUnit, precipPerBarColor, precipColor, textColor, backgroundColor,
    chartTextColor: chart_text_color,
  });

  const plugins = [separatorPlugin, dailyTickLabelsPlugin, precipLabelPlugin];
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
    language,
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
}
