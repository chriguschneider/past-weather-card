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

### Live precipitation rate from a cumulative sensor

If your weather station only exposes a cumulative `mm` counter and you
want a live `mm/h` rate (for the attribute-row precipitation cell or
to drive the live rain icon), the recommended path is HA's built-in
**Derivative helper**:

1. Settings → Devices & services → Helpers → **Create helper** → **Derivative sensor**
2. **Source**: your `*_rain_total` (or equivalent) sensor
3. **Unit Time**: `h` (so the result is in `mm/h`)
4. **Time Window**: `00:05:00` (5-minute smoothing — less noise without
   much latency)
5. Wire the resulting `sensor.*_rain_rate` (or whatever name you give
   it) into this card's `sensors.precipitation` field.

The Derivative integration handles `total_increasing` resets cleanly
and gives the card a true rate sensor — no card-side history bookkeeping
needed.

> Card-side auto-derivation from a cumulative sensor was attempted and
> rolled back; tracked in
> [issue #117](https://github.com/chriguschneider/weather-station-card/issues/117)
> for any future reconsideration. The Derivative helper is the canonical
> path today.

The attribute-row **precipitation cell** (`show_precipitation: true`)
shows the configured sensor's raw value with its native unit — that's
`mm/h` after wiring the Derivative helper, or the cumulative `mm` value
if you point it at the raw counter.

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
