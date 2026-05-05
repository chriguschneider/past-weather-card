# Migration guide

A single source of truth for every config-key removal, behaviour
change, and breaking refactor between major / minor releases. If
you're upgrading from an older version, scan this for any keys you
still set in your YAML.

Yet-unknown keys are silently ignored by Home Assistant, so an
out-of-date YAML keeps loading after an upgrade — but the keys do
nothing. Removing them keeps your config self-documenting.

## v0.x → v1.0

v1.0 is a quality release: speed, tests, docs, accessibility. **No new
config keys, no removed config keys.** Existing v0.9 YAML keeps
working unchanged.

If you're coming from v0.8 or earlier, also work through the v0.8.x
sections below.

## v0.8.4 — `autoscroll` removed (issue #3)

The `autoscroll: true` toggle has been removed. The original timer
fired every hour but only triggered a redraw — there was no
horizontal pan or "centre 'now' in the visible window" logic
anywhere. v0.8's hourly viewport scrolling and the v0.8.2
jump-to-now button cover the user intent better.

```yaml
# Before (v0.8.3 and earlier)
autoscroll: true
```

```yaml
# After: just remove the line. The chart already starts centred on
# "now" in combination mode, and the jump-to-now button (visible
# when scrolled away) returns there in one click.
```

## v0.8.4 — Hourly classifier thresholds rescaled (issue #7)

When `forecast.type: hourly`, station hours and the live "current
condition" snapshot now classify with precipitation thresholds
calibrated for 1-hour totals instead of 24-hour totals:

| Threshold | Daily | Hourly |
|---|---|---|
| `rainy_threshold_mm` | 0.5 mm/24h | 0.1 mm/h |
| `pouring_threshold_mm` | 10 mm/24h | 4 mm/h |
| `exceptional_precip_mm` | 50 mm/24h | 30 mm/h |

Wind / gust / fog / cloud thresholds use the same value at either
period (those are instantaneous / mean values, not totals). Daily
classification is bit-identical to v0.8.3.

`condition_mapping` overrides in your YAML still apply on top of
the per-period defaults — the key names are the same. **No YAML
change is required**; this section is informational so you know what
changed if your hourly chart suddenly classifies things differently.

If you previously tuned thresholds for hourly use via overrides and
want to restore the exact pre-v0.8.4 behaviour, set:

```yaml
condition_mapping:
  rainy_threshold_mm: 0.5
  pouring_threshold_mm: 10
  exceptional_precip_mm: 50
```

## v0.8.3 — `forecast.precipitation_type` and `forecast.show_probability` removed (issue #4)

Both keys read `precipitation_probability` directly from
`weather/get_forecasts`, which most weather integrations relevant in
DACH (Open-Meteo daily, MeteoSchweiz, certain Met.no setups) don't
populate. The toggles silently produced no visible effect upstream;
the fork's `MeasuredDataSource` never had a probability field at all,
so probability mode + station data was always inert.

```yaml
# Before — these are now silently ignored:
forecast:
  precipitation_type: 'probability'
  show_probability: true
```

```yaml
# After: just remove the keys. If you genuinely need a probability
# overlay, raise an issue describing your weather integration —
# wiring this back correctly would need a per-column dataset switch
# rather than a global mode flag.
```

## Upstream `weather-chart-card` → this fork

If you originally configured the upstream `mlamberts78/weather-chart-card`,
this fork has substantially different defaults:

- `show_main: false` by default (upstream had it on); the live "now"
  panel is opt-in here.
- `show_station: true` by default; the historical block is the card's
  raison-d'être.
- `weather_entity` is OPTIONAL when `show_forecast: false`, since
  station-only mode doesn't need a forecast source.
- The `condition_mapping` block under `forecast.*` is supported here
  for tuning the classifier; upstream had no equivalent.

See README's "Configuration reference" for the full v1.0 schema.
