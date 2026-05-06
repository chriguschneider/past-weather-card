# Testing

Two test layers run on every commit:

| Layer | Tool | Scope |
|---|---|---|
| **Unit** (`tests/`) | Vitest | Pure modules — classifier, data sources, chart plugins, format/forecast utils, sunshine helpers. 12 spec files, ~360 tests. |
| **E2E + visual regression** (`tests-e2e/`) | Playwright | The bundled card boots in a static-served harness with a fake-hass mock. Covers render modes (visual baselines), pointer interactions, mode toggle, jump-to-now, editor mutators. 17 specs, 7 screenshot baselines. |

Both layers run in CI before bundle verification. A failure in either
blocks the release pipeline.

## Run

```bash
# Unit
npm test                    # one-shot, used by CI
npm run test:watch          # live-reload while writing tests
npm run coverage            # vitest run --coverage with v8 provider

# E2E
npm run test:e2e            # full suite, headless
npm run test:e2e:update     # regenerate visual baselines after a
                            # deliberate UI change
```

`npm run build` chains: typecheck → unit → rollup. The E2E suite is
**not** chained into `build` (it needs the bundle to already be on
disk and Playwright's Chromium). CI runs them sequentially —
typecheck → unit → coverage → bundle → e2e.

## Coverage gate

CI fails the build if any of statements / branches / functions /
lines drops below **80 %** for the modules listed in
`vitest.config.js`. Editor + main.ts are out of unit-coverage scope
(rendering paths are exercised by Playwright instead).

## Unit-test layout

```
tests/
  condition-classifier.test.ts
  data-source.test.ts
  format-utils.test.ts
  forecast-utils.test.ts
  sunshine-source.test.ts
  openmeteo-source.test.ts
  plugins.test.ts
  ...
```

No fixtures directory yet — small test data is inlined. Promote to
`tests/fixtures/*.ts` if a payload grows past ~50 lines.

## E2E layout

```
tests-e2e/
  pages/
    card.html           harness page, served at http://localhost:5173
    hass-mock.js        browser-side fake-hass implementation
  fixtures/
    generate.ts         deterministic fixture generators (recorder
                        stats, forecasts, hass states)
  snapshots/
    render-modes.spec.ts/
      daily-station.png
      daily-forecast.png
      ...
  hass-mock.types.ts    type definitions for the mock contract
  _helpers.ts           openHarness, mount, settle, unmountAll
  render-modes.spec.ts          visual baselines for 6 render modes + sunshine
  scroll-and-actions.spec.ts    drag, indicator chevrons, tap suppression
  mode-toggle-jump-to-now.spec.ts  daily↔hourly toggle, jump-to-now
  editor.spec.ts                editor mutator contracts
  tsconfig.json         extends ../tsconfig.json with rootDir = ..
```

The harness page (`pages/card.html`) loads the bundled card from
`/dist/weather-station-card.js` and a small mock from
`pages/hass-mock.js`. Specs call `mount(page, config, fixture)` to
insert a card with a fixture-backed hass; `settle(page)` waits for
the chart canvas to commit; `unmountAll(page)` resets between tests.

### Fake-hass contract

`hass-mock.js` answers exactly the WebSocket message types and
service-call shapes the card touches:

- `callWS({ type: 'recorder/statistics_during_period' })` → returns
  `recorderDaily` or `recorderHourly` from the fixture by `period`.
- `connection.subscribeMessage({ type: 'weather/subscribe_forecast' })`
  → emits the matching `forecastDaily` / `forecastHourly` array
  synchronously, returns a no-op unsubscribe.
- `callService(domain, service, data, target)` → logged on
  `hass.__serviceCalls` so a spec can assert what was fired.

Unrecognised message types `throw` so a typo in a future spec or
in card code surfaces as a hard failure rather than a silent miss.

## Visual baselines

Per spec, baselines live under
`tests-e2e/snapshots/<spec>.spec.ts/<name>.png`. Tolerance is
configured in `playwright.config.ts`:

- `maxDiffPixelRatio: 0.002` — 0.2 % of the viewport (~1 800 px out
  of ~921 600 at 1280×720) absorbs sub-pixel anti-aliasing drift on
  chart line strokes between headed/headless without masking real
  regressions like a missing dataset or a colour change.
- `threshold: 0.2` — Playwright's per-pixel default colour distance.

Animations are disabled per-test by setting
`forecast.disable_animation: true` in the fixture base config so the
500 ms easeOutQuart on the temperature line doesn't make the
screenshot timing race-prone.

### Updating baselines after a deliberate UI change

```bash
npm run test:e2e:update
git add tests-e2e/snapshots
git commit -m "Refresh E2E baselines after <change>"
```

Always include the *why* in the commit — a baseline change is a
visual contract change, and reviewers can't tell from the .png alone
whether the diff is intended.

## What to add when

- New classifier rule or threshold → extend
  `condition-classifier.test.ts` with both a positive and a "just
  below the threshold" negative case.
- New sensor-driven field in `_buildForecast` → assert it surfaces
  in `entry` in the canonical-shape test.
- New render mode (e.g. compact, panel) → add a
  `render-modes.spec.ts` row + a fresh baseline.
- New pointer interaction (e.g. double-tap zooms) → cover the
  on-drag suppression path in `scroll-and-actions.spec.ts`.
- New editor mutator → assert that calling it dispatches a
  `config-changed` event with the expected delta in `editor.spec.ts`.

## What is intentionally not tested

- **Chart.js internal layout.** The visual baselines cover the
  outcome; mocking Chart.js's internal APIs adds setup without
  payoff.
- **Real Home Assistant frontend.** Specs run against the mock; HA
  integration is verified manually on a Pi smoke test (CLAUDE.md has
  the procedure).
- **Cross-browser visual regression.** One project (Chromium) is
  sufficient: HA frontend itself targets Chromium-class browsers,
  and baselines pinned to a single rendering engine sidestep
  font-hinting drift across engines.

## Debugging a failing E2E spec

- `npx playwright test --headed --workers=1 -g "<spec name>"` —
  run a single spec headed so you can watch the harness live.
- `npx playwright show-trace test-results/<spec-folder>/trace.zip` —
  step through a recorded run after the fact.
- `playwright-report/index.html` — opens the HTML reporter with
  per-spec screenshot diffs (in CI, this is uploaded as the
  `playwright-report` artifact when the suite fails).
