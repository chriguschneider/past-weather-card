import { describe, it, expect } from 'vitest';
import { getPressureTrend, getPressureTrendIcon } from '../src/pressure-trend.js';

describe('getPressureTrend', () => {
  it('returns null for null/non-finite delta (graceful degrade)', () => {
    expect(getPressureTrend(null)).toBe(null);
    expect(getPressureTrend(NaN)).toBe(null);
    expect(getPressureTrend(Infinity)).toBe(null);
    expect(getPressureTrend(-Infinity)).toBe(null);
  });

  it('classifies |Δ| < 1 as stable (strict)', () => {
    expect(getPressureTrend(0)).toBe('stable');
    expect(getPressureTrend(0.3)).toBe('stable');
    expect(getPressureTrend(-0.9)).toBe('stable');
    expect(getPressureTrend(0.999)).toBe('stable');
  });

  // Boundary case: |Δ| = 1 → rising (lower-magnitude class wins at the
  // boundary per alignment.md; |Δ|<1 is strict).
  it('classifies exactly ±1 as rising/falling', () => {
    expect(getPressureTrend(1)).toBe('rising');
    expect(getPressureTrend(-1)).toBe('falling');
  });

  it('classifies 1..3 as rising/falling', () => {
    expect(getPressureTrend(2.1)).toBe('rising');
    expect(getPressureTrend(-1.8)).toBe('falling');
  });

  // Boundary case: |Δ| = 3 → still rising/falling (≤ 3 stays in band).
  it('classifies exactly ±3 as rising/falling (not fast)', () => {
    expect(getPressureTrend(3)).toBe('rising');
    expect(getPressureTrend(-3)).toBe('falling');
  });

  it('classifies |Δ| > 3 as rising_fast/falling_fast', () => {
    expect(getPressureTrend(3.001)).toBe('rising_fast');
    expect(getPressureTrend(5)).toBe('rising_fast');
    expect(getPressureTrend(-5.1)).toBe('falling_fast');
    expect(getPressureTrend(-100)).toBe('falling_fast');
  });
});

describe('getPressureTrendIcon', () => {
  it('maps each trend class to a directional MDI arrow name', () => {
    expect(getPressureTrendIcon('rising_fast')).toBe('arrow-up');
    expect(getPressureTrendIcon('rising')).toBe('arrow-top-right');
    expect(getPressureTrendIcon('stable')).toBe('arrow-right');
    expect(getPressureTrendIcon('falling')).toBe('arrow-bottom-right');
    expect(getPressureTrendIcon('falling_fast')).toBe('arrow-down');
  });

  it('returns null when no trend is available so caller can keep gauge', () => {
    expect(getPressureTrendIcon(null)).toBe(null);
  });
});
