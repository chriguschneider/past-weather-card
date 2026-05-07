# Contributing

Thanks for considering a contribution. The most welcome kinds of PRs are
**translations**, **bug fixes**, and **screenshots / docs polish**. New
features are also welcome — please open an issue first to discuss scope.

If your PR touches code beyond a single locale or a one-line fix, skim
[ARCHITECTURE.md](ARCHITECTURE.md) first — it covers the data flow, the
forecast-array shape that every consumer relies on, and the chart-plugin
contract. About 10 minutes of reading saves an hour of reverse-engineering.

## Adding a new language

The visual editor and the in-card condition labels are translated via
[`src/locale.js`](src/locale.js). Each language has an entry that contains
two relevant blocks:

- **Top-level keys** — condition names (`sunny`, `rainy`, …), unit labels,
  cardinal directions. These already exist for ~22 languages.
- **`editor: { … }` block** — labels shown inside the visual editor
  (sensor picker labels, section headings, units page). Currently only `en`
  (canonical) and `de` ship with this block; all others fall back to English
  at runtime via `tEditor()` in `weather-station-card-editor.js`.

To add or complete a language:

1. Open `src/locale.js`.
2. Find the entry for your language code (e.g. `fr`, `es`, `it`, `ja`).
   If the language doesn't exist yet, add a new entry following the shape
   of the `en` entry.
3. Copy the **entire `editor: { … }` block** from the `en` entry.
4. Translate the values (do not touch the keys).
5. Run `npm install` once if you haven't, then `npm run build`. The bundle is
   regenerated at `dist/weather-station-card.js` — commit it together with
   your locale change.
6. Open a PR. Mention which language you added or extended.

The fallback chain at runtime is: requested language → English → key name.
A missing translation never crashes the card; it just falls through.

## Build & dev workflow

```bash
npm install
npm run lint         # ESLint 10 (typescript-eslint + lit + sonarjs)
npm run typecheck    # tsc --noEmit
npm run test         # vitest run (see TESTING.md)
npm run coverage     # vitest with v8 coverage provider
npm run depcheck     # dependency-cruiser architecture rules
npm run rollup       # one-shot bundle
npm run build        # lint + typecheck + test + rollup
npm start            # rollup --watch + dev server
```

Built artefact: `dist/weather-station-card.js`. **Always commit the rebuilt
bundle alongside source changes** — HACS serves it directly from the tag.

## CI & branch protection

`master` is protected. Direct pushes are blocked — every change goes
through a pull request. Two CI checks must be green before the merge
button activates:

- **`build`** (`.github/workflows/build.yml`) — lint, audit, typecheck,
  unit tests, coverage gate, depcheck, bundle, e2e + visual regression,
  bundle-budget, and dist-in-sync verification.
- **`Analyze (javascript-typescript)`** (CodeQL) — security analysis.

SonarCloud and Dependabot run on PRs too but are advisory; CodeQL's
`Analyze` job is required, the standalone CodeQL helper check is not.

Linear history is enforced (no merge commits) — the maintainer uses
`gh pr merge --rebase` to land PRs.

## Tests

Pure-function unit tests live under `tests/` and run via Vitest. See
[TESTING.md](TESTING.md) for the conventions on what is in scope (data
layer, classifier, formatting helpers) and what is intentionally not
covered (Lit lifecycle, Chart.js drawing, editor DOM). New PRs that touch
`src/condition-classifier.js`, `src/data-source.js`, or
`src/format-utils.js` should extend the corresponding test file.

## Code style

- Two-space indent, LF line endings.
- ES2022 features are fine (`?.`, `??`, top-level await is not used).
- Inline comments only when the *why* is non-obvious. Don't restate code.

## Issues

Bugs, feature requests, and questions:
<https://github.com/chriguschneider/weather-station-card/issues>

When reporting a bug, please include:

- Card YAML config (redact entity IDs if sensitive)
- Home Assistant version
- HACS version (if installed via HACS)
- Browser console output if the card fails to render
