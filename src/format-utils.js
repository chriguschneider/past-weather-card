// Pure formatting / layout helpers used by the chart. Kept in their own
// module so they can be unit-tested without pulling in Lit, Chart.js, or HA.

// Reduce a CSS colour to ~`factor` of its original alpha. Used to render
// forecast precipitation bars at lower opacity than the measured station
// bars next to them. Handles the rgb/rgba/hex shapes the editor produces;
// other formats (named colours, hsl, oklch, …) pass through unchanged so
// no exception escapes into the render path.
export function lightenColor(color, factor = 0.45) {
  if (!color || typeof color !== 'string') return color;
  let m = /^rgba?\s*\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)\s*$/i.exec(color);
  if (m) {
    const a = m[4] !== undefined ? parseFloat(m[4]) : 1;
    return `rgba(${m[1]}, ${m[2]}, ${m[3]}, ${(a * factor).toFixed(3)})`;
  }
  m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color);
  if (m) {
    const h = m[1].length === 3 ? m[1].split('').map(c => c + c).join('') : m[1];
    return `rgba(${parseInt(h.slice(0, 2), 16)}, ${parseInt(h.slice(2, 4), 16)}, ${parseInt(h.slice(4, 6), 16)}, ${factor.toFixed(3)})`;
  }
  return color;
}

// Compute the tick-index pairs at which the chart's "today" framing lines
// should be drawn. Returns an array of `[leftIdx, rightIdx]` pairs; the
// caller draws a vertical line at the midpoint between those two ticks.
//
// - Both blocks active: line before station-today + line after forecast-today.
// - Station-only:       line before today (rightmost column).
// - Forecast-only:      line after today (leftmost column).
// - Empty / single-tick chart: no lines.
export function computeBlockSeparatorPositions(stationCount, forecastCount, ticksLength) {
  if (!Number.isFinite(ticksLength) || ticksLength < 2) return [];
  const out = [];
  if (stationCount > 0 && forecastCount > 0) {
    if (stationCount >= 2) out.push([stationCount - 2, stationCount - 1]);
    if (stationCount + 1 < ticksLength) out.push([stationCount, stationCount + 1]);
  } else if (stationCount > 0) {
    out.push([ticksLength - 2, ticksLength - 1]);
  } else if (forecastCount > 0) {
    out.push([0, 1]);
  }
  return out;
}
