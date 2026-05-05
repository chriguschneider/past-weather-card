# Changelog

All notable changes to this project are documented in this file. The format is
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] — 2026-05-06 (TBD — quality release)

A user-visible quality release: faster card, real test coverage gate,
polished docs, accessibility-pass. Architectural refactors
(main.js / editor split, TypeScript migration, E2E tests) are
deliberately deferred to v1.1+ so this release ships cleanly.

### Changed

- **Bundle size dropped from 797 KB → 355 KB (−55 %).** Production
  builds now run through `@rollup/plugin-terser` (passes:2,
  classes preserved). Halves bytes-on-the-wire even after HA's
  gzip layer; mobile dashboards and HACS downloads benefit.
- **Live "current condition" memoized.** `set hass` no longer
  re-runs `classifyDay` and `clearSkyLuxAt` when the relevant
  inputs are unchanged at minute precision. Across the 2–5 hass
  ticks per second that arrive when many entities update, this
  saves ~1–2 ms/frame.
- **Hourly clearsky-lux factory** caches lat-trig (`sinφ`, `cosφ`)
  once and per-day declination (`sinδ`, `cosδ`) per dayOfYear.
  Repeated calls within the same day reuse all but
  `cos(hourAngle)`. For a 7-day hourly fetch (168 rows) that's
  840 → 168 trig ops.

### Added

