# Architecture

Reading order for new contributors. Skim top-to-bottom; come back to the
section your change touches.

## Module map

| File | Responsibility |
| ---- | -------------- |
| `src/main.js` | Lit element, lifecycle (`set hass` / `updated` / `disconnectedCallback`), `render()` template, chart construction (`drawChart` / `_drawChartUnsafe`), inline Chart.js plugins, error banner, attribute panels. |
| `src/data-source.js` | Two data sources behind a common contract. `MeasuredDataSource` polls `recorder/statistics_during_period`. `ForecastDataSource` subscribes to `weather/subscribe_forecast`. Both emit `{forecast, error?}` via a `subscribe(callback) → unsubscribe` interface. |
| `src/condition-classifier.js` | Pure function `classifyDay(day, overrides)` that maps daily aggregates to a Home Assistant `weather.*` condition. Threshold defaults are sourced from WMO / NWS / AMS / IES — see `DEFAULTS` block. |
| `src/format-utils.js` | Stateless helpers shared by tests + render: `lightenColor` (rgba/hex/hsl/hsla → reduced-alpha rgba/hsla) and `computeBlockSeparatorPositions` (where today-framing lines go). |
| `src/const.js` | `WeatherEntityFeature` bitflag constants, weather-icon name maps (mdi: + day/night). |
| `src/locale.js` | Language → translation table. Each entry has condition labels + an optional `editor: { … }` block. Falls back lang → base-lang → English → key. |
| `src/weather-station-card-editor.js` | Visual config editor (LitElement). `ha-form` schemas, dynamic device_class detection for sensor pickers. |

