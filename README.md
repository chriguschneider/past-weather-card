# Past Weather Card

A Lovelace card for Home Assistant that displays **past weather station measurements** in the same per-day layout as the [`weather-chart-card`](https://github.com/mlamberts78/weather-chart-card) — but driven by sensor history (`recorder/statistics_during_period`) instead of a `weather.*` entity's forecast.

## Status

Work in progress. Phase 1 (fork & rename) complete; data layer and editor adaptation are next.

Tracking issue: [chriguschneider/homeassistant#12](https://github.com/chriguschneider/homeassistant/issues/12)

## Why a fork?

The upstream `weather-chart-card` is a polished, mature card whose layout is exactly what we want — but it can only be fed by a `weather.*` entity, which means **forecast** data. For a real on-site weather station, the interesting view is *what actually happened over the last N days*. This fork keeps the layout pixel-identical and replaces the data source.

## Attribution

Forked from [`mlamberts78/weather-chart-card`](https://github.com/mlamberts78/weather-chart-card) at v1.0.1 (Oct 2024). Original author: Marc Lamberts. Released under MIT — same license preserved here. See [`LICENSE.md`](LICENSE.md).

## Installation

Not yet ready for end users. Documentation, screenshots, and HACS Custom Repository instructions will land once the data layer is in place.