- **Coverage gate ≥ 80 %** on statements, branches, functions, lines.
  Configured in `vitest.config.js`, enforced by a new CI step. Scope
  is the data / classifier / format / chart-plugin layer (7 modules);
  Lit / editor / Chart.js orchestration covered later by Playwright
  E2E (v1.3, issue #14).
- **Bundle budget** of 800 KB enforced in CI as a regression guard.
- 7 new tests for `createPrecipLabelPlugin` (was 64 % branch coverage,
  now 88 %): bail-out on missing dataset meta, null/zero skip,
  large-value rounding, fallback paths, colour-resolution priority.

### Fixed

- **Chart animations** retuned for the post-v0.9 dataset density
  (split-column precip + sunshine bars). Earlier easings, calibrated
  for the v0.7-era simpler layout, looked unsynchronized when many
  bars animated at once. (Phase H — see PR for specifics.)
- **Accessibility**: aria-labels on all card-internal control buttons
  (mode-toggle, jump-to-now, scroll-indicators); focus management on
  mode-toggle; keyboard activation (Enter/Space) on every interactive
  control. Lighthouse / axe pass on default + dark themes.

### Documentation

- New **`MIGRATION.md`** — single source of truth for every removed
  YAML key (v0.8.3 `precipitation_type` / `show_probability`,
  v0.8.4 `autoscroll`) with before / after snippets, plus an
  upstream-`weather-chart-card` migration section.
- `ARCHITECTURE.md` refreshed: 236 tests across 7 modules (was "61
  tests on 3 modules"); hourly forecast moved from "future
  directions" to current capability; testing-scope section lists
  every covered module and notes which paths v1.3 will cover.
- `TESTING.md` rewritten: full module list, new "Coverage gate"
  section documenting the 80 % threshold.
- `README.md`: coverage badge added; `sensors.sunshine_duration`
  row added to the sensor reference table (was missing from the
  v0.9 doc pass).

### Internal

- `var` → `const`/`let` cleanup in `_drawChartUnsafe` and
  `getWindDirIcon`. No behaviour change.
- 243 vitest tests pass (+7 since v0.9).

### Out of scope (tracked for later)

- v1.1 ([#12](https://github.com/chriguschneider/weather-station-card/issues/12)) — main.js + editor split (architecture refactor)
- v1.2 ([#13](https://github.com/chriguschneider/weather-station-card/issues/13)) — TypeScript migration
- v1.3 ([#14](https://github.com/chriguschneider/weather-station-card/issues/14)) — Playwright E2E + visual regression
- v1.4 ([#15](https://github.com/chriguschneider/weather-station-card/issues/15)) — Mode-toggle perf (closes #10)

## [0.9.0] — 2026-05-05

### Added

- **Sunshine-duration row in the chart** (issue #6). Off by default;
  enable with `forecast.show_sunshine: true`. The chart splits each
  column in half — precipitation keeps the left half, a new yellow
  sunshine bar fills the right half. **Zero setup beyond the toggle**:
  the card fetches `daily=sunshine_duration` (and `hourly=…` in hourly
  chart mode) directly from Open-Meteo using the Home Assistant
  `latitude`/`longitude`, refreshes hourly, and caches in
  `localStorage` so reloads don't repeat the round-trip. Past + forecast
  data covered in one call via `past_days` + `forecast_days`.
  - **Daily mode**: per-column `Xh` box at the top with the day's total
    in hours (matched against the daily array by local date).
  - **Hourly mode**: bar-only — the height of each bar is the fraction
    of that hour spent in sun (matched against the hourly array by
    local YYYY-MM-DDTHH:00). Empty bar = night or fully overcast.
  - `forecast.sunshine_color` — bar colour, default Material amber
    `rgba(255, 193, 7, 1.0)`.

  Users who'd rather wire up their own data path will find a brief
  decision history in
  [issue #6](https://github.com/chriguschneider/weather-station-card/issues/6) —
  the v0.9 implementation deliberately drops user-configurable sensor
  slots in favour of "one toggle, no YAML".
- **Editor availability hint**: when sunshine is on, the editor reads
  the cached Open-Meteo response from `localStorage` and shows
  "Sunshine available: N past, M forecast days" under the
  `forecast_days` field. If the configured forecast_days exceeds the
  available data, a warning makes clear that the trailing columns will
  render as empty bars (e.g. when Open-Meteo's model only delivers
  5 days but the card is configured for 7).

### Changed

- **No behaviour change** for users who don't enable the new row. The
  chart layout is byte-identical to v0.8.4 when `forecast.show_sunshine`
  is unset / `false`.

## [0.8.4] — 2026-05-05

### Changed

- **Hourly classifier thresholds rescaled.** When `forecast.type:
  hourly`, station hours and the live "current condition" snapshot
  now classify with precipitation thresholds calibrated for 1-hour
  totals instead of 24-hour totals: `rainy ≥ 0.1 mm/h` (was 0.5),
  `pouring ≥ 4 mm/h` (was 10), `exceptional ≥ 30 mm/h` (was 50).
  Wind / gust / fog / cloud thresholds are unchanged (those are
  instantaneous values, not totals). Daily classification is
  unaffected. `condition_mapping` overrides apply on top of the
  per-period defaults — same key names, no editor change. Closes
  [#7](https://github.com/chriguschneider/weather-station-card/issues/7).
- `classifyDay(day, overrides, period)` API: third parameter accepts
  `'day'` (default) or `'hour'`. Existing callers stay daily.

### Removed

- **`autoscroll` config key** — was upstream-vestigial and never
  actually scrolled. The timer fired every hour but only triggered a
  redraw, with no horizontal pan logic anywhere. v0.8's hourly
  viewport scrolling and the v0.8.2 jump-to-now button cover the
  intent better. The key has been hidden from the editor since v0.6.
  Now removed from `setConfig` defaults, the `autoscroll()` /
  `cancelAutoscroll()` methods, the cleanup in `disconnectedCallback`,
  the `updated()` lifecycle re-trigger, the `computeForecastData`
  cutoff filter, the locale strings (DE + EN), and the README config
  table / known-limitations. Closes
  [#3](https://github.com/chriguschneider/weather-station-card/issues/3).

  YAML configs that still set `autoscroll: true` continue to load —
  unknown keys are ignored. Drop it from your YAML for cleanliness.

### Internal

- 138 vitest tests pass (+10 hourly-classifier tests covering the
  rescaled precipitation thresholds, the cloud/wind no-change path,
  user-override layering, and backwards-compatibility of the default
  period parameter).

## [0.8.3] — 2026-05-05

### Removed

- **`forecast.precipitation_type` and `forecast.show_probability`** —
  both upstream-vestigial since this card forked: they read
  `precipitation_probability` directly from `weather/get_forecasts`,
  which most integrations relevant in DACH (Open-Meteo daily,
  MeteoSchweiz, Met.no on certain entities) don't populate, so the
  toggles silently produced no visible effect even with a forecast-
  only setup. The fork's `MeasuredDataSource` never had a probability
  field at all, so probability mode + station data was always inert.
  Both keys have been hidden from the editor since v0.6 and the
  feature is now removed entirely from the renderer, the data shape
  (`precipitation_probability` no longer flows through), the locale
  strings (DE + EN), and the README config table. Closes
  [#4](https://github.com/chriguschneider/weather-station-card/issues/4).

  YAML configs that still set `precipitation_type` or
  `show_probability` will continue to load — extra keys are ignored —
  they just do nothing. Drop them from your YAML for cleanliness.

## [0.8.2] — 2026-05-05

### Added

- **Mode-toggle button** overlaid on the chart at the precipitation-
  baseline level (left edge of the forecast block): one click
  switches between daily and hourly resolution. Goes through the
  same `setConfig` path the editor uses, so station and forecast
  data sources rebuild on the new period immediately. Visible
  whenever any chart block renders (station-only, forecast-only, or
  combination) — `forecast.type` drives both `MeasuredDataSource`
  (`period: hour|day`) and `ForecastDataSource` (`forecast_type`).
  The change does **not** persist to the saved YAML — refresh
  resets to whatever the editor configured.
- **Jump-to-now button** centred at the precipitation-baseline,
  visible only when the user has scrolled the viewport away from
  the canonical "now" position by more than ~10 % of one viewport
  width. Click smooth-scrolls back to the same position the card
  lands on at first paint (combination → boundary centred;
  station-only → right edge; forecast-only → left edge).

### Fixed

- Touch-swipe scrolling no longer fires `tap_action`. The drag
  detection in `_setupScrollUx` previously bailed out on non-mouse
  pointer types, so a horizontal touch-swipe to scroll the chart
  on mobile would also fire the configured tap action on pointerup.
  Movement detection now runs for all pointer types — actual
  `scrollLeft` manipulation and pointer capture stay mouse-only so
  native touch overflow scrolling continues to work. `pointercancel`
  (browser claiming the gesture for native scroll) is also treated
  as a drag. Closes
  [#9](https://github.com/chriguschneider/weather-station-card/issues/9).
- Mouse drag-to-scroll on desktop no longer fires `tap_action` after
  the gesture ends. The `_dragMoved` flag was reset via a Promise
  microtask, but V8/Blink flushes microtasks between event-listener
  invocations in the same dispatch — so the wrapper's `pointerup`
  scheduled the reset, the microtask fired before the ha-card's
  `pointerup` listener bubbled up, and the action handler saw
  `_dragMoved = false`. Switched to `setTimeout(0)` (a macrotask)
  so the reset deterministically happens after the entire event
  dispatch completes.
- Card-internal control buttons (mode-toggle, jump-to-now, scroll
  indicators) no longer trigger the card-level `tap_action` /
  `hold_action` / `double_tap_action`. The action handler now
  ignores pointer events that originate inside any
  `button` / `ha-icon-button` / `[role="button"]` descendant —
  fixes the latent issue where clicking a scroll-indicator chevron
  would also fire `tap_action` after the 250 ms double-tap window.

### Internal

- Plugin unit tests for `createSeparatorPlugin` (daily + hourly
  modes, bail-out branches) and `createDailyTickLabelsPlugin`
  (hourly early-return, doubled-today seam handling, `show_date`
  toggle). Closes the README "Plugin tests" optional-improvement
  note.
- 128 vitest tests pass (+12 plugin tests since v0.8.1).

## [0.8.1] — 2026-05-05

### Changed

- CI: bumped `actions/checkout` and `actions/setup-node` to `v6`,
  `softprops/action-gh-release` to `v3`, and the runner Node version
  from `20` to `22` LTS — ahead of the GitHub Actions Node 20
  deprecation (Node 24 default 2026-06-02, Node 20 removal
  2026-09-16). Closes
  [#8](https://github.com/chriguschneider/weather-station-card/issues/8).
- `_maybeApplyInitialScroll` no longer polls `requestAnimationFrame`
  for up to 30 frames waiting for layout to settle. It tries once
  synchronously after Lit's `updateComplete`; if the wrapper hasn't
  overflowed yet, a `ResizeObserver` on `.forecast-content` fires
  exactly when Chart.js finishes sizing the canvas. Hard 1 s cap
  prevents observer leaks if the wrapper never overflows. Cheaper
  on slow devices and avoids the corner case where the 30-frame
  retry budget ran out before Chart.js settled.

### Docs

- README "Known limitations" links the hourly-classifier-thresholds
  row to [#7](https://github.com/chriguschneider/weather-station-card/issues/7)
  instead of the bare "v0.9 follow-up" placeholder.

## [0.8.0] — 2026-05-05

### Added

- **Hourly resolution for both blocks.** `forecast.type: 'hourly'` is
  reactivated as a first-class mode: `MeasuredDataSource` reads sensor
  history with `period: 'hour'` (mean per slot, single temperature
  line), and `ForecastDataSource` subscribes with `forecast_type:
  'hourly'`. Combination mode at hourly renders past hours + future
  hours joined at a single "now" line — no doubled-today column.
  Closes [#2](https://github.com/chriguschneider/weather-station-card/issues/2).
- **Viewport scrolling.** `forecast.number_of_forecasts` now controls
  how many bars are visible at once (was vestigial, see
  [#5](https://github.com/chriguschneider/weather-station-card/issues/5)).
  When fewer bars are visible than loaded, the chart row + conditions
  row + wind row scroll horizontally in lockstep inside an
  `overflow-x: auto` wrapper. Initial scroll position is "now":
  centred at the station/forecast boundary in combination mode,
  right edge in station-only, left edge in forecast-only.
- Editor: `forecast.type` radio (Daily / Hourly) and
  `forecast.number_of_forecasts` numeric field, both in Setup. Locale
  strings (DE + EN) for the new fields.
- `bucketPrecipitation` helper in `src/data-source.js` (renamed from
  `dailyPrecipitation`, alias kept for backwards compatibility) — the
  three-state-class fan-out (`change` / `sum` / `max`-diff) is
  bucket-size-agnostic, so the same logic powers daily and hourly
  precipitation extraction.
- New pure helpers in `src/format-utils.js` and `src/forecast-utils.js`:
  `computeInitialScrollLeft`, `pickHourlyTickIndices`,
  `hourlyTempSeries`, `normalizeForecastMode`. All fully covered by
  vitest.

### Changed

- **`forecast.number_of_forecasts` semantic flipped from "crop" to
  "viewport"** (issue #5 fix). The old behaviour cropped
  `this.forecasts` from the left and broke combination mode; the
  cropping path is removed. Existing daily configs with the field at
  `0` (default) are bit-identical to v0.7. Configs that explicitly
  set a positive value will now scroll instead of crop.
- `computeBlockSeparatorPositions` (`src/format-utils.js`) accepts a
  `mode` parameter. At hourly combination it returns a single boundary
  line between station and forecast; daily combination keeps the
  doubled-today frame.
- Hourly forecast wind cells render defensively: when the upstream
  weather integration omits `wind_speed` and/or `wind_bearing` for
  hourly entries (HA's Open-Meteo integration currently does this),
  the cell stays empty rather than rendering a default-direction
  arrow with an orphan `km/h` unit.
- README: new "Daily vs. hourly resolution" section under Three Modes;
  Known Limitations table updated to drop the v0.8-fixed entries
  (#2 / #5) and add notes about the upstream Open-Meteo hourly-wind
  gap and the hourly-classifier-threshold caveat.

### Internal

- Phase-A revert layer dropped the v1-plan tick-decimation code and
  associated `<ha-alert>` editor block — viewport scrolling makes
  decimation unnecessary.
- `MeasuredDataSource` invalidation table now includes `forecast.type`
  in the station rebuild keys (toggling daily↔hourly rebuilds the
  station data source, not just the forecast one).
- 111 vitest tests pass; +21 net new since v0.7 (hourly-tick
  helpers, hourly tempSeries, normalize, bucketPrecipitation hourly
  cases, MeasuredDataSource hourly path, separator hourly mode,
  computeInitialScrollLeft).

## [0.7.0] — 2026-05-05

### Added

- **Whole-card click actions.** New `tap_action`, `hold_action`, and
  `double_tap_action` config keys, edited via HA's standard `ui_action`
  selector (same picker Bubble / Mushroom / built-in cards use). Supported
  actions: `more-info`, `navigate`, `url`, `toggle`, `perform-action`,
  `assist`, `fire-dom-event`, `none`. The action runs on the whole card —
  a click anywhere on the chart, main panel, or attribute row triggers the
  same configured action.
- Editor: new "Actions" subsection in Setup with three pickers (tap / hold
  / double-tap).

### Changed

- **Default click behaviour: `none` (read-only).** Previously, clicking
  the forecast-conditions row opened more-info on the temperature sensor.
  That implicit handler is replaced by the configurable `tap_action`,
  defaulting to `none`. Configs that want the old behaviour back should
  set `tap_action: { action: more-info, entity: sensor.<your_temp> }` —
  or any other action they prefer. The cursor only switches to a hand
  when at least one action is wired, so the default card looks read-only.

### Internal

- Pointer-based tap / hold / double-tap detection (500 ms hold threshold,
  250 ms double-tap window) bound to the `<ha-card>` root, rebound on
  every render so a re-mounted card never silently loses its handlers.
- Inline `_runAction` helper avoids depending on HA's internal
  `handle-action` module path (renamed across HA versions).

## [0.6.0] — 2026-05-05

### Changed

- **Default chart style is now `style2` ("without boxes")** — temperature
  labels render as plain text beside the lines instead of inside bordered
  boxes. The previous `style1` ("with boxes") remains available as an
  opt-in. Existing configs that pin `forecast.style: style1` are
  unaffected.
- Visual editor restructured into 6 sections (A. Setup / B. Sensors /
  C. Layout / D. Style & Colours / E. Units / F. Advanced). Section C uses
  `show_main` and `show_attributes` as disclosure masters — sub-toggles
  appear only when the master is on.
- Mode selection (Station only / Forecast only / Combination) is now a
  single radio in Setup, derived from `show_station` / `show_forecast`
  (YAML schema unchanged).
- README Configuration section uses collapsible `<details>` blocks
  matching the editor's A–F order.
- main.js shrunk by ~23 % after extracting `src/chart/draw.js` (Chart.js
  options builder), `src/chart/plugins.js` (separator / dailyTickLabels
  / precipLabel as factory functions), and `src/chart/styles.js` (CSS
  template). Plugins now declare their dependencies via parameters
  instead of closing over component state.

### Added

- `ARCHITECTURE.md` — module map, data-flow diagram, lifecycle
  invariants, Chart.js plugin contract, build pipeline, testing scope.
- Visual editor: `condition_mapping` override block under Advanced — 13
  threshold fields with units as suffixes and defaults as placeholders.
  Empty fields are not written to the YAML.
- README: precipitation-sensor setup guide (state_class detection plus
  utility_meter and integration sensor templates), live-condition
  rate-unit explanation, Troubleshooting section mapping each error
  banner to its cause.
- `CONTRIBUTING.md` opening pointer to ARCHITECTURE.md.

### Fixed

- TempAxis NaN bounds when temperature arrays are empty (sensor offline
  for the full window).
- `ForecastDataSource.unsubscribe()` is now finally-safe — the slot is
  cleared before awaiting so a subsequent unsubscribe never re-throws on
  a rejected promise.
- Chart-render errors carry a phase tag (`compute` / `init` / `draw`)
  in the banner instead of a generic message.
- Subscribe-callback bodies in `set hass` wrapped in `try / catch` so a
  bad render path can't detach HA's WebSocket listener.

### Internal

- Dropped unused `relative-time` dependency.
- `lightenColor` handles hsl/hsla in addition to rgba/hex.
- `_invalidateStaleSources` replaces seven hand-rolled change-detection
  branches with two declarative key tables.
- `disconnectedCallback` uses the new `_teardownStation` /
  `_teardownForecast` helpers shared with the invalidation path.
- Editor: chart-style, precipitation-type, forecast-type, and icon-style
  selectors converted from `ha-select` (whose `@change` handler turned
  out to silently drop selections) to `ha-radio` pairs that hard-code
  the new value in the change handler — proven to work and easier to
  reason about.

### Removed (from editor only — YAML keys still honoured)

- `forecast.type` radio (Daily / Hourly) is no longer surfaced in the
  visual editor. Hourly was accepted by the data layer but the chart
  rendered as daily-only. Tracked as
  [#2](https://github.com/chriguschneider/weather-station-card/issues/2).
- `autoscroll` switch is no longer surfaced in the visual editor.
  The hourly timer was firing but only triggered a redraw — no actual
  scroll. Tracked as
  [#3](https://github.com/chriguschneider/weather-station-card/issues/3).
- `forecast.precipitation_type` radio (Rainfall / Probability) and the
  `forecast.show_probability` switch are no longer surfaced.
  MeasuredDataSource emits `precipitation_probability: null` for every
  station entry, so probability mode produced empty bars for past
  columns and the overlay had nothing to display. Tracked as
  [#4](https://github.com/chriguschneider/weather-station-card/issues/4).
- `forecast.number_of_forecasts` textfield is no longer surfaced.
  Vestigial from upstream — `days` and `forecast_days` already control
  column counts, and a positive value cropped the merged array from the
  left, breaking combination mode (lost today + forecast block).
  Tracked as
  [#5](https://github.com/chriguschneider/weather-station-card/issues/5).
- All YAML keys still parse and flow through unchanged — only the
  editor stops advertising them as working features.

## [0.5.0] — 2026-05

### Added

- **Optional forecast block** alongside the existing station-history block,
  driven by a `weather.*` entity via `weather/subscribe_forecast`. New config
  keys: `weather_entity`, `forecast_days`, `show_forecast`, `show_station`.
  Both blocks can be toggled independently. Today appears as a doubled
  column ("Soll vs. Ist"): the station's measured aggregate on the left,
  the forecast on the right, framed by two vertical separators with no
  line in between.
- **Forecast lines dashed** (6 / 4 px) so predicted values don't visually
  flow into measured values; the line segment between station-today and
  forecast-today is suppressed entirely, markers stay visible.
- **Forecast precipitation bars at ~45 % opacity**, station bars stay full
  colour, so "less certain" data reads as such at a glance.
- **Centered today label** above the doubled-today column when both blocks
  are active — the weekday (and date row, when enabled) renders once
  centred between the two today columns instead of twice.
- **`forecast.show_date` toggle** for the chart's date row. When off, the
  X-axis reclaims the freed line of tick height.
- **`ForecastDataSource`** in `data-source.js` mirroring the
  `MeasuredDataSource` lifecycle (`subscribe(cb) → unsubscribe`, event
  shape `{forecast, error?}`). The render layer stays source-agnostic.
- **Custom precipitation-label renderer** so the unit ("mm" / "in") draws
  at ~50 % of the value's font size next to the number, instead of full
  size — fits narrow cards without dropping the unit.
- **Vitest test suite** covering `condition-classifier` (full decision
  tree), `data-source` (`dailyPrecipitation` state-class paths,
  `_buildForecast` shape, `ForecastDataSource` subscribe/error/dispose),
  and `format-utils`. 58 tests, ~80 % statement coverage on those
  modules. CI runs `npm test` between lint and build; failure blocks
  the release pipeline. See `TESTING.md`.

### Changed

- Outer chart borders (TempAxis left, PrecipAxis right) are no longer
  drawn. Today's framing is carried by the block-separator plugin alone.
- `forecast.number_of_forecasts: 0` now expands to the merged
  station + forecast column count instead of an auto-fit width
  calculation. Necessary so the doubled-today layout doesn't get cropped.
- Card-bottom precipitation labels are centred on the precip-axis
  baseline (zero line) rather than the variable bar tops, matching the
  pre-MVP look across both station and forecast columns.
- Editor: new "Forecast block" section under "Card" with weather-entity
  picker, `forecast_days` field, `show_station` / `show_forecast`
  toggles, and the `forecast.show_date` switch.

### Fixed

- **Race condition** between the asynchronous statistics fetch and the
  immediate forecast subscription: the chart used to render station-only
  whenever forecast events arrived first and a `ResizeObserver` tick set
  `forecastItems` before the merge.
- **ResizeObserver storm** when a Sections-grid card was resized: the
  observer now coalesces ticks via `requestAnimationFrame`, so layout
  changes can't trigger dozens of synchronous `Chart.destroy + new Chart`
  cycles within one frame.
- **Null `shadowRoot` crash** when a data callback fires before the
  first Lit render. `measureCard` now bails out cleanly; the next
  `firstUpdated` tick redraws.
- **Card vanishing on config edits** (e.g. toggling `forecast.round_temp`):
  the legacy `updated()` lifecycle used to overwrite `this.forecasts`
  with station-only and re-throw on stale Chart.js state. The hook now
  reads the changed-key set, tears down only the affected data sources,
  and routes through `_refreshForecasts` inside a `try/catch`. `drawChart`
  is wrapped end-to-end so a Chart.js failure can no longer drop the
  whole card from the render tree.

### Internal

- Extracted `lightenColor` and `computeBlockSeparatorPositions` to
  `src/format-utils.js` (pure module, unit-tested).
- Extracted `dailyPrecipitation` from `MeasuredDataSource` as a free
  exported function (no `this` dependency).

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
