# Testing

The card has a small but high-value unit-test layer covering the three
non-DOM modules:

- `src/condition-classifier.js` — full decision-tree coverage (every
  threshold, every priority branch).
- `src/data-source.js` — `dailyPrecipitation` (all three sensor
  state-class paths + counter-reset fallback), `MeasuredDataSource._buildForecast`
  (output shape, ordering, sensor-offline handling), and `ForecastDataSource`
  (subscribe / error / dispose).
- `src/format-utils.js` — `lightenColor` (rgba/rgb/hex/unknown formats,
  defensive nullish handling) and `computeBlockSeparatorPositions`
  (every layout case: combined / station-only / forecast-only / edges).

Lit element rendering, the visual editor, and Chart.js drawing are *not*
under test — visual verification in a real Home Assistant dashboard is
the contract there.

## Run

```bash
npm test            # one-shot, used by CI
npm run test:watch  # live-reload while writing tests
npm run coverage    # text summary for the three covered modules
```

`npm run build` runs lint → tests → bundle, so a failing test blocks
the release pipeline.

## Layout

```
tests/
  condition-classifier.test.js
  data-source.test.js
  format-utils.test.js
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
