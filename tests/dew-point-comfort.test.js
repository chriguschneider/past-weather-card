import { describe, it, expect } from 'vitest';
import {
  getDewPointComfort,
  getDewPointComfortIcon,
} from '../src/dew-point-comfort.js';

describe('getDewPointComfort', () => {
  it('returns null when Td is null / non-finite', () => {
    expect(getDewPointComfort(null, 20)).toBe(null);
    expect(getDewPointComfort(NaN, 20)).toBe(null);
    expect(getDewPointComfort(Infinity, 20)).toBe(null);
  });

  it('returns null when air temperature is null / non-finite', () => {
    expect(getDewPointComfort(10, null)).toBe(null);
    expect(getDewPointComfort(10, NaN)).toBe(null);
    expect(getDewPointComfort(10, -Infinity)).toBe(null);
  });

  it('classifies Raureif (Td < 0 °C and spread ≤ 3 °C)', () => {
    expect(getDewPointComfort(-2, 0)).toBe('raureif');
    expect(getDewPointComfort(-5, -3)).toBe('raureif');
    expect(getDewPointComfort(-1, 2)).toBe('raureif');
  });

  it('classifies Nebel (spread ≤ 1 °C, Td ≥ 0)', () => {
    expect(getDewPointComfort(10, 10.5)).toBe('nebel');
    expect(getDewPointComfort(5, 5)).toBe('nebel');
    expect(getDewPointComfort(15, 16)).toBe('nebel');
  });

  it('classifies Schwül (Td > 16 °C, spread > 1 °C)', () => {
    expect(getDewPointComfort(18, 25)).toBe('schwuel');
    expect(getDewPointComfort(20, 28)).toBe('schwuel');
  });

  it('classifies Tau (spread ≤ 3 °C, Td ≥ 0, not Schwül/Nebel)', () => {
    expect(getDewPointComfort(12, 14)).toBe('tau');
    expect(getDewPointComfort(8, 11)).toBe('tau');
  });

  it('classifies Komfort (else)', () => {
    expect(getDewPointComfort(10, 22)).toBe('komfort');
    expect(getDewPointComfort(5, 18)).toBe('komfort');
    expect(getDewPointComfort(0, 10)).toBe('komfort');
  });

  // Boundary case: Td = 0 → Raureif is `Td < 0` strict, so 0 falls
  // through to the Tau / Nebel / Komfort tier.
  it('Td = 0 °C is not Raureif (strict)', () => {
    expect(getDewPointComfort(0, 2)).toBe('tau');
    expect(getDewPointComfort(0, 10)).toBe('komfort');
  });

  // Boundary case: Td = 16 → Schwül is `Td > 16` strict, so 16 is not
  // Schwül; falls through to Tau / Komfort.
  it('Td = 16 °C is not Schwül (strict)', () => {
    expect(getDewPointComfort(16, 18)).toBe('tau');
    expect(getDewPointComfort(16, 25)).toBe('komfort');
  });

  // Boundary case: spread = 1 → Nebel (≤ 1 °C inclusive).
  it('spread = 1 °C is Nebel (inclusive)', () => {
    expect(getDewPointComfort(10, 11)).toBe('nebel');
  });

  // Boundary case: spread = 3 → Tau (≤ 3 °C inclusive).
  it('spread = 3 °C is Tau (inclusive)', () => {
    expect(getDewPointComfort(10, 13)).toBe('tau');
  });

  // Priority order checks
  it('Raureif beats Nebel when both fire (Td < 0 and spread ≤ 1)', () => {
    expect(getDewPointComfort(-2, -1.5)).toBe('raureif');
  });

  it('Nebel beats Schwül when both fire (Td > 16 and spread ≤ 1)', () => {
    expect(getDewPointComfort(22, 22.5)).toBe('nebel');
  });

  it('Schwül beats Tau when both fire (Td > 16 and spread ≤ 3)', () => {
    expect(getDewPointComfort(17, 19)).toBe('schwuel');
  });

  it('clamps negative spread to 0 (Td > T sensor mismatch) → Nebel', () => {
    expect(getDewPointComfort(15, 14)).toBe('nebel');
  });
});

describe('getDewPointComfortIcon', () => {
  it('maps each band to its MDI icon name', () => {
    expect(getDewPointComfortIcon('raureif')).toBe('snowflake-variant');
    expect(getDewPointComfortIcon('nebel')).toBe('weather-fog');
    expect(getDewPointComfortIcon('schwuel')).toBe('water-percent-alert');
    expect(getDewPointComfortIcon('tau')).toBe('water');
    expect(getDewPointComfortIcon('komfort')).toBe('thermometer-water');
  });

  it('returns null when no band so caller keeps the legacy icon', () => {
    expect(getDewPointComfortIcon(null)).toBe(null);
  });
});
