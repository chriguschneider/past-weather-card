// Defensive parseFloat that returns null on failure instead of NaN.
//
// HA sensor states arrive as strings ("21.4", "unknown", "unavailable",
// undefined). Plain `parseFloat` returns NaN for unparseable values,
// which then silently propagates through arithmetic and label
// formatting. Returning null instead lets caller code use a single
// `value == null` check to gate render branches.
//
// Used by:
//   - main.js set hass for live "now" classifier inputs (8 sensor
//     readouts per tick)
//   - the live wind-direction parse where the sensor's state can be
//     a numeric degree string OR a cardinal-name string ("N", "NW")
//
// Returns null for: undefined, null, "", "unknown", "unavailable",
// "NaN", any non-numeric string, or a finite-check failure.
export function parseNumericSafe(value) {
  if (value == null) return null;
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : null;
}
