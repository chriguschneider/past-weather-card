# Configuration reference

This document describes every YAML key supported by the card. Sections mirror the visual editor's six tabs.

→ Back to [README](../README.md)

The visual editor groups options into six sections — [A. Setup](#a-setup),
[B. Sensors](#b-sensors), [C. Layout](#c-layout),
[D. Style & Colours](#d-style--colours), [E. Units](#e-units),
[F. Advanced](#f-advanced). The reference below mirrors that order.

## A. Setup

The mode selector decides which blocks render. The YAML keeps two
separate booleans (`show_station`, `show_forecast`) for backwards
compatibility — the editor projects them onto a single radio.

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `type` | string | — | Always `custom:weather-station-card`. |
| `title` | string | _none_ | Card header. Omit for a header-less card. |
| `show_station` | bool | `true` | Render the past station-history block on the left. (Editor: Mode.) |
| `show_forecast` | bool | `false` | Render the forecast block on the right. (Editor: Mode.) Requires `weather_entity`. |
| `weather_entity` | string | _none_ | `weather.*` entity used for the forecast block. Required when `show_forecast: true`. |
| `days` | integer | `7` | Number of past days (station block). 1–14. |
| `forecast_days` | integer | `days` | Number of forecast columns; defaults to the same span as `days`. |
| `tap_action` | object | `{ action: none }` | Action triggered by a single click on the card. See [Actions](#actions) below. |
| `hold_action` | object | `{ action: none }` | Action triggered by holding the card for ≥ 500 ms. |
| `double_tap_action` | object | `{ action: none }` | Action triggered by a double click within 250 ms. |

### Actions

The card exposes the standard Home Assistant action selector for tap, hold,
and double-tap. The supported `action` values are the ones HA's UI editor
offers — `more-info`, `navigate`, `url`, `toggle`, `perform-action`,
`assist`, and `none` (the default). The action runs on the **whole card**;
clicks anywhere on the chart, the main panel, or the attribute row trigger
the same configured action.

```yaml
tap_action:
  action: navigate
  navigation_path: /lovelace-garden
hold_action:
  action: more-info
  entity: sensor.outdoor_temperature
double_tap_action:
  action: perform-action
  perform_action: light.toggle
  target:
    entity_id: light.terrace
```

For `more-info` and `toggle`, if no `entity` is set the action falls back to
`sensors.temperature`. The cursor only switches to a hand when at least one
action is non-`none`, so the default read-only card looks read-only.

## B. Sensors

All keys are sensor `entity_id`s. Values populate the chart, the live "now"
classifier, and (where relevant) the attribute readouts. Only
`sensors.temperature` is strictly required.

| Key | Used for |
| --- | --- |
| `sensors.temperature` | Temperature curves (high/low), main-panel temperature, classifier |
| `sensors.humidity` | Humidity attribute, fog detection |
| `sensors.illuminance` | Cloud-cover ratio for live + daily conditions |
| `sensors.precipitation` | Precipitation bars, rainy/pouring/snowy classification |
| `sensors.pressure` | Pressure attribute |
| `sensors.wind_speed` | Mean-wind classification, attribute readout |
| `sensors.gust_speed` | Gust-based windy/exceptional classification |
| `sensors.wind_direction` | Wind direction attribute & arrow |
| `sensors.uv_index` | UV attribute |
| `sensors.dew_point` | Fog detection (combined with humidity) |
| `sensors.sunshine_duration` | Today's live sunshine value (scalar, seconds or hours auto-detected at the `≥ 30` threshold). Past columns fall back to the recorder's daily-max for this same sensor. Only used when `forecast.show_sunshine: true`. |

## C. Layout

Three master toggles (`show_main`, `show_attributes`, plus the chart-row
toggles). In the editor each master expands its sub-fields only when
ON; in YAML the sub-keys are evaluated regardless.

**Main panel** (gated by `show_main: true`)

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `show_main` | bool | `false` | Show the live "now" panel (icon + temperature + condition). |
| `show_temperature` | bool | `true` | Show current temperature. |
| `show_current_condition` | bool | `true` | Show condition text under temperature. |
| `show_time` | bool | `false` | Live clock. |
| `show_time_seconds` | bool | `false` | Include seconds in the clock. |
| `use_12hour_format` | bool | `false` | Use 12-hour clock. |
| `show_day` | bool | `false` | Day-of-week label. |
| `show_date` | bool | `false` | Date label. |

**Attributes row** (gated by `show_attributes: true`; each entry also requires the corresponding sensor)

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `show_attributes` | bool | `false` | Show humidity / pressure / dew point / sun / wind row. |
| `show_humidity` | bool | `true` | Humidity attribute. |
| `show_pressure` | bool | `true` | Pressure attribute. |
| `show_dew_point` | bool | `false` | Dew-point attribute. |
| `show_wind_direction` | bool | `true` | Wind-direction arrow. |
| `show_wind_speed` | bool | `true` | Wind-speed value. |
| `show_wind_gust_speed` | bool | `false` | Gust speed (requires `sensors.gust_speed`). |
| `show_sun` | bool | `false` | Sunrise / sunset row. |

**Chart rows**

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `forecast.condition_icons` | bool | `true` | Condition icons row above the chart. |
| `forecast.show_wind_forecast` | bool | `true` | Wind row below the chart. |
| `forecast.show_wind_arrow` | bool | `true` | Show the per-day wind-direction arrow inside the wind row. When the arrow is on and a column is too narrow to fit the arrow + speed side-by-side, the speed wraps onto a second line below the arrow. |
| `forecast.show_date` | bool | `true` | `dd/mm` date row in the X-axis. When off, only the weekday is rendered. |
| `forecast.show_sunshine` | bool | `false` | Sunshine-duration column inside the chart — half-bar in yellow on the right of every column (precipitation keeps the left half), with the day's hours rendered as a small "Xh" label at the top of the column. Off by default; turning it on without configuring at least one of the sunshine sensors below renders empty bars and labels (no warning, no banner). See [SENSORS.md → Sunshine duration](SENSORS.md#sunshine-duration) for setup. |

## D. Style & Colours

**Chart appearance**

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `forecast.style` | `'style2' \| 'style1'` | `'style2'` | Temperature-label rendering. `style2` (default) shows plain text beside the lines; `style1` boxes each value with the line-coloured border. |
| `forecast.round_temp` | bool | `false` | Round temperature labels to integers. |
| `forecast.disable_animation` | bool | `false` | Disable chart redraw animation. |

**Sizing**

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `icons_size` | number (px) | `25` | Forecast-row icon size. |
| `current_temp_size` | number (px) | `28` | Main-panel temperature font size. |
| `time_size` | number (px) | `26` | Clock font size. |
| `day_date_size` | number (px) | `15` | Day / date label font size. |
| `forecast.labels_font_size` | number (px) | `11` | Chart axis tick label size. The wind unit and the precip unit ("mm" / "km/h") render at half this size. |
| `forecast.chart_height` | number (px) | `180` | Chart canvas height. |
| `forecast.precip_bar_size` | number (%) | `100` | Width of precipitation bars (0–100 %). |

**Icons**

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `icon_style` | `'style1' \| 'style2'` | `'style1'` | Bundled icon set. |
| `animated_icons` | bool | `false` | Use animated SVGs. |
| `icons` | string (URL) | _none_ | Override icon base path (custom set). |

**Colours**

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `forecast.temperature1_color` | CSS colour | `rgba(255, 152, 0, 1.0)` | High-temperature curve. |
| `forecast.temperature2_color` | CSS colour | `rgba(68, 115, 158, 1.0)` | Low-temperature curve. |
| `forecast.precipitation_color` | CSS colour | `rgba(132, 209, 253, 1.0)` | Precipitation bars. Forecast bars (combination mode) render at ~45 % of this colour's alpha. |
| `forecast.sunshine_color` | CSS colour | `rgba(255, 193, 7, 1.0)` | Sunshine bars. Same forecast-side alpha treatment as precipitation. |
| `forecast.chart_datetime_color` | CSS colour or `'auto'` | _none_ | X-axis weekday / date colour. |
| `forecast.chart_text_color` | CSS colour or `'auto'` | _none_ | All other chart text colour. |

## E. Units

| Key | Values | Description |
| --- | --- | --- |
| `units.pressure` | `'hPa' \| 'mmHg' \| 'inHg'` | Display unit; auto-converts from the sensor's native unit. |
| `units.speed` | `'m/s' \| 'km/h' \| 'mph' \| 'Bft'` | Display unit; auto-converts. |

## F. Advanced

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `forecast.type` | `'daily' \| 'hourly'` | `'daily'` | At hourly, station data is fetched at hour resolution (mean per hour, single temperature line) and the forecast is subscribed with `forecast_type: hourly`. `days` / `forecast_days` define the data window (so `days: 4` at hourly = 96 hours of station history). Editor radio in Setup. See [Daily vs. hourly resolution](#daily-vs-hourly-resolution) below. |
| `forecast.number_of_forecasts` | integer | `8` | Number of bars visible in the viewport at once. Default `8` works across both modes — at daily with `days: 7` everything fits without scrolling, at hourly it caps the viewport at ~8 hours and the user scrolls. Set `0` for "fit all" (no scrolling). When more bars are loaded than visible, the chart row + wind row + conditions row scroll horizontally in lockstep. Initial scroll position is "now" (centred at the station/forecast boundary in combination mode). |
| `locale` | string | HA's selected language | Override locale (e.g. `de`, `fr`). Falls back to English for missing keys. |

### `condition_mapping` — override classifier thresholds

Every value documented in [CONDITIONS.md → How conditions are determined](CONDITIONS.md#how-conditions-are-determined)
can be overridden. Defaults are meteorologically grounded — only set what you
want to change. The editor exposes the same fields under Advanced; empty
fields use the default.

| Key                        | Unit  | Default | Used by rule |
| -------------------------- | ----- | ------- | ------------ |
| `rainy_threshold_mm`       | mm    | 0.5     | Precipitation tier (rainy / snowy / snowy-rainy) |
| `pouring_threshold_mm`     | mm    | 10      | Precipitation tier (pouring) |
| `exceptional_gust_ms`      | m/s   | 24.5    | Exceptional (Beaufort 10) |
| `exceptional_precip_mm`    | mm    | 50      | Exceptional (NWS heavy-rain outlook) |
| `snow_max_c`               | °C    | 0       | snowy cutoff (temp_max ≤ value) |
| `snow_rain_max_c`          | °C    | 3       | snowy-rainy cutoff |
| `fog_humidity_pct`         | %     | 95      | Fog rule (humidity ≥ value) |
| `fog_dewpoint_spread_c`    | °C    | 1       | Fog rule (temp_min − dew_point ≤ value) |
| `fog_wind_max_ms`          | m/s   | 3       | Fog rule (wind_mean < value — fog dissipates with wind) |
| `windy_threshold_ms`       | m/s   | 10.8    | windy / windy-variant on gust |
| `windy_mean_threshold_ms`  | m/s   | 8.0     | windy / windy-variant on mean wind |
| `sunny_cloud_ratio`        | ratio | 0.70    | sunny cutoff (cloud_ratio ≥ value) |
| `partly_cloud_ratio`       | ratio | 0.30    | partlycloudy cutoff |

```yaml
# Example: warmer-climate station that should never report snow,
# and a sheltered location where 5 m/s gusts already feel "windy".
condition_mapping:
  snow_max_c: -5
  snow_rain_max_c: 1
  windy_threshold_ms: 5
```

```yaml
# Example: indoor-mounted illuminance sensor that maxes out earlier
# than outdoor; lower the sunny cutoff so noon still classifies as sunny.
condition_mapping:
  sunny_cloud_ratio: 0.55
  partly_cloud_ratio: 0.20
```

## Daily vs. hourly resolution

`forecast.type` (added in v0.8) flips both blocks to hour resolution:
station data is aggregated per hour from the recorder (`period: 'hour'`,
mean per slot, single temperature line), and the forecast subscribes
with `forecast_type: 'hourly'`. Combination mode renders past hours +
future hours joined at a "now" line — no doubled-today column.

`days` and `forecast_days` keep their meaning at hourly: they're
the **data window in days**, so `days: 7` at hourly loads `7 × 24 =
168` hours of station history. `forecast.number_of_forecasts`
controls how many of those bars are visible at once — the chart
row, conditions row, and wind row all scroll horizontally in
lockstep. Default `8` works for both modes (fits 7-day daily without
scrolling and caps the hourly viewport at ~8 hours); set `0` to
disable the viewport and show everything.
