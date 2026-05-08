<p align="center">
  <img src="https://raw.githubusercontent.com/chriguschneider/weather-station-card/master/images/logo.svg" alt="Weather Station Card logo" width="160" />
</p>

<h1 align="center">Weather Station Card</h1>

<p align="center"><em>Weather station meets forecast.</em></p>

<p align="center">
  <a href="LICENSE.md"><img alt="License: MIT" src="https://img.shields.io/badge/License-MIT-yellow.svg" /></a>
  <a href="https://hacs.xyz/"><img alt="HACS Custom" src="https://img.shields.io/badge/HACS-Custom-orange.svg" /></a>
  <a href="https://github.com/chriguschneider/weather-station-card/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/chriguschneider/weather-station-card?label=release" /></a>
  <a href="https://github.com/chriguschneider/weather-station-card/actions/workflows/build.yml"><img alt="Build status" src="https://img.shields.io/github/actions/workflow/status/chriguschneider/weather-station-card/build.yml?label=build" /></a>
  <a href="https://sonarcloud.io/summary/new_code?id=chriguschneider_weather-station-card"><img alt="Quality Gate Status" src="https://sonarcloud.io/api/project_badges/measure?project=chriguschneider_weather-station-card&metric=alert_status" /></a>
  <a href="https://github.com/chriguschneider/weather-station-card/releases"><img alt="Total downloads" src="https://img.shields.io/github/downloads/chriguschneider/weather-station-card/total" /></a>
  <a href="https://github.com/chriguschneider/weather-station-card/stargazers"><img alt="Stars" src="https://img.shields.io/github/stars/chriguschneider/weather-station-card?style=flat" /></a>
  <a href="https://github.com/chriguschneider/weather-station-card/commits/master"><img alt="Last commit" src="https://img.shields.io/github/last-commit/chriguschneider/weather-station-card" /></a>
  <a href="https://buymeacoffee.com/chriguschneider"><img alt="Buy Me a Coffee" src="https://img.shields.io/badge/Buy%20Me%20a%20Coffee-support-FFDD00.svg" /></a>
  <a href="#ai-assisted-development"><img alt="AI Assisted" src="https://img.shields.io/badge/AI-assisted-2196F3.svg" /></a>
</p>

<p align="center">
  <a href="https://my.home-assistant.io/redirect/hacs_repository/?owner=chriguschneider&category=dashboard&repository=weather-station-card"><img src="https://my.home-assistant.io/badges/hacs_repository.svg" alt="Open in HACS" /></a>
  &nbsp;·&nbsp;
  <a href="https://github.com/chriguschneider/weather-station-card/issues">Issues</a>
  &nbsp;·&nbsp;
  <a href="https://github.com/chriguschneider/weather-station-card/discussions">Discussions</a>
  &nbsp;·&nbsp;
  <a href="ARCHITECTURE.md">Architecture</a>
  &nbsp;·&nbsp;
  <a href="CONTRIBUTING.md">Contributing</a>
  &nbsp;·&nbsp;
  <a href="CHANGELOG.md">Changelog</a>
</p>

A Lovelace card that charts your own weather station's history alongside any
forecast — driven by sensor data, not a `weather.*` entity.

<details>
<summary><b>Table of contents</b></summary>

