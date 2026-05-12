// Pressure-tendency classifier for the live-panel pressure row.
//
// The 5-class scheme follows WMO surface-observation practice for the
// 3-hour pressure characteristic: |Δp| < 1 hPa is stable; the next band
// up (1..3 hPa) is the "rising" / "falling" pair; |Δp| > 3 hPa is
// "rising_fast" / "falling_fast". Boundary belongs to the
// lower-magnitude class (|Δ| < 1 is strict).
//
// Thresholds are hard-coded constants — the design rejects configurable
// thresholds for v1 (see .workflow/live-pressure-trend/alignment.md).

export type PressureTrendClass =
  | 'rising_fast'
  | 'rising'
  | 'stable'
  | 'falling'
  | 'falling_fast';

const STABLE_BAND_HPA = 1;
const FAST_BAND_HPA = 3;

/** Classify a 3-hour pressure delta in hPa into one of five tendency
 *  classes. Returns null when the delta is null/non-finite so the
 *  caller can degrade to today's `mdi:gauge` rendering. */
export function getPressureTrend(deltaHpa: number | null): PressureTrendClass | null {
  if (deltaHpa == null || !Number.isFinite(deltaHpa)) return null;
  const abs = Math.abs(deltaHpa);
  if (abs < STABLE_BAND_HPA) return 'stable';
  if (abs <= FAST_BAND_HPA) return deltaHpa > 0 ? 'rising' : 'falling';
  return deltaHpa > 0 ? 'rising_fast' : 'falling_fast';
}

const PRESSURE_TREND_ICONS: Record<PressureTrendClass, string> = {
  rising_fast: 'arrow-up',
  rising: 'arrow-top-right',
  stable: 'arrow-right',
  falling: 'arrow-bottom-right',
  falling_fast: 'arrow-down',
};

/** MDI icon name (without prefix) for a pressure trend class. Returns
 *  null when no trend is available so the caller can keep the legacy
 *  `gauge` icon. */
export function getPressureTrendIcon(trend: PressureTrendClass | null): string | null {
  return trend ? PRESSURE_TREND_ICONS[trend] : null;
}
