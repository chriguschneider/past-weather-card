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

## How daily conditions are determined

Every day's icon is derived from that day's sensor statistics by a deterministic
classifier (`src/condition-classifier.js`). It evaluates rules in priority order
(worst-of-day): once a rule matches, no later rules are checked. Conditions
`lightning`, `lightning-rainy`, and `hail` are never emitted — reliable
detection requires dedicated hardware (AS3935 lightning detector, hail-pad)
that a typical weather station does not provide.

### Decision tree

| Order | Condition       | Trigger                                                                                              | Source                                                |
|-------|-----------------|------------------------------------------------------------------------------------------------------|-------------------------------------------------------|
| 1     | `exceptional`   | gust ≥ 24.5 m/s OR daily precipitation ≥ 50 mm                                                       | Beaufort 10 (WMO No. 306); NWS Excessive Rainfall Outlook |
| 2a    | `snowy`         | precipitation ≥ 0.5 mm AND temp_max ≤ 0 °C                                                           | AMS Glossary "Wet-bulb temperature"; WMO No. 8 Annex 4D |
| 2b    | `snowy-rainy`   | precipitation ≥ 0.5 mm AND temp_max ≤ 3 °C                                                           | AMS Glossary "Sleet"; NWS precip-type partition       |
| 2c    | `pouring`       | precipitation ≥ 10 mm                                                                                | NWS heavy-rain rate (> 7.6 mm/h); Met Office daily    |
| 2d    | `rainy`         | precipitation ≥ 0.5 mm                                                                               | WMO trace-amount cutoff                               |
| 3     | `fog`           | humidity ≥ 95 % AND (temp_min − dew_point_mean) ≤ 1 °C AND wind_mean < 3 m/s                         | METAR FG; AMS Glossary "Fog"                          |
| 4     | `windy-variant` | (gust ≥ 10.8 m/s OR wind_mean ≥ 8.0 m/s) AND cloud_ratio < 0.70                                      | Beaufort 6 / Bft 5 (WMO No. 306)                      |
| 4     | `windy`         | (gust ≥ 10.8 m/s OR wind_mean ≥ 8.0 m/s) AND cloud_ratio ≥ 0.70                                      | Beaufort 6 / Bft 5 (WMO No. 306)                      |
| 5     | `sunny`         | cloud_ratio ≥ 0.70                                                                                   | WMO oktas 0–2/8                                       |
| 5     | `partlycloudy`  | 0.30 ≤ cloud_ratio < 0.70                                                                            | WMO oktas 3–6/8                                       |
| 5     | `cloudy`        | cloud_ratio < 0.30 (or illuminance sensor missing)                                                   | WMO oktas 7–8/8                                       |

`cloud_ratio` is `lux_max / clearsky_noon_lux`, where `clearsky_noon_lux ≈
110 000 lx × cos(|lat − solar_declination|)` (IES Lighting Handbook §3 for the
sea-level clear-sky maximum; Cooper 1969 for declination). Latitude comes from
`hass.config.latitude` automatically.

### Overrides

Each threshold can be overridden in YAML via `condition_mapping`. Defaults
match the table above; only set what you want to change.

```yaml
type: custom:weather-station-card
sensors: { … }
condition_mapping:
  rainy_threshold_mm: 0.5
  pouring_threshold_mm: 10
  exceptional_gust_ms: 24.5
  exceptional_precip_mm: 50
  snow_max_c: 0
  snow_rain_max_c: 3
  fog_humidity_pct: 95
  fog_dewpoint_spread_c: 1
  fog_wind_max_ms: 3
  windy_threshold_ms: 10.8
  windy_mean_threshold_ms: 8.0
  sunny_cloud_ratio: 0.70
  partly_cloud_ratio: 0.30
```

## Translations

The visual editor reads its strings from `src/locale.js`. Each language has an `editor: { … }` block keyed by the same names used in `SENSORS_SCHEMA` (`temperature`, `humidity`, `illuminance`, `precipitation`, `pressure`, `wind_speed`, `gust_speed`, `wind_direction`, `uv_index`, `dew_point`) plus three layout strings (`title`, `days`, `sensors_heading`).

Languages without an `editor` block — or with individual missing keys — fall back to English at runtime via the `tEditor()` helper in `weather-station-card-editor.js`. To add a new language: locate that language's section in `src/locale.js`, copy the `editor: { … }` block from the canonical English entry, and translate the values. PRs welcome.