- [What this card does](#what-this-card-does)
- [Three modes](#three-modes)
- [When to use this card vs. upstream `weather-chart-card`](#when-to-use-this-card-vs-upstream-weather-chart-card)
- [Installation](#installation)
- [Example config](#example-config)
- [Configuration](#configuration) → [docs/CONFIGURATION.md](docs/CONFIGURATION.md)
- [Conditions, sensors, sunshine](#conditions-sensors-and-sunshine) → [docs/CONDITIONS.md](docs/CONDITIONS.md), [docs/SENSORS.md](docs/SENSORS.md)
- [Troubleshooting](#troubleshooting) → [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)
- [Contributing & architecture](#contributing--architecture)
- [AI-assisted development](#ai-assisted-development)
- [Community](#community)
- [Attribution & licence](#attribution--licence)

</details>

<table>
<tr>
<th>Main panel + chart</th>
<th>Standalone chart</th>
<th>Visual editor</th>
</tr>
<tr>
<td><img alt="Daily combination with sunshine" src="https://raw.githubusercontent.com/chriguschneider/weather-station-card/master/tests-e2e/snapshots/render-modes.spec.ts/daily-combination-sunshine.png"></td>
<td><img alt="Daily station-only chart with sunshine" src="https://raw.githubusercontent.com/chriguschneider/weather-station-card/master/tests-e2e/snapshots/render-modes.spec.ts/daily-station-sunshine.png"></td>
<td><img alt="Visual editor" src="https://raw.githubusercontent.com/chriguschneider/weather-station-card/master/tests-e2e/snapshots/editor-visual.spec.ts/editor.png"></td>
</tr>
</table>

> Hero screenshots auto-update from the e2e visual-baseline run — every release-CI baseline regen ships a fresh README.

## What this card does

Most Lovelace weather cards visualise a forecast served by a `weather.*`
entity. If you actually run a weather station on-site (Shelly Plus H&T,
BTHome, ESPHome, Pirateweather receiver, …), the more interesting view is
*what happened over the past N days* — and the most useful "now" panel
reflects the live readings of those same sensors. This card does both:

- A **past chart** with high / low temperature curves and daily
  precipitation bars, plus an icon row of the worst-of-day weather
  condition for each column. Today's column is highlighted. The number
  of days is configurable (`days:`, 1–14).
- An optional **forecast block** driven by a `weather.*` entity, drawn
  in the same per-day layout next to the past chart. Forecast
  temperature lines are dashed and forecast precipitation bars render
  semi-transparent so predicted values read distinctly from measured
  ones. Span is configurable separately (`forecast_days:`).
- A **live main panel** showing the current temperature, condition icon,
  and (optionally) clock and weather attributes — all derived from current
  sensor states, not from a forecast.

Conditions are derived by a deterministic, meteorologically-grounded
classifier (see [docs/CONDITIONS.md](docs/CONDITIONS.md#how-conditions-are-determined)
— every threshold is tied to a WMO / NWS / AMS / IES source).

## When to use this card vs. upstream `weather-chart-card`

This card is a fork of [`mlamberts78/weather-chart-card`](https://github.com/mlamberts78/weather-chart-card)
(now archived). The two answer different needs:

| You have… | …use |
| --- | --- |
| Only a `weather.*` entity (Met.no / Open-Meteo / Pirateweather), no on-site sensors | Upstream `weather-chart-card` |
| A real weather station — Shelly Plus H&T, BTHome, ESPHome, Pirateweather receiver, Ecowitt, … — and you want **past sensor history** plus optional forecast | **This card** |
| Both: forecast and sensors, side-by-side in one chart with measured-vs-predicted contrast | **This card** (combination mode) |

## Three modes

The same card renders three distinct layouts depending on which blocks
are enabled. Each mode pairs with two `forecast.style` variants ("with
boxes" / "without boxes"), giving the six layouts shown below — top row
is the default style (`style2`, without boxes), bottom row is
`style1` (with boxes).

<table>
<tr>
<th>Combination</th>
<th>Station</th>
<th>Forecast</th>
</tr>
<tr>
<td><sub>style 2 (default, no boxes)</sub></td>
<td><sub>style 2 (default, no boxes)</sub></td>
<td><sub>style 2 (default, no boxes)</sub></td>
</tr>
<tr>
<td><img alt="Combination, style 2" src="https://raw.githubusercontent.com/chriguschneider/weather-station-card/master/tests-e2e/snapshots/styles-grid.spec.ts/combination-style2.png" /></td>
<td><img alt="Station, style 2" src="https://raw.githubusercontent.com/chriguschneider/weather-station-card/master/tests-e2e/snapshots/styles-grid.spec.ts/station-style2.png" /></td>
<td><img alt="Forecast, style 2" src="https://raw.githubusercontent.com/chriguschneider/weather-station-card/master/tests-e2e/snapshots/styles-grid.spec.ts/forecast-style2.png" /></td>
</tr>
<tr>
<td><sub>style 1 (with boxes)</sub></td>
<td><sub>style 1 (with boxes)</sub></td>
<td><sub>style 1 (with boxes)</sub></td>
</tr>
<tr>
<td><img alt="Combination, style 1" src="https://raw.githubusercontent.com/chriguschneider/weather-station-card/master/tests-e2e/snapshots/styles-grid.spec.ts/combination-style1.png" /></td>
<td><img alt="Station, style 1" src="https://raw.githubusercontent.com/chriguschneider/weather-station-card/master/tests-e2e/snapshots/styles-grid.spec.ts/station-style1.png" /></td>
<td><img alt="Forecast, style 1" src="https://raw.githubusercontent.com/chriguschneider/weather-station-card/master/tests-e2e/snapshots/styles-grid.spec.ts/forecast-style1.png" /></td>
</tr>
</table>

> **Combination** (left column): past N days from your sensors + today
> as a doubled column (measured + predicted) + forecast N days from a
> `weather.*` entity. Forecast temperature lines are dashed and
> forecast precipitation bars draw at ~45 % opacity so predicted values
> read distinctly from measured ones.
>
> **Station** (centre): the original layout — past 7 days from your
> sensors, today as the rightmost column. No `weather.*` entity needed.
>
> **Forecast** (right): forecast-only — no station-history block. Useful
> when the card is paired with another sensor-history visualisation
> elsewhere on the dashboard.

```yaml
type: custom:weather-station-card
days: 7
sensors:
  temperature: sensor.YOUR_TEMPERATURE_SENSOR
  # … (rest as in the example config below)
weather_entity: weather.home   # any weather.* entity that supports daily forecast
forecast_days: 7
show_forecast: true            # turn the forecast block on
show_station: true             # default; flip to false for forecast-only
```

Both blocks toggle independently — leave `show_forecast: false` (the
default) for the original station-only experience, or set
`show_station: false` to hide the historical block.

For hourly resolution (`forecast.type: hourly`), see
[CONFIGURATION.md → Daily vs. hourly resolution](docs/CONFIGURATION.md#daily-vs-hourly-resolution).

## Installation

> **Compatible with any** `weather.*` **integration that exposes a daily forecast** —
> Met.no, Open-Meteo, Pirateweather, AccuWeather, Buienradar, OpenWeatherMap (when configured for daily).
> The forecast block subscribes via Home Assistant's standard `weather.subscribe_forecast` API,
> so anything HA recognises as a weather entity should work.

### HACS (Custom Repository)

**One-click**: [![Open your Home Assistant instance and open a repository inside the Home Assistant Community Store.](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=chriguschneider&category=dashboard&repository=weather-station-card)

Or manually:

1. In HACS, go to **Frontend → ⋮ → Custom repositories**.
2. Add `https://github.com/chriguschneider/weather-station-card` with
   category **Dashboard**.
3. Click **Install** on the *Weather Station Card* entry that appears in the
   Frontend list.
4. Hard-refresh your browser (Ctrl-F5 or equivalent) so the new resource
   loads.
5. Add the card to your dashboard via the Lovelace UI ("Add Card → Custom:
   Weather Station Card") or paste the YAML below.

### Manual

1. Download `weather-station-card.js` from the [latest release](https://github.com/chriguschneider/weather-station-card/releases/latest).
2. Copy it to `<config>/www/community/weather-station-card/`.
3. In Home Assistant, go to **Settings → Dashboards → Resources** and add
   `/local/community/weather-station-card/weather-station-card.js` as a
   JavaScript module.
4. Hard-refresh and add the card.

## Example config

### Minimal — just a temperature curve

```yaml
type: custom:weather-station-card
sensors:
  temperature: sensor.YOUR_TEMPERATURE_SENSOR
```

### Typical — all common sensors

```yaml
type: custom:weather-station-card
title: Weather Station
days: 7
show_main: true
sensors:
  temperature: sensor.YOUR_TEMPERATURE_SENSOR
  humidity: sensor.YOUR_HUMIDITY_SENSOR
  illuminance: sensor.YOUR_ILLUMINANCE_SENSOR
  precipitation: sensor.YOUR_PRECIPITATION_SENSOR
  pressure: sensor.YOUR_PRESSURE_SENSOR
  wind_speed: sensor.YOUR_WIND_SPEED_SENSOR
  gust_speed: sensor.YOUR_GUST_SPEED_SENSOR
  wind_direction: sensor.YOUR_WIND_DIRECTION_SENSOR
  uv_index: sensor.YOUR_UV_INDEX_SENSOR
  dew_point: sensor.YOUR_DEW_POINT_SENSOR
units:
  speed: km/h
```

Only `sensors.temperature` is strictly required; the rest are optional but
each one unlocks more chart series, attribute readouts, and live-condition
classifier inputs.

## Configuration

The visual editor groups options into six sections — Setup, Sensors,
Layout, Style & Colours, Units, Advanced. Each key is documented in
**[docs/CONFIGURATION.md](docs/CONFIGURATION.md)** with type, default,
and effect.

For the most common adjustments:

- **Switch modes** — set `show_station` and/or `show_forecast`. See [Setup](docs/CONFIGURATION.md#a-setup).
- **Add a forecast** — set `weather_entity` plus `show_forecast: true`. See [Setup](docs/CONFIGURATION.md#a-setup).
- **Adjust colours** — see [Style & Colours](docs/CONFIGURATION.md#d-style--colours).
- **Tune the condition classifier** — see [`condition_mapping`](docs/CONFIGURATION.md#condition_mapping--override-classifier-thresholds).


## Conditions, sensors, and sunshine

The card derives weather conditions (sunny / cloudy / rainy / fog / windy / …)
deterministically from your sensors, with thresholds tied to WMO / NWS / AMS / IES
sources. Conditions `lightning`, `lightning-rainy`, and `hail` are never emitted
because reliable detection requires dedicated hardware.

For the full classifier rules, the live "now"-condition mechanic, sensor setup
(precipitation rates vs. cumulative counters, sunshine duration via Open-Meteo),
and customisation:

- **[docs/CONDITIONS.md](docs/CONDITIONS.md)** — decision tree, live-vs-daily classifier, day/night-aware icons.
- **[docs/SENSORS.md](docs/SENSORS.md)** — precipitation sensor wiring, sunshine duration setup, privacy notes.

## Troubleshooting

Three things that catch most people:

- **No chart yet** — a brand-new sensor needs ~1 hour of recorder history before its first daily statistic is available. Wait, then refresh.
- **Old bundle stuck after update** — bump the HACS `?hacstag=` query in *Settings → Dashboards → Resources*, or "Reload frontend" from your user menu.
- **Today's column appears doubled** — that's intentional in combination mode (measured + predicted side-by-side). Set `show_forecast: false` for the original single-today layout.

For the full error-banner reference, classifier-tuning recipes,
editor quirks, and known upstream limitations, see
**[docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)**.

## Contributing & architecture

PRs welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) for the build flow.
For a tour of how the card is wired internally (data sources, the merge
model, the chart-plugin contract), read [ARCHITECTURE.md](ARCHITECTURE.md).
For doc-writing conventions (length targets, voice, cross-linking), see
[docs/STYLE-GUIDE.md](docs/STYLE-GUIDE.md).

**Translations** are a well-bounded first contribution. Strings live in
`src/locale.js`; English and German ship with a complete editor block,
other languages fall through to English at runtime. Add yours via a PR —
see CONTRIBUTING.md.

## AI-assisted development

This card is built by Chrigu & Claude — a human and an LLM working
together. Architecture decisions, design trade-offs, the
meteorological grounding of the condition classifier, and the
"what should this actually do?" calls are mine. A large share of
the typing, refactors, test scaffolding, and tedious chart-plugin
plumbing was done by [Claude Code](https://claude.com/claude-code).

Every line is reviewed, tested (`npm run build` runs lint + 80%+
coverage tests + visual regression on every push), and shipped
consciously. The badge is here because transparency about how
software is made matters more than pretending otherwise.

If the card has earned a spot on your dashboard, [buying me a coffee](https://buymeacoffee.com/chriguschneider)
is the nicest way to say thanks ❤️ *(Claude doesn't drink coffee.
More for me.)*

## Community

- 💬 **Have a question or idea?** Open a [Discussion](https://github.com/chriguschneider/weather-station-card/discussions) — better than an issue if you're not sure whether something's a bug or just an unfamiliar config knob.
- 🐛 **Found a bug or want a specific feature?** [Open an issue](https://github.com/chriguschneider/weather-station-card/issues/new/choose).
- 🔧 **Want to contribute?** See [CONTRIBUTING.md](CONTRIBUTING.md) — adding a translation or a small fix is a well-bounded first PR.

### Contributors

<a href="https://github.com/chriguschneider/weather-station-card/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=chriguschneider/weather-station-card" alt="Contributors" />
</a>

## Attribution & licence

This project is a fork of [`mlamberts78/weather-chart-card`](https://github.com/mlamberts78/weather-chart-card)
v1.0.1 (October 2024). The chart UI, icons, and renderer come from the
upstream — what's new here is the sensor-history data layer
(`src/data-source.js`), the meteorological condition classifier
(`src/condition-classifier.js`), the live-condition wiring, and the editor
adjustments for sensor selection.

Released under the MIT licence — same as upstream. See [LICENSE.md](LICENSE.md).
