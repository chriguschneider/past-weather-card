# Testing

The card has a Vitest unit-test layer covering all non-DOM modules
(7 test files, 236 tests as of v1.0):

- `src/condition-classifier.js` — full decision-tree coverage (every
  threshold, every priority branch); per-period hourly thresholds since
  v0.8.4.
- `src/data-source.js` — `bucketPrecipitation` (all three sensor
  state-class paths + counter-reset fallback, both daily and hourly
  buckets), `MeasuredDataSource._buildForecast` and
  `_buildHourlyForecast` (output shape, ordering, sensor-offline
  handling, live-state fallback for current hour), and
  `ForecastDataSource` (subscribe / error / dispose for both daily
  and hourly modes).
- `src/format-utils.js` — `lightenColor` (rgba/rgb/hex/unknown formats,
  defensive nullish handling), `computeBlockSeparatorPositions` (every
  layout case incl. hourly mode), `computeInitialScrollLeft` (combination
  / station-only / forecast-only positioning).
- `src/forecast-utils.js` — `pickHourlyTickIndices`, `hourlyTempSeries`
  (single-line at hourly when no templow), `normalizeForecastMode`.
- `src/sunshine-source.js` and `src/openmeteo-source.js` — sunshine
  derivation paths (v0.9).
- `src/chart/plugins.js` — `createSeparatorPlugin` (daily + hourly
  modes, bail-out branches), `createDailyTickLabelsPlugin` (hourly
  early-return, doubled-today seam handling), `createSunshineLabelPlugin`.

Lit element rendering, the visual editor, and the Chart.js orchestration
in `_drawChartUnsafe` are *not* under unit test — visual verification in
a real Home Assistant dashboard is the contract there. v1.3 will close
that gap with Playwright E2E + visual regression tests (issue #14).

## Run

```bash
npm test            # one-shot, used by CI
npm run test:watch  # live-reload while writing tests
npm run coverage    # vitest run --coverage with v8 provider
```

`npm run build` runs lint → tests → bundle, so a failing test blocks
the release pipeline.

## Coverage gate

CI fails the build if branch + line coverage drop below **80 %**
(configured in `vitest.config.js`). Run `npm run coverage` locally to
see the per-file breakdown before pushing. The threshold is hard, not
informational — the README badge reflects the current % from the
latest CI run.

## Layout

```
tests/
  condition-classifier.test.js
  data-source.test.js
  format-utils.test.js
  forecast-utils.test.js
  sunshine-source.test.js
  openmeteo-source.test.js
  plugins.test.js
```

No fixtures directory yet; test data is inlined where it stays readable.
Promote to `tests/fixtures/*.js` if a payload becomes large enough that
the test reads better with the fixture imported.

## What to add when

- New classifier rule or threshold → extend `condition-classifier.test.js`
  with both a positive and a "just below the threshold" negative case.
- New sensor-driven field in `_buildForecast` → assert it surfaces in
  `entry` in the canonical-shape test.
- New behavioural config key (anything `set hass` reacts to) → cover the
  on / off / changed transition in `data-source.test.js` if the change
  happens inside a data source.

## What is intentionally not tested

- **Chart.js calls.** Mocking the canvas API or `Chart` constructor adds
  more setup than the assertions are worth. The drawing layer is
  validated visually.
- **Lit lifecycle.** `connectedCallback` / `updated` / `firstUpdated`
  ordering is the framework's contract, not ours. The interaction we
  *do* manage (data callbacks vs. shadow-root readiness) is guarded by
  early-return code paths instead of tests.
- **Editor DOM.** Almost entirely declarative `<ha-form>` / `<ha-switch>`
  / `<ha-entity-picker>` with one-line value-changed handlers — no
  meaningful logic to assert in isolation.
