# Conditions

How the card derives the weather condition (sun / cloudy / rain / fog / windy / …) from your sensor values, both for the daily chart columns and the live "now" panel.

→ Back to [README](../README.md)

## Current ("now") condition

When `show_main: true`, the main panel's icon and condition text reflect a
**live** classification of the current sensor states (re-evaluated whenever
any sensor updates). The same classifier is used as for the daily forecast
columns, fed with instantaneous values and an instantaneous clear-sky
reference (zenith from latitude + longitude + current UTC time).

Day/night-aware icons are still automatic: when `sun.sun` is below the
horizon, `sunny` and `partlycloudy` swap to their night variants
(`clear-night`, `partlycloudy-night`).

### Precipitation in the live condition needs a *rate* unit

Turning a cumulative precipitation counter into an instantaneous rainfall
rate requires extra history that the live path does not keep. Therefore
**precipitation only contributes to the live "now" condition when the
sensor's `unit_of_measurement` ends in `/h`, `/hr`, or `/hour`**:

| Sensor `unit_of_measurement`                      | Used for live rain? |
| ------------------------------------------------- | ------------------- |
| `mm/h`, `mm/hr`, `mm/hour`, `in/h`                | ✅ yes               |
| `mm`, `in` (cumulative counter or daily total)    | ❌ falls through to cloud / wind / fog |
| _missing_                                         | ❌ falls through |

The **daily chart** has no such restriction — it derives daily totals via
the recorder's statistics regardless of unit (see [SENSORS.md → Setting up a precipitation sensor](SENSORS.md#setting-up-a-precipitation-sensor)),
and the worst-of-day classification uses those totals directly.

If you only have a cumulative counter, the live "now" icon will not show
rain even while it is raining; the daily chart still reports the day's
total correctly. To get a true live rain icon, expose a `mm/h` rate sensor
(many integrations provide one alongside the counter — e.g. Pirateweather's
`*_precipitation_rate`, Ecowitt's `*_rain_rate`, ESPHome
`pulse_meter`-derived rate templates).

## How conditions are determined

Every day's icon — and the live "now" icon — is derived from the relevant
sensor values by a deterministic classifier (`src/condition-classifier.js`).
It evaluates rules in priority order (worst-of-day): once a rule matches,
no later rules are checked. Conditions `lightning`, `lightning-rainy`, and
`hail` are **never emitted** — reliable detection requires dedicated
hardware (AS3935 lightning detector, hail-pad / impact sensor) that a
typical weather station does not provide.

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

`cloud_ratio` is `lux_max / clearsky_lux`, where `clearsky_lux ≈ 110 000 lx
× cos(zenith)` (IES Lighting Handbook §3 for the sea-level clear-sky
maximum; Cooper 1969 declination + standard solar-noon / hour-angle
geometry). Latitude / longitude come from `hass.config.*` automatically.

## Customising thresholds

Every threshold above can be overridden via `condition_mapping.*` keys in your card config. See [CONFIGURATION.md → `condition_mapping`](CONFIGURATION.md#condition_mapping--override-classifier-thresholds) for the full key list and examples.
