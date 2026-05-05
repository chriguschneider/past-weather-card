import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { dailyPrecipitation, MeasuredDataSource, ForecastDataSource } from '../src/data-source.js';
import { WeatherEntityFeature } from '../src/const.js';

describe('dailyPrecipitation', () => {
  const day = (props) => ({ start: '2026-05-01T00:00:00', ...props });
  const series = (entries) => {
    const m = new Map();
    for (const [key, props] of Object.entries(entries)) {
      m.set(Number(key), day(props));
    }
    return m;
  };

  it('returns null when sensor has no map', () => {
    expect(dailyPrecipitation(undefined, 100, 99)).toBe(null);
    expect(dailyPrecipitation(null, 100, 99)).toBe(null);
  });

  it('returns null when today bucket missing', () => {
    expect(dailyPrecipitation(series({ 99: { max: 5 } }), 100, 99)).toBe(null);
  });

  it('uses `change` for total_increasing sensors', () => {
    expect(dailyPrecipitation(series({ 100: { change: 2.4, max: 30 } }), 100, 99)).toBe(2.4);
  });

  it('uses `sum` for total sensors when change absent', () => {
    expect(dailyPrecipitation(series({ 100: { sum: 1.7, max: 5 } }), 100, 99)).toBe(1.7);
  });

  it('falls back to today.max−prev.max for measurement sensors', () => {
    const s = series({ 100: { max: 30 }, 99: { max: 25 } });
    expect(dailyPrecipitation(s, 100, 99)).toBe(5);
  });

  it('returns today.max when previous bucket is missing (no baseline)', () => {
    expect(dailyPrecipitation(series({ 100: { max: 30 } }), 100, 99)).toBe(30);
  });

  it('returns today.max when delta is negative (counter reset)', () => {
    const s = series({ 100: { max: 5 }, 99: { max: 30 } });
    expect(dailyPrecipitation(s, 100, 99)).toBe(5);
  });

  it('returns null when today has no usable field', () => {
    expect(dailyPrecipitation(series({ 100: {} }), 100, 99)).toBe(null);
  });
});

describe('MeasuredDataSource._buildForecast', () => {
  // Build a stable wall-clock so dayKey alignment between fixture and code
  // is deterministic across timezones (we only care about local midnight).
  const startDay = new Date(2026, 4, 1, 0, 0, 0, 0); // May 1, local midnight
  const dayMs = (offsetDays) => {
    const d = new Date(startDay);
    d.setDate(startDay.getDate() + offsetDays);
    return { date: d, key: d.getTime() };
  };

  const fakeHass = {
    config: { latitude: 47.4 },
    callWS: vi.fn(),
  };

  const sensors = {
    temperature: 'sensor.temp',
    humidity: 'sensor.hum',
    illuminance: 'sensor.lux',
    precipitation: 'sensor.rain',
    pressure: 'sensor.pres',
    wind_speed: 'sensor.wind',
    gust_speed: 'sensor.gust',
    wind_direction: 'sensor.dir',
    uv_index: 'sensor.uv',
    dew_point: 'sensor.dew',
  };

  it('produces one entry per requested day, in chronological order', () => {
    const ds = new MeasuredDataSource(fakeHass, { sensors, days: 3 });
    // Fixture: stats start at startDay (offset 0). Loop in _buildForecast
    // iterates i=1..days, so day starts come from offsets 1..3.
    const stats = {
      'sensor.temp': [
        { start: dayMs(1).date.toISOString(), max: 20, min: 10, mean: 15 },
        { start: dayMs(2).date.toISOString(), max: 22, min: 12, mean: 17 },
        { start: dayMs(3).date.toISOString(), max: 18, min: 8, mean: 13 },
      ],
    };
    const out = ds._buildForecast(stats, sensors, startDay, 3);
    expect(out).toHaveLength(3);
    expect(out[0].temperature).toBe(20);
    expect(out[1].temperature).toBe(22);
    expect(out[2].temperature).toBe(18);
    expect(out[0].templow).toBe(10);
  });

  it('returns null fields for days without data, never throws', () => {
    const ds = new MeasuredDataSource(fakeHass, { sensors, days: 3 });
    const stats = {
      'sensor.temp': [
        { start: dayMs(1).date.toISOString(), max: 20, min: 10, mean: 15 },
        // no entry for offset 2 → sensor offline that day
        { start: dayMs(3).date.toISOString(), max: 18, min: 8, mean: 13 },
      ],
    };
    const out = ds._buildForecast(stats, sensors, startDay, 3);
    expect(out).toHaveLength(3);
    expect(out[1].temperature).toBe(null);
    expect(out[1].templow).toBe(null);
    // Condition still gets classified — should fall through to 'cloudy'
    // (no precip / wind / fog / lux) without throwing.
    expect(typeof out[1].condition).toBe('string');
  });

  it('emits the canonical forecast shape', () => {
    const ds = new MeasuredDataSource(fakeHass, { sensors, days: 1 });
    const stats = {
      'sensor.temp': [{ start: dayMs(1).date.toISOString(), max: 20, min: 10, mean: 15 }],
    };
    const [entry] = ds._buildForecast(stats, sensors, startDay, 1);
    expect(entry).toEqual(expect.objectContaining({
      datetime: expect.any(String),
      temperature: expect.any(Number),
      templow: expect.any(Number),
      precipitation: null,
      precipitation_probability: null,
      condition: expect.any(String),
    }));
    expect('wind_speed' in entry).toBe(true);
    expect('humidity' in entry).toBe(true);
  });
});

