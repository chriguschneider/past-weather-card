# 0002: Sunshine duration — tiered data-source policy

**Status:** Accepted

**Date:** 2026-05-08

## Context

The sunshine-duration row (configurable via `forecast.show_sunshine`) shows two values: hours of sunshine *today* and a forecast for *tomorrow* (or the next N days). Sunshine duration is not a primary HA forecast attribute and is not measured by typical home weather stations. The card therefore has to derive it.

Several derivation paths are possible, each with different fidelity, cost, and configuration burden:

- **A — measured.** A dedicated sunshine-duration sensor (`sensor.sunshine_today`) feeds the past tier directly. Highest fidelity. Requires the user to wire up an Open-Meteo REST template (or an equivalent) themselves.
- **B — illuminance-derived.** An illuminance/lux sensor exists in nearly every home weather station. We can integrate it against a clear-sky lux model (`clearSkyLuxFactory`) and count seconds where the ratio exceeds a threshold (default 0.6).
  - **B1** uses the live (current-state) lux value only — fine for "is it sunny right now" but poor for "how many hours today."
  - **B2** walks the recorder/history samples for the lux sensor and integrates over the day.
- **F — open-meteo direct.** A REST call to Open-Meteo's `meteoswiss_icon_seamless` (or another) model exposes daily and hourly sunshine forecasts.
  - **F2** is the daily forecast tier.
  - **F3** is the hourly cloud-coverage fallback when no dedicated sunshine forecast is available — applies the Kasten formula `sunshine_h ≈ day_length × (1 − (cc/100)^p)` with `p ≈ 3`.
- **C — clear-sky geometric.** Compute astronomical day length and discount it by current cloud cover. Trivially available where Open-Meteo is already wired up; coarse.

Each tier has a different "what data does the user already have?" prerequisite. Forcing all users into Method A would gatekeep the feature on a multi-step REST setup; forcing all into Method F would make Open-Meteo a hard dependency for a card that's otherwise self-contained.

## Decision

Two slots: **past tier** (today / yesterday) and **forecast tier** (tomorrow / next N days). Each slot picks the highest-fidelity available source at runtime, falling back through the tiers below it.

**Past tier preference order:**

1. Method A — `condition_mapping.sunshine_today` sensor if configured and numeric.
2. Method B2 — `condition_mapping.illuminance` sensor history walked via `sunshineFromLuxHistory(samples, lat, lon, threshold, maxIntervalMs)`. Threshold tunable via `condition_mapping.sunshine_lux_ratio` (default 0.6); samples fetched via `hass.callWS({ type: 'history/history_during_period', ... })`.
3. Fallback to forecast-tier value for "today" if neither is configured.

**Forecast tier preference order:**

1. Method F2 — `condition_mapping.sunshine_forecast` REST sensor with daily / hourly arrays.
2. Method F3 — Kasten-formula approximation from `cloud_coverage` forecast attributes when no dedicated sunshine forecast is configured.

The decisions encoded in `src/sunshine-source.ts` are referenced by code in the file header (A1 = Variant A: Methods F + C only [historical]; A2 = two slots; A3 = F2 forecast tier; A6 naming). The decision codes themselves were defined in GitHub issue #6 — this ADR is the durable in-repo record of the resulting architecture.

Configuration knobs live under `condition_mapping.*` so the user can opt in / out per sensor without changing the card's data-flow shape.

## Consequences

**Pros**

- Users with a fully-wired Open-Meteo REST template + dedicated sunshine sensor get measured fidelity automatically.
- Users with only an illuminance sensor still get a reasonable past-tier value (Method B2) without configuring a REST integration.
- Users with neither still get a forecast-tier estimate (Method F3 from `cloud_coverage`) as long as their forecast entity exposes cloud cover.
- The fallback chain is monotone: turning off a higher tier always degrades to the next-best, never to "no value."

**Cons**

- Four tiers (A, B2, F2, F3) means four code paths to test and four classifier branches in the card. The complexity is real — `sunshine-source.ts` and `openmeteo-source.ts` together are ~600 LOC.
- Method B2 depends on `recorder` retention and a high-resolution lux sensor; if either is degraded (e.g. lux sensor reports every 5 minutes), the integral is noisy.
- Method F3's Kasten exponent `p ≈ 3` is empirical; Bern-area calibration may not generalize. (Tracked in issue #6 follow-ups.)

**Tradeoffs**

- A single-tier "Method A only" design was rejected because the REST setup gatekeeps the row behind ~20 lines of YAML.
- A "Method F only, always" design was rejected because Open-Meteo isn't always available (rural users, EU privacy preferences) and because measured data, when present, is strictly better than forecast.
- B1 (live-state-only lux) was rejected because it can't answer "how many hours today" — it only answers "is it sunny right now."

## Related

- [`../../src/sunshine-source.ts`](../../src/sunshine-source.ts) — past-tier helpers
- [`../../src/openmeteo-source.ts`](../../src/openmeteo-source.ts) — F-tier fetcher
- [`../../src/condition-classifier.ts`](../../src/condition-classifier.ts) — `clearSkyLuxFactory`
- [Issue #6](https://github.com/chriguschneider/weather-station-card/issues/6) — original A1/A2/A3/A6 decisions
- [Issue #66](https://github.com/chriguschneider/weather-station-card/issues/66) — Method B2 lux-derivation
