// Pure unit-conversion helpers used by the live-attributes block in
// `main.ts`. Extracted from the WeatherStationCard class in v1.10.1
// so the conversion tables live alongside the leaf utilities and the
// helpers themselves get direct unit-test coverage.
//
// Wind / pressure tables are keyed by `targetUnit->sourceUnit`. Beaufort
// and same-unit cases are short-circuited inside the converters and
// never index into the tables.

/** Wind-speed conversion factors. multiply source-unit value by the
 *  factor for `target->source` to get the value in the target unit. */
export const WIND_CONVERSION: Record<string, number> = {
  'm/s->km/h': 1000 / 3600,
  'm/s->mph': 0.44704,
  'km/h->m/s': 3.6,
  'km/h->mph': 1.60934,
  'mph->m/s': 1 / 0.44704,
  'mph->km/h': 1 / 1.60934,
};

/** Pressure conversion factors, same scheme as WIND_CONVERSION. */
export const PRESSURE_CONVERSION: Record<string, number> = {
  'mmHg->hPa': 0.75006,
  'mmHg->inHg': 25.4,
  'hPa->mmHg': 1 / 0.75006,
  'hPa->inHg': 33.8639,
  'inHg->mmHg': 1 / 25.4,
  'inHg->hPa': 1 / 33.8639,
};

/** Beaufort scale converter — passed in by the caller because the
 *  classifier lives on the card class. Decoupling here keeps the
 *  utils module pure and dependency-free. */
export type BeaufortFn = (windSpeed: number) => number;

/** Convert windSpeed from `fromUnit` to `toUnit`. Same-unit returns
 *  rounded value. Beaufort delegates to `beaufortFn`. Unknown unit
 *  pair returns the input value unchanged (defensive at HA boundary).
 *  `fromUnit` / `toUnit` may be undefined when the HA entity hasn't
 *  populated `wind_speed_unit` yet — falls through to the unchanged
 *  return path. */
export function convertWindSpeed(
  windSpeed: number,
  fromUnit: string | undefined,
  toUnit: string | undefined,
  beaufortFn: BeaufortFn,
): number {
  if (toUnit === fromUnit) return Math.round(windSpeed);
  if (toUnit === 'Bft') return beaufortFn(windSpeed);
  const factor = WIND_CONVERSION[`${toUnit}->${fromUnit}`];
  return factor !== undefined ? Math.round(windSpeed * factor) : windSpeed;
}

/** Convert pressure from `fromUnit` to `toUnit`. Same-unit rounds to
 *  integer for hPa / mmHg, leaves inHg as-is. Cross-unit converts then
 *  rounds (or `.toFixed(2)` for inHg target). Returns string when the
 *  target is inHg cross-unit (legacy `.toFixed` shape). `fromUnit` /
 *  `toUnit` may be undefined when the HA entity hasn't populated
 *  `pressure_unit` yet. */
export function convertPressure(
  pressure: number,
  fromUnit: string | undefined,
  toUnit: string | undefined,
): number | string {
  if (toUnit === fromUnit) {
    return (toUnit === 'hPa' || toUnit === 'mmHg')
      ? Math.round(pressure) : pressure;
  }
  const factor = PRESSURE_CONVERSION[`${toUnit}->${fromUnit}`];
  if (factor === undefined) return pressure;
  const converted = pressure * factor;
  return toUnit === 'inHg' ? converted.toFixed(2) : Math.round(converted);
}

/** Format a sunshine-duration sensor reading as decimal hours. The
 *  sensor may report seconds (`s` / `sec*` unit) or minutes (`min`);
 *  unknown units fall through as already-hours. Returns undefined when
 *  the input is missing / non-numeric. */
export function formatSunshineHours(
  raw: unknown,
  unit: unknown,
): number | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const num = parseFloat(String(raw));
  if (!Number.isFinite(num)) return undefined;
  const u = (typeof unit === 'string' ? unit : '').toLowerCase();
  let divisor = 1;
  if (u === 's' || u.startsWith('sec')) divisor = 3600;
  else if (u === 'min') divisor = 60;
  return Math.round((num / divisor) * 10) / 10;
}
