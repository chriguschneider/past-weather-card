# Local testing — Docker recipe

How to test an unreleased build of `weather-station-card.js` against a real
Home Assistant instance without needing your own dashboard server. Useful
for contributors and AI assistants running in fresh containers; the
maintainer's Pi-based path is documented elsewhere.

→ Back to [README](README.md)

## Prerequisites

- Docker (or compatible container runtime — Podman works the same way).
- A built `dist/weather-station-card.js`. If you haven't run the build:
  ```bash
  npm install
  npm run build
  ```

## Steps

### 1. Start Home Assistant

```bash
mkdir -p ha-config
docker run -d --name homeassistant \
  --restart unless-stopped \
  -p 8123:8123 \
  -v "$PWD/ha-config:/config" \
  ghcr.io/home-assistant/home-assistant:stable
```

First boot takes a minute or two while HA generates its initial
config under `ha-config/`. Watch progress with `docker logs -f
homeassistant`; once you see `[homeassistant.components.frontend]
…` the UI is reachable.

### 2. Complete the HA onboarding

Open <http://localhost:8123> in a browser. Create the first user, set
your location, and pick a default dashboard. Skip the integration
auto-detection prompts unless you want to wire real devices —
everything below works against an empty HA.

### 3. Drop the bundle in place

```bash
mkdir -p ha-config/www/community/weather-station-card
cp dist/weather-station-card.js \
   ha-config/www/community/weather-station-card/weather-station-card.js
```

The `www/` folder maps to `/local/` in the served URL, so the bundle
ends up at `/local/community/weather-station-card/weather-station-card.js`.

### 4. Register the resource

In HA: **Settings → Dashboards → Resources → Add resource**.

- URL: `/local/community/weather-station-card/weather-station-card.js`
- Resource type: **JavaScript module**

If the Resources page is hidden, enable advanced mode under your user
profile.

### 5. Add the card

Open a dashboard, click **Edit dashboard → Add card**. The card
appears as **Custom: Weather Station Card** at the bottom of the
picker.

For a minimal config to verify the bundle loads, paste:

```yaml
type: custom:weather-station-card
sensors:
  temperature: sensor.fake_temp
```

It will render with an error banner ("sensor not available") — that's
fine for a load-check. Wire real sensor IDs to exercise the chart.

### 6. Reload after every rebuild

When you push a new `dist/weather-station-card.js`, hard-reload the
dashboard (**Ctrl+F5** or **Ctrl+Shift+R**) to bypass the browser
cache. A normal refresh keeps serving the old bundle.

## The precompressed `.gz` trap

If a previous bundle was served gzipped — either by a HACS install or
because someone manually ran `gzip -k` — HA's web server may keep
delivering the stale `.gz` even after you've replaced the `.js`.
Browsers send `Accept-Encoding: gzip` by default; the server prefers
the `.gz` when present.

Two safe fixes:

```bash
# Option A: delete the stale .gz so HA falls back to the uncompressed .js
rm -f ha-config/www/community/weather-station-card/weather-station-card.js.gz

# Option B: replace both atomically (only worth it if you're testing gzip behaviour)
gzip -kf ha-config/www/community/weather-station-card/weather-station-card.js
```

Option A is the simpler path for one-off iteration.

## Tearing down

```bash
docker stop homeassistant && docker rm homeassistant
rm -rf ha-config
```

The `ha-config/` directory persists everything (registered resources,
dashboards, the user account). Delete it to start clean; keep it to
reuse across rebuilds.