The 3 modules with pure logic (`data-source`, `condition-classifier`,
`format-utils`) are unit-tested via Vitest. `main.js` and the editor are
not — see [Testing scope](#testing-scope).

## Data flow

```
HA WebSocket / sensor states
     │
     ▼
┌─────────────────────┐    ┌──────────────────────┐
│ MeasuredDataSource  │    │ ForecastDataSource   │
│  - polls statistics │    │  - subscribes to     │
│    every 60 min     │    │    weather/forecast  │
│  - classifies via   │    │  - passes through    │
│    classifyDay()    │    │    integration data  │
└──────────┬──────────┘    └──────────┬───────────┘
           │                          │
           │ subscribe callback       │
           ▼                          ▼
   this._stationData            this._forecastData
                  │              │
                  └──────┬───────┘
                         ▼
              _refreshForecasts()
                         │  this.forecasts = [...station, ...forecast]
                         ▼
                 measureCard()
                         │  forecastItems = forecasts.length
                         ▼
                 drawChart()
                         │  destroys + rebuilds Chart.js instance
                         ▼
                  Chart.js + plugins
                         │
                         ▼
                  <canvas id="forecastChart">
```

Three guarantees:

1. **Single merge point.** `_refreshForecasts` is the only place that
   writes `this.forecasts`. Both data callbacks plus `updated()` after
   config edits route through it. Anywhere you see `this.forecasts = …`
   outside this method is a bug.
2. **Idempotent redraw.** `measureCard → drawChart` rebuilds the Chart.js
   instance from scratch every time. There is no incremental update path
   (the previous `updateChart` was simplified to a `drawChart` shim
   precisely because incremental was a footgun).
3. **`set hass` decides which sources exist.** The two `if (wantStation)` /
   `if (wantForecast)` blocks in `set hass` are the source-of-truth for
   "should this data source be alive right now?". `updated()` only tears
   down stale ones via `_invalidateStaleSources`; recreation happens on
   the next `set hass` tick.

## The `forecasts` array shape

Both data sources emit objects of this shape (one per day):

```js
{
  datetime: ISOString,             // midnight of the day, local
  temperature: number | null,      // daily max
  templow: number | null,          // daily min
  precipitation: number | null,    // mm or in (depending on length unit)
  wind_speed: number | null,       // mean
  wind_gust_speed: number | null,  // daily max
  wind_bearing: number | null,     // mean degrees
  pressure: number | null,
  humidity: number | null,
  uv_index: number | null,
  condition: string,               // e.g. 'cloudy', 'sunny', 'rainy'
}
```

Anything that consumes `this.forecasts` (chart, condition icons, wind row,
tooltip) reads from this shape. Adding a new metric means adding a field
here AND its source field in `_buildForecast` (data-source.js).

## Lifecycle

`set hass` runs on every HA state update — many times per second when the
dashboard is busy. The work it does is intentionally cheap:

1. Re-derive `currentCondition` from current sensor states (synthesised
   "weather" object for the main panel).
2. Decide `wantStation` / `wantForecast` from current config.
3. Create or `setHass(hass)` the data sources accordingly.
4. **Do not** call `_refreshForecasts` directly except for the one-time
   initial-empty case (`if (!this.forecasts) this._refreshForecasts()`).
   The data sources call back into `_refreshForecasts` themselves when
   they have new data.

`_refreshForecasts` checks `this.shadowRoot` before scheduling a redraw —
data callbacks can fire before Lit's first render builds the shadow DOM.
In that window we just store the data; `firstUpdated` triggers the first
draw.

`updated(changedProperties)` handles config changes:

- `_invalidateStaleSources(oldConfig)` walks two declarative key tables
  (`STATION_KEYS`, `FORECAST_KEYS`) and tears down whichever source's
  driving config changed. The next `set hass` tick rebuilds it.
- Pure render-only changes (colours, labels, `forecast_days`) just trigger
  a `_refreshForecasts` redraw.

Adding a new config field that drives a data source = add it to the
relevant `*_KEYS` array. Do not add a new branch.

## Chart.js plugin contract

The chart uses three custom plugins (defined inside `_drawChartUnsafe` for
now — they close over the data + counts of the current draw). Every plugin
follows the same rules:

1. **Read pixel positions from the chart, never compute them.** Use
   `chart.scales.x.getPixelForTick(i)` for tick centres, `meta.data[i].x`
   for bar/point centres. Both follow whatever scale type and any
   downstream plugin's mutations — e.g. if a future plugin shifts a bar's
   `.x`, label/separator plugins will follow automatically.
2. **Save / restore the canvas context.** Always wrap drawing in
   `c.save()` / `c.restore()`.
3. **Bail out cleanly when the layout isn't ready.** Plugins can fire
   before `chart.scales.x.ticks` exists; check, and `return` if so.
4. **Never throw.** A throw kills the whole `drawChart` and the chart
   disappears. The outer `try/catch` will catch it and surface a
   `_chartError` banner, but you'll have lost the chart for the user.

The phase tag (`this._chartPhase`) is set at three points in
`_drawChartUnsafe` (`'compute'`, `'init'`, then cleared on success). When
something throws, the catch block reads it to label the error banner —
useful when the error message is generic and you need to know whether the
crash was during data shaping vs. Chart.js init vs. plugin draw.

## Why we have two label-rendering systems

`chartjs-plugin-datalabels` renders the temperature labels on the line
points (configurable via `forecast.style: 'style1' | 'style2'`). The
precipitation labels are rendered by a custom `precipLabelPlugin` because
the plugin can't render a single label with two different font sizes
(number at base, "mm" at half size). This is documented inline in
`_drawChartUnsafe` — see the comment block above `precipLabelPlugin`.

## Build pipeline

```
npm run lint    →  eslint src        (style)
npm run test    →  vitest run        (236 tests across 7 modules)
npm run rollup  →  rollup -c         (single dist/weather-station-card.js)
npm run build   =  lint + test + rollup
```

CI (`.github/workflows/build.yml`) runs all three on every push, plus:

- Verifies `dist/weather-station-card.js` is in sync with source (so a
  contributor who forgets `npm run rollup` fails CI immediately).
- On tag pushes, verifies `package.json` version matches the tag, then
  uploads the bundle as a release asset via `softprops/action-gh-release`.

`permissions: contents: write` is set at job level so the release action
can attach the bundle (commit `4530a60` fixed the missing permission).

## Distribution

HACS pulls the latest GitHub release. Users get one file
(`weather-station-card.js`) and Home Assistant serves it precompressed
(`.js.gz`) when the browser supports gzip. After every local deploy to a
test HA instance, regenerate the `.gz` or HA will keep serving the stale
compressed version.

Cache-busting in HA goes through the resource URL's `?hacstag=` query.
After bumping versions in HA's resources panel, every browser is forced
to re-fetch.

## Testing scope

What's tested (Vitest, `tests/*.test.js`, 236 tests as of v1.0):

- `condition-classifier.js` — every decision-tree branch, threshold
  edges, override merging, per-period (daily / hourly) thresholds.
- `data-source.js` — `bucketPrecipitation` for all three state-class
  paths (daily + hourly buckets), `_buildForecast` and
  `_buildHourlyForecast` chronology / shape / live-fallback,
  `ForecastDataSource` subscribe / error / dispose for both modes.
- `format-utils.js` — colour parsers (rgba/hex/hsl), separator-position
  algebra (incl. hourly mode), `computeInitialScrollLeft` positioning.
- `forecast-utils.js` — `pickHourlyTickIndices`, `hourlyTempSeries`,
  `normalizeForecastMode`.
- `sunshine-source.js`, `openmeteo-source.js` — sunshine derivation
  paths (v0.9).
- `chart/plugins.js` — plugin factories: `createSeparatorPlugin` (daily
  + hourly), `createDailyTickLabelsPlugin` (hourly early-return,
  doubled-today seam), `createSunshineLabelPlugin`.

CI gates branch + line coverage at **80 %** (vitest v8 provider).

What's intentionally **not** unit-tested (planned for v1.3 via
Playwright E2E + visual regression — issue #14):

- `main.js` Lit lifecycle — that's framework contract (LitElement spec).
  Tests would mostly assert "Lit calls our methods" — the framework has
  its own test suite for that.
- Chart.js render output — it's a canvas, asserting pixels is brittle in
  unit tests. v1.3 closes this via Playwright visual regression.
- Editor DOM — `ha-form` is an HA-supplied component. We test the schema
  shape via lint + visual review, not rendered DOM. v1.3 will add E2E
  click-path coverage.
- Pointer / touch gesture sequences (drag-vs-tap, pointercancel) —
  unit tests can mock pointer events, but the macrotask vs. microtask
  ordering only manifests in a real browser. Covered by v1.3.

If you're adding logic that crosses these boundaries (e.g. "does setting
config X cause data source Y to re-subscribe?"), prefer extracting the
decision into a pure helper in `data-source.js` or `format-utils.js` and
testing it there.

## Future-friendly directions

The current design supports several near-term extensions without rework:

- **New data source type** (e.g. `HourlyForecastDataSource`) — implement
  `subscribe(cb) → unsubscribe` emitting the forecast shape; merge logic
  in `_refreshForecasts` already concatenates arbitrary segments.
- **New metric on the chart** — add the field to `_buildForecast`, then a
  new dataset in `_drawChartUnsafe`. The plugins read from `meta.data[i]`
  generically and don't need to know.
- **Schema validation** — wrap `_refreshForecasts`'s input with a
  validator (`zod` or hand-rolled); drop bad entries before they reach
  Chart.js. Currently we trust the data sources.

Things that would require structural work:

- **Per-bar widths or non-uniform column spacing.** Tried during v0.5
  development and reverted — see git history of `feat/v06-debts`. Chart.js
  category scale doesn't support per-bar widths; linear-scale workarounds
  redistribute *all* spacing, which contradicted user intent. If revived,
  it needs a clear UX contract first.
- **Sub-hour granularity.** Daily and hourly are both supported as of
  v0.8 (`forecast.type: 'daily' | 'hourly'`), with viewport scrolling
  via `forecast.number_of_forecasts` for the dense hourly case. Going
  finer (15-min, 5-min) would need a new bucket-size primitive in
  `bucketPrecipitation` and likely a different chart layout — Chart.js
  category-scale runs out of horizontal pixels around ~200 columns
  even with scrolling.
