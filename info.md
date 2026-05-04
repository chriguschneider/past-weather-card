# Weather Station Card

A Lovelace card that shows **past weather-station measurements** in the same
per-day layout as `weather-chart-card`, plus a live "current condition" main
panel — both driven entirely by your sensor history.

Unlike the upstream `weather-chart-card`, this card does not need a
`weather.*` entity. It reads daily aggregates from
`recorder/statistics_during_period` for whichever sensors you configure
(temperature, humidity, illuminance, precipitation, pressure, wind, gust,
wind direction, UV, dew point) and renders them in the familiar 7-day chart.
The current-condition icon and condition text are derived from a
meteorologically-grounded classifier (WMO Beaufort, NWS rainfall, AMS fog,
IES illuminance — see README).

**Requirements**

- Home Assistant with the `recorder` integration enabled.
- One or more sensor entities reporting weather-station readings (any device
  works — Shelly, BTHome, Pirateweather, custom ESPHome).
- HACS for installation.

See the [README](https://github.com/chriguschneider/weather-station-card#readme)
for installation steps, a minimal config example, and the full configuration
reference.
