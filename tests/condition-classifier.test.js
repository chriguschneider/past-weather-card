import { describe, it, expect } from 'vitest';
import { classifyDay, clearSkyNoonLux, clearSkyLuxAt } from '../src/condition-classifier.js';

// Sea-level perpendicular-sun reference used by the classifier when no lat
// is supplied — keeps the cloudRatio math stable across tests.
const CLEAR = 110000;

describe('classifyDay — exceptional', () => {
  it('emits exceptional on Beaufort-10 gust (≥ 24.5 m/s)', () => {
    expect(classifyDay({ gust_max: 24.5 })).toBe('exceptional');
    expect(classifyDay({ gust_max: 30 })).toBe('exceptional');
  });

  it('does not emit exceptional just below the gust threshold', () => {
    expect(classifyDay({ gust_max: 24.4, lux_max: CLEAR, clearsky_lux: CLEAR })).not.toBe('exceptional');
  });

  it('emits exceptional on NWS daily heavy-rain (≥ 50 mm)', () => {
    expect(classifyDay({ precip_total: 50 })).toBe('exceptional');
  });
});

describe('classifyDay — precipitation', () => {
  it('snowy when temp_max ≤ 0 °C and precip ≥ 0.5 mm', () => {
    expect(classifyDay({ precip_total: 1, temp_max: -1 })).toBe('snowy');
    expect(classifyDay({ precip_total: 1, temp_max: 0 })).toBe('snowy');
  });

  it('snowy-rainy when 0 < temp_max ≤ 3 °C and precip ≥ 0.5 mm', () => {
    expect(classifyDay({ precip_total: 1, temp_max: 1 })).toBe('snowy-rainy');
    expect(classifyDay({ precip_total: 1, temp_max: 3 })).toBe('snowy-rainy');
  });

  it('pouring when precip ≥ 10 mm and temp_max > 3 °C', () => {
    expect(classifyDay({ precip_total: 10, temp_max: 10 })).toBe('pouring');
  });

  it('rainy for 0.5 ≤ precip < 10 mm at warm temperatures', () => {
    expect(classifyDay({ precip_total: 0.5, temp_max: 10 })).toBe('rainy');
    expect(classifyDay({ precip_total: 5, temp_max: 10 })).toBe('rainy');
    expect(classifyDay({ precip_total: 9.99, temp_max: 10 })).toBe('rainy');
  });

  it('does not emit precipitation conditions below the rainy threshold', () => {
    expect(classifyDay({ precip_total: 0.4, temp_max: 10, lux_max: CLEAR, clearsky_lux: CLEAR })).not.toMatch(/^(rainy|pouring|snowy)/);
  });

  it('exceptional precipitation outranks pouring/snowy', () => {
    expect(classifyDay({ precip_total: 50, temp_max: -5 })).toBe('exceptional');
  });
});

describe('classifyDay — fog', () => {
  it('emits fog at 95 % humidity, ≤ 1 °C dew-point spread, calm wind', () => {
    expect(classifyDay({
      humidity: 95, temp_min: 5, dew_point_mean: 4, wind_mean: 2,
    })).toBe('fog');
  });

  it('does not emit fog when wind ≥ 3 m/s', () => {
    expect(classifyDay({
      humidity: 95, temp_min: 5, dew_point_mean: 4, wind_mean: 3,
      lux_max: CLEAR, clearsky_lux: CLEAR,
    })).not.toBe('fog');
  });

  it('does not emit fog without humidity or dew_point sensors', () => {
    expect(classifyDay({ humidity: 95, temp_min: 5, lux_max: CLEAR, clearsky_lux: CLEAR })).not.toBe('fog');
    expect(classifyDay({ dew_point_mean: 4, temp_min: 5, lux_max: CLEAR, clearsky_lux: CLEAR })).not.toBe('fog');
  });
});

describe('classifyDay — wind', () => {
  it('windy when gust ≥ 10.8 m/s and clouds ≥ 0.70', () => {
    expect(classifyDay({ gust_max: 11, lux_max: CLEAR, clearsky_lux: CLEAR })).toBe('windy');
  });

  it('windy-variant when gust ≥ 10.8 m/s and clouds < 0.70', () => {
    expect(classifyDay({ gust_max: 11, lux_max: 10000, clearsky_lux: CLEAR })).toBe('windy-variant');
  });

  it('windy when wind_mean ≥ 8.0 m/s', () => {
    expect(classifyDay({ wind_mean: 8, lux_max: CLEAR, clearsky_lux: CLEAR })).toBe('windy');
  });
});

describe('classifyDay — cloud cover', () => {
  it('sunny when cloudRatio ≥ 0.70', () => {
    expect(classifyDay({ lux_max: 90000, clearsky_lux: CLEAR })).toBe('sunny');
  });

  it('partlycloudy when 0.30 ≤ cloudRatio < 0.70', () => {
    expect(classifyDay({ lux_max: 50000, clearsky_lux: CLEAR })).toBe('partlycloudy');
  });

  it('cloudy when cloudRatio < 0.30', () => {
    expect(classifyDay({ lux_max: 20000, clearsky_lux: CLEAR })).toBe('cloudy');
  });

  it('cloudy when illuminance sensor missing', () => {
    expect(classifyDay({})).toBe('cloudy');
  });
});

describe('classifyDay — overrides', () => {
  it('honours condition_mapping overrides', () => {
    expect(classifyDay(
      { precip_total: 0.4, temp_max: 10 },
      { rainy_threshold_mm: 0.3 },
    )).toBe('rainy');
  });
});

describe('clearSkyNoonLux', () => {
  it('returns 110 000 lx fallback for non-finite latitude', () => {
    expect(clearSkyNoonLux(NaN, 80)).toBe(110000);
  });

  it('peaks near the equator at equinox', () => {
    expect(clearSkyNoonLux(0, 80)).toBeCloseTo(110000, -2);
  });

  it('is zero when zenith ≥ 90°', () => {
    // 80°N at winter solstice (dec 21 ≈ day 355): declination ≈ -23.45°,
    // |80 - (-23.45)| = 103.45° → cos < 0 → 0.
    expect(clearSkyNoonLux(80, 355)).toBe(0);
  });
});

describe('clearSkyLuxAt', () => {
  it('returns 0 when sun is below horizon', () => {
    // Midnight UTC at lat 47, lon 8 (Switzerland) → sun far below horizon
    const midnight = new Date(Date.UTC(2026, 5, 1, 0, 0, 0));
    expect(clearSkyLuxAt(47, 8, midnight)).toBe(0);
  });

  it('returns the noon-lux fallback when lat or lon is non-finite', () => {
    expect(clearSkyLuxAt(NaN, 8, new Date())).toBe(110000);
    expect(clearSkyLuxAt(47, NaN, new Date())).toBe(110000);
  });
});
