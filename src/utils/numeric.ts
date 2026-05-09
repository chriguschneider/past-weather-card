// Defensive parseFloat that returns null on failure instead of NaN.
//
// HA sensor states arrive as strings ("21.4", "unknown", "unavailable",
// undefined). Plain `parseFloat` returns NaN for unparseable values,
// which then silently propagates through arithmetic and label
// formatting. Returning null instead lets caller code use a single
// `value == null` check to gate render branches.
//
// Returns null for: undefined, null, "", "unknown", "unavailable",
// "NaN", any non-numeric string, or a finite-check failure.
export function parseNumericSafe(value: unknown): number | null {
  if (value == null) return null;
  const n = parseFloat(value as string);
  return Number.isFinite(n) ? n : null;
}