describe('ForecastDataSource', () => {
  let unsub;
  let conn;
  let hass;

  beforeEach(() => {
    unsub = vi.fn();
    conn = {
      subscribeMessage: vi.fn().mockResolvedValue(unsub),
    };
    hass = {
      connection: conn,
      states: {
        'weather.home': { attributes: { supported_features: WeatherEntityFeature.FORECAST_DAILY } },
        'weather.no_daily': { attributes: { supported_features: WeatherEntityFeature.FORECAST_HOURLY } },
        'weather.broken': { attributes: {} },
      },
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('emits an error event when weather_entity is not configured', async () => {
    const ds = new ForecastDataSource(hass, {});
    const events = [];
    ds.subscribe((e) => events.push(e));
    await Promise.resolve();
    expect(events).toEqual([{ forecast: [], error: 'weather_entity not configured' }]);
    expect(conn.subscribeMessage).not.toHaveBeenCalled();
  });

  it('emits an error event when entity is missing from hass.states', async () => {
    const ds = new ForecastDataSource(hass, { weather_entity: 'weather.ghost' });
    const events = [];
    ds.subscribe((e) => events.push(e));
    await Promise.resolve();
    expect(events[0].error).toMatch(/not found/);
    expect(conn.subscribeMessage).not.toHaveBeenCalled();
  });

  it('emits an error event when entity does not support daily forecast', async () => {
    const ds = new ForecastDataSource(hass, { weather_entity: 'weather.no_daily' });
    const events = [];
    ds.subscribe((e) => events.push(e));
    await Promise.resolve();
    expect(events[0].error).toMatch(/does not support daily forecasts/);
  });

  it('subscribes to weather/subscribe_forecast for a supported entity', async () => {
    const ds = new ForecastDataSource(hass, { weather_entity: 'weather.home', forecast: { type: 'daily' } });
    const events = [];
    ds.subscribe((e) => events.push(e));
    await Promise.resolve();
    expect(conn.subscribeMessage).toHaveBeenCalledTimes(1);
    const [, msg] = conn.subscribeMessage.mock.calls[0];
    expect(msg).toEqual({
      type: 'weather/subscribe_forecast',
      forecast_type: 'daily',
      entity_id: 'weather.home',
    });
  });

  it('forwards forecast events to the listener', async () => {
    const ds = new ForecastDataSource(hass, { weather_entity: 'weather.home' });
    const events = [];
    ds.subscribe((e) => events.push(e));
    await Promise.resolve();
    const [callback] = conn.subscribeMessage.mock.calls[0];
    callback({ forecast: [{ datetime: '2026-05-01T00:00:00Z', temperature: 20 }] });
    expect(events.at(-1)).toEqual({ forecast: [{ datetime: '2026-05-01T00:00:00Z', temperature: 20 }] });
  });

  it('unsubscribe disposes the underlying subscription', async () => {
    const ds = new ForecastDataSource(hass, { weather_entity: 'weather.home' });
    const cleanup = ds.subscribe(() => {});
    await Promise.resolve();
    await cleanup();
    expect(unsub).toHaveBeenCalled();
  });
});
