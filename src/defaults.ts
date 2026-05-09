// Single source of truth for the card's configuration defaults.
// Both `setConfig` (user YAML merge) and `getStubConfig` (visual editor
// "first add" path) consume this object, so the two cannot drift.

export const DEFAULTS_FORECAST = {
  labels_font_size: 11,
  chart_height: 180,
  precip_bar_size: 100,
  // Default chart style: temperature labels rendered as plain text
  // beside the lines (no boxes around each value). 'style1' was the
  // legacy default with bordered boxes — kept as an opt-in.
  style: 'style2',
  // Theme-aware colour defaults: each falls back to its v1.x literal
  // when the user's HA theme doesn't define the token. Chart.js
  // doesn't resolve var() natively in our pinned version, so the
  // chart pipeline expands these via resolveCssVar at draw time.
  // User-set RGBA / hex strings still win — pass-through.
  temperature1_color: 'var(--state-sensor-temperature-color, rgba(255, 152, 0, 1.0))',
  temperature2_color: 'var(--info-color, rgba(68, 115, 158, 1.0))',
  precipitation_color: 'var(--state-sensor-precipitation-color, rgba(132, 209, 253, 1.0))',
  show_sunshine: false,
  // Sun is universally yellow — every HA "yellow"-ish token
  // (--warning-color, --label-badge-yellow, --state-sun-color) drifts
  // to orange / amber / red in different themes. The literal stays
  // predictable; users who want theme-driven sunshine can pass their
  // own var(...) string in YAML.
  sunshine_color: 'rgba(255, 215, 0, 1.0)',
  condition_icons: true,
  // DEPRECATED v1.9.x — see renderWind in main.ts. Kept as a hard
  // master-off shim for v1.x YAML configs with show_wind_forecast:
  // false; slated for removal in v2.0. New installs should not set it.
  show_wind_forecast: true,
  show_wind_arrow: true,
  show_wind_speed: true,
  show_date: true,
  round_temp: true,
  type: 'daily',
  number_of_forecasts: 8,
  disable_animation: false,
  '12hourformat': false,
} as const;

export const DEFAULTS_UNITS = {
  pressure: 'hPa',
} as const;

export const DEFAULTS = {
  // Layout master toggles — opt-out for headline rows, opt-in for the
  // detail rows. Render code reads these as `true === cfg.x` (opt-in)
  // or `false !== cfg.x` (opt-out); explicit defaults match that intent.
  // Combination is the most common use-case (station + forecast side-
  // by-side) and showcases the card's strength. New cards land in
  // combination mode; users opt into station-only / forecast-only via
  // the editor radio.
  show_station: true,
  show_forecast: true,
  show_main: false,
  show_temperature: true,
  show_current_condition: false,
  show_attributes: false,
  show_time: false,
  show_time_seconds: false,
  show_day: false,
  show_date: false,
  show_humidity: false,
  show_pressure: false,
  show_wind_direction: true,
  show_wind_speed: true,
  show_sun: false,
  show_dew_point: false,
  show_wind_gust_speed: false,
  // UV index defaults to true to preserve v1.x behaviour where UV was
  // always shown if a sensor was wired. The other three new attribute
  // cells default to false so existing layouts don't suddenly grow.
  show_uv_index: true,
  show_illuminance: false,
  show_precipitation: false,
  show_sunshine_duration: false,
  use_12hour_format: false,

  // Sizing
  icons_size: 25,
  current_temp_size: 28,
  time_size: 26,
  day_date_size: 15,

  // Past-data window
  days: 7,

  // Forecast
  weather_entity: '',
  forecast_days: 7,
  forecast: DEFAULTS_FORECAST,

  // Units
  units: DEFAULTS_UNITS,

  // Sensors — populated by getStubConfig auto-detection or by user YAML
  sensors: {},

  // Tap actions — opt-in
  tap_action: { action: 'none' },
  hold_action: { action: 'none' },
  double_tap_action: { action: 'none' },
} as const;
