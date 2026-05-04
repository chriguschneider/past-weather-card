# Changelog

All notable changes to this project are documented in this file. The format is
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.0] — 2025-05

### Breaking changes

The following config keys have been removed because the underlying data was
never available in a sensor-history-driven card. They are silently ignored
when set:

- `show_feels_like` — apparent-temperature attribute is not synthesized
- `show_description` — narrative weather description is not available
- `show_visibility` — no visibility sensor is mapped
- `show_last_changed` — `weather.last_changed` was never set on the synthesized
  entity; the value rendered as empty regardless

If you set any of these to `true`, simply remove them from the YAML.

### Added

- Render-time error banner. Persistent statistics-fetch failures and configured
  sensor entities reporting `unavailable` / `unknown` are now surfaced in the
  card itself instead of only in the browser console.
- `CHANGELOG.md`, `CONTRIBUTING.md`, `info.md`.
- GitHub Actions build workflow that lints, builds, verifies the committed
  bundle matches source, and uploads `dist/weather-station-card.js` as a
  release asset on tag push. Version-tag alignment is enforced.

### Changed

- Full README rewrite: hero + screenshots + HACS install + manual install +
  minimal config + complete configuration reference + condition-determination
  reference. The previous "Not yet ready for end users" placeholder is gone.
- Expanded `package.json` metadata: HTTPS repository URL, `homepage`, `bugs`,
  `main`, additional keywords for HACS discoverability.

### Fixed

- ESLint config (`.eslintrc.json`) raised to ES2022 so optional chaining and
  nullish coalescing parse correctly. Until v0.3.1 the lint pipeline silently
  errored on `??`, masking real findings.
- `npm run lint` script now uses `eslint src` instead of a quoted glob, so it
  actually lints files on Windows shells.
- `setInterval` clock leak in `renderMain`. The 1 Hz clock interval was
  recreated on every render without cleanup. It is now stored on the instance
  and cleared before re-creation and on `disconnectedCallback`.
- `autoscroll()` typo: a misnamed inner call (`drawChartOncePerHour`) would
  throw `ReferenceError` if the user enabled `autoscroll: true`.
- `calculateBeaufortScale` no longer throws on missing `wind_speed_unit`; it
  falls back to m/s.
- `_poll` in `data-source.js` now surfaces persistent fetch failures (after
  three consecutive failures) instead of silently leaving the card with stale
  data.

## [0.3.1] — 2025-05

### Added

- Live current-condition rendering in the main panel. The synthesized weather
  entity now has a `state` field derived from a fresh classification of
  current sensor states.
- `clearSkyLuxAt(lat, lon, date)` — instantaneous solar reference for live
  cloud-cover ratios (replaces the noon-only model used for daily rows).
- README "Current (now) condition" section.

### Notes

- Live-condition precipitation only contributes when the sensor's
  `unit_of_measurement` is a rate (`mm/h`, `mm/hr`, `mm/hour`). With a
  cumulative counter the live path falls through to cloud / wind / fog rules.

## [0.3.0] — 2025-05

### Breaking changes

- Default for `condition_mapping.windy_threshold_ms` changed from 14 to 10.8
  m/s to align with Beaufort 6 ("strong breeze", WMO No. 306).

### Added

- Sensor-driven daily condition classifier (`src/condition-classifier.js`)
  with WMO / NOAA / NWS / AMS / METAR / IES citations on every threshold.
- `clearSkyNoonLux(lat, day_of_year)` — theoretical clear-sky illuminance at
  solar noon for the cloud-cover ratio.
- New `condition_mapping` override keys: `pouring_threshold_mm`,
  `exceptional_gust_ms`, `exceptional_precip_mm`, `snow_max_c`,
  `snow_rain_max_c`, `fog_humidity_pct`, `fog_dewpoint_spread_c`,
  `fog_wind_max_ms`, `windy_mean_threshold_ms`, `sunny_cloud_ratio`,
  `partly_cloud_ratio`.
- README "How daily conditions are determined" section with the full decision
  tree and source list.

### Changed

- Daily icon now reflects every available statistic (temperature min/max,
  humidity, illuminance max, precipitation total, wind mean, gust max, dew
  point) instead of only `(precipitation, lux, gust)`.
- Worst-of-day priority: `exceptional` → `snowy` / `snowy-rainy` / `pouring` /
  `rainy` → `fog` → `windy` / `windy-variant` → `sunny` / `partlycloudy` /
  `cloudy`.

### Notes

- `lightning`, `lightning-rainy`, and `hail` are intentionally never emitted —
  reliable detection requires dedicated hardware (AS3935, hail-pad).

## [0.2.0] — 2025-05

### Added

- "Today" highlighting in the past-7-day chart: bold weekday and high/low
  temperatures for today's column, lighter date subtitle.
- DE + EN editor translations; remaining 21 languages fall back to English.

### Changed

- Visual editor: device-class-aware sensor pickers, flat layout (tabs
  removed), unified section headings.

## [0.1.x] — 2025-04 / 2025-05

Initial fork of [`mlamberts78/weather-chart-card`](https://github.com/mlamberts78/weather-chart-card)
v1.0.1. Replaced the `weather.*`-entity data path with a `recorder/statistics_during_period`
driver. Iterative refinement of unit handling, sensor pickers, today-column
emphasis, and date / weekday rendering.
