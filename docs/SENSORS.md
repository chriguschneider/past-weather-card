# Sensors — setup recipes

Most sensors just need their entity ID under `sensors.*`. Two have additional considerations: precipitation (cumulative vs. rate) and sunshine duration (Open-Meteo integration).

→ Back to [README](../README.md)

## Setting up a precipitation sensor

The precipitation bars show **mm of rain per day**, not running totals.
Most weather-station integrations (Ecowitt, Pirateweather, BTHome,
ESPHome `pulse_meter`, …) expose a cumulative `total_increasing` counter
in mm — plug it into `sensors.precipitation` and the daily values come
out right. The data layer also accepts `total` counters and `measurement`
sensors that already represent "today's rain" (e.g. via a daily
`utility_meter`).

Note: for the **live "now" condition icon** to show rain, the sensor's
`unit_of_measurement` must be a *rate* (`mm/h`, `mm/hr`, `mm/hour`, `in/h`).
A cumulative counter still feeds the daily chart correctly, but the live
icon falls through to cloud/wind/fog. See
[CONDITIONS.md → Precipitation in the live condition needs a *rate* unit](CONDITIONS.md#precipitation-in-the-live-condition-needs-a-rate-unit)
for the mechanic.

## Sunshine duration

Set `forecast.show_sunshine: true` and you're done. The card adds a
yellow half-bar on the right of every column (precipitation keeps the
left half) and a small "Xh" label at the top of the column. Sunshine
values come directly from
[Open-Meteo](https://open-meteo.com/)'s `daily=sunshine_duration`
endpoint — no extra sensors, no YAML, nothing to set up.

```yaml
forecast:
  show_sunshine: true
```

The card uses your Home Assistant location (`hass.config.latitude`
/ `longitude`) to query Open-Meteo, fetches once on first render, and
re-fetches at most once an hour. The response covers the past N days
plus the next N forecast days in a single call. The bar colour is
`forecast.sunshine_color` (default Material amber).

**Privacy note**: enabling sunshine sends your latitude / longitude to
`api.open-meteo.com` from each browser that renders the dashboard. The
data is fetched client-side, so it's not centralised on your HA server.
Open-Meteo's privacy policy is at
[open-meteo.com/en/terms](https://open-meteo.com/en/terms). If you'd
rather not have any browser call out, leave `show_sunshine` off
(default).

In hourly mode the bars are per-hour fractions (full bar = full hour
of sun, empty bar = night or fully overcast). The numeric "Xh" box is
suppressed at hourly because 168 narrow columns over a 7-day window
can't fit a label per bar — the bar height alone encodes the value.

### Limitations

- **Lux-derived sunshine** (use your own illuminance sensor instead of
  the Open-Meteo model) — calibration data in
  [issue #6](https://github.com/chriguschneider/weather-station-card/issues/6).
- **PV-output-derived sunshine** for users with a solar inverter — same
  issue.
- **Local-network-only operation** — the Open-Meteo path needs internet.
