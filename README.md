# Weather Station Card

A Lovelace card for Home Assistant that displays **past weather-station measurements** in the same per-day layout as the [`weather-chart-card`](https://github.com/mlamberts78/weather-chart-card) — but driven by sensor history (`recorder/statistics_during_period`) instead of a `weather.*` entity's forecast.

## Status

Work in progress. Renamed from `past-weather-card` (older v0.1.x) to `weather-station-card`.

Tracking issue: [chriguschneider/homeassistant#12](https://github.com/chriguschneider/homeassistant/issues/12)

## Why a fork?

The upstream `weather-chart-card` is a polished, mature card whose layout is exactly what we want — but it can only be fed by a `weather.*` entity, which means **forecast** data. For a real on-site weather station, the interesting view is *what actually happened over the last N days*. This fork keeps the layout pixel-identical and replaces the data source.

## Attribution

Forked from [`mlamberts78/weather-chart-card`](https://github.com/mlamberts78/weather-chart-card) at v1.0.1 (Oct 2024). Original author: Marc Lamberts. Released under MIT — same license preserved here. See [`LICENSE.md`](LICENSE.md).

## Installation

Not yet ready for end users. Documentation, screenshots, and HACS Custom Repository instructions will land once the data layer is in place.

## Translations

The visual editor reads its strings from `src/locale.js`. Each language has an `editor: { … }` block keyed by the same names used in `SENSORS_SCHEMA` (`temperature`, `humidity`, `illuminance`, `precipitation`, `pressure`, `wind_speed`, `gust_speed`, `wind_direction`, `uv_index`, `dew_point`) plus three layout strings (`title`, `days`, `sensors_heading`).

Languages without an `editor` block — or with individual missing keys — fall back to English at runtime via the `tEditor()` helper in `weather-station-card-editor.js`. To add a new language: locate that language's section in `src/locale.js`, copy the `editor: { … }` block from the canonical English entry, and translate the values. PRs welcome.
